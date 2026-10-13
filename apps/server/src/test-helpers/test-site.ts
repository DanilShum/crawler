import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface TestSite {
  origin: string;
  close(): Promise<void>;
}

const PDF_BUFFER = Buffer.from('%PDF-1.4\n% fake pdf body for tests\n');

function homeHtml(): string {
  return [
    '<html><head><title>Home</title></head><body>',
    '<a href="/about">About</a>',
    '<a href="/missing">Bad</a>',
    '<a href="/redirect">Redir</a>',
    '<a href="/binary.pdf">PDF</a>',
    '<a href="https://external.example/">Ext</a>',
    '</body></html>',
  ].join('');
}

function aboutHtml(): string {
  return [
    '<html><head><title>About</title></head><body>',
    '<h1>About</h1>',
    '<img src="/logo.png" alt="">',
    '<img src="/pic.png">',
    '</body></html>',
  ].join('');
}

function sitemapXml(origin: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    `<url><loc>${origin}/</loc></url>`,
    `<url><loc>${origin}/about</loc></url>`,
    '</urlset>',
  ].join('\n');
}

export async function startTestSite(port = 0): Promise<TestSite> {
  let origin = '';

  const server = http.createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    switch (path) {
      case '/':
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(homeHtml());
        break;
      case '/about':
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(aboutHtml());
        break;
      case '/redirect':
        res.writeHead(301, { location: '/about' });
        res.end();
        break;
      case '/missing':
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('not found');
        break;
      case '/binary.pdf':
        res.writeHead(200, { 'content-type': 'application/pdf' });
        res.end(PDF_BUFFER);
        break;
      case '/robots.txt':
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(`User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`);
        break;
      case '/sitemap.xml':
        res.writeHead(200, { 'content-type': 'application/xml; charset=utf-8' });
        res.end(sitemapXml(origin));
        break;
      default:
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('not found');
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });

  const address = server.address() as AddressInfo;
  origin = `http://127.0.0.1:${address.port}`;

  return {
    origin,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
