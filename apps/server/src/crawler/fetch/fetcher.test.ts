import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https';
import { startTestSite } from '../../test-helpers/test-site';
import { HttpFetcher } from './fetcher';

// Минимальный HTTP-прокси: принимает absolute-form GET и пересылает на цель
let proxy: Server;
let proxyHits = 0;
let proxyPort = 0;

beforeAll(async () => {
  proxy = createServer(async (req: IncomingMessage, res) => {
    proxyHits += 1;
    const target = new URL(req.url ?? '/');
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const upstream = await fetch(target.toString(), {
      method: req.method,
      headers: req.headers,
      body: chunks.length ? Buffer.concat(chunks) : undefined,
    } as RequestInit);
    res.writeHead(upstream.status, Object.fromEntries(upstream.headers.entries()));
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.end(buf);
  });
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  proxyPort = (proxy.address() as { port: number }).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => proxy.close(() => resolve()));
});

describe('HttpFetcher классификация TLS-ошибок', () => {
  it('неполная цепочка сертификатов (leaf без CA) даёт error "ssl"', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fetcher-tls-'));
    try {
      const run = (args: string[]) => execFileSync('openssl', args, { stdio: 'pipe' });
      // Корневой CA, которому Node не доверяет
      run(['req', '-x509', '-newkey', 'rsa:2048', '-keyout', join(dir, 'ca.key'), '-out', join(dir, 'ca.crt'),
        '-days', '1', '-nodes', '-subj', '/CN=fetcher-test-ca']);
      // Leaf, подписанный CA; сервер отдаст только leaf без цепочки —
      // Node не найдёт issuer и выдаст UNABLE_TO_GET_ISSUER_CERT_LOCALLY
      run(['req', '-newkey', 'rsa:2048', '-keyout', join(dir, 'leaf.key'), '-out', join(dir, 'leaf.csr'),
        '-nodes', '-subj', '/CN=127.0.0.1',
        '-addext', 'subjectAltName=IP:127.0.0.1']);
      run(['x509', '-req', '-in', join(dir, 'leaf.csr'), '-CA', join(dir, 'ca.crt'), '-CAkey', join(dir, 'ca.key'),
        '-out', join(dir, 'leaf.crt'), '-days', '1', '-set_serial', '1']);

      const prev = { ...process.env };
      delete process.env.HTTP_PROXY; delete process.env.http_proxy;
      delete process.env.HTTPS_PROXY; delete process.env.https_proxy;
      const server: HttpsServer = createHttpsServer(
        { key: readFileSync(join(dir, 'leaf.key')), cert: readFileSync(join(dir, 'leaf.crt')) },
        (_req, res) => { res.end('ok'); },
      );
      try {
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const { port } = server.address() as { port: number };
        const f = new HttpFetcher();
        const out = await f.fetch(`https://127.0.0.1:${port}/`, 5000);
        expect(out.status).toBeNull();
        expect(out.error).toBe('ssl');
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        Object.assign(process.env, prev);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('HttpFetcher proxy support', () => {
  it('без прокси-переменных идёт напрямую', async () => {
    const prev = { ...process.env };
    delete process.env.HTTP_PROXY; delete process.env.http_proxy;
    delete process.env.HTTPS_PROXY; delete process.env.https_proxy;
    try {
      const site = await startTestSite();
      try {
        const f = new HttpFetcher();
        const out = await f.fetch(`${site.origin}/`, 5000);
        expect(out.status).toBe(200);
        expect(proxyHits).toBe(0);
      } finally { await site.close(); }
    } finally {
      Object.assign(process.env, prev);
    }
  });

  it('с HTTP_PROXY идёт через прокси (EnvHttpProxyAgent)', async () => {
    const site = await startTestSite();
    try {
      process.env.HTTP_PROXY = `http://127.0.0.1:${proxyPort}`;
      process.env.http_proxy = process.env.HTTP_PROXY;
      process.env.NO_PROXY = '';
      process.env.no_proxy = '';
      try {
        const f = new HttpFetcher();
        const out = await f.fetch(`${site.origin}/`, 5000);
        expect(out.status).toBe(200);
        expect(out.body).toContain('/about');
        expect(proxyHits).toBeGreaterThan(0);
      } finally {
        delete process.env.HTTP_PROXY; delete process.env.http_proxy;
        process.env.NO_PROXY = 'localhost,127.0.0.1,::1';
        process.env.no_proxy = process.env.NO_PROXY;
      }
    } finally { await site.close(); }
  });
});
