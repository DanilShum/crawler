import { describe, it, expect, afterEach } from 'vitest';
import { buildApp } from './routes';
import { SessionManager } from '../session/session-manager';
import { startTestSite } from '../test-helpers/test-site';
import type { FastifyInstance } from 'fastify';

const BASE = {
  mode: 'spider' as const,
  maxUrls: 100,
  maxDepth: 10,
  respectRobots: false,
  renderJs: false,
  concurrency: 5,
  requestTimeoutMs: 5000,
};

function makeApp() {
  const sessions = new SessionManager();
  const app = buildApp({ sessions });
  return { app, sessions };
}

const openApp: FastifyInstance[] = [];
function newApp() {
  const { app, sessions } = makeApp();
  openApp.push(app);
  return { app, sessions };
}

async function waitDone(sessions: SessionManager, id: string, timeoutMs = 10_000): Promise<void> {
  const session = sessions.get(id)!;
  if (session.state !== 'running') return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting for crawl done')), timeoutMs);
    session.subscribe((e) => {
      if (e.type === 'done') {
        clearTimeout(timer);
        resolve();
      }
    });
  });
}

describe('crawl API routes', () => {
  afterEach(async () => {
    await Promise.all(openApp.splice(0).map((a) => a.close()));
  });

  it('POST /api/crawl стартует сессию и возвращает { id }', async () => {
    const site = await startTestSite();
    try {
      const { app, sessions } = newApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/crawl',
        payload: { startUrl: site.origin + '/', ...BASE },
        headers: { 'content-type': 'application/json' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(typeof body.id).toBe('string');
      expect(sessions.get(body.id)).toBeDefined();
      await waitDone(sessions, body.id);
    } finally {
      await site.close();
    }
  });

  it('POST /api/crawl с невалидным URL → 400 VALIDATION', async () => {
    const { app } = newApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/crawl',
      payload: { startUrl: 'not-a-url', ...BASE },
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'VALIDATION' });
  });

  it('POST /api/crawl с невалидным mode → 400 VALIDATION', async () => {
    const { app } = newApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/crawl',
      payload: { startUrl: 'http://localhost/', ...BASE, mode: 'nope' },
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'VALIDATION' });
  });

  it('POST /api/crawl: mode=list без listUrls → 400', async () => {
    const { app } = newApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/crawl',
      payload: { startUrl: 'http://localhost/', ...BASE, mode: 'list' },
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'VALIDATION' });
  });

  it('GET pages пагинирует: limit=1&offset=1 → total полный, items.length=1', async () => {
    const site = await startTestSite();
    try {
      const { app, sessions } = newApp();
      const start = await app.inject({
        method: 'POST',
        url: '/api/crawl',
        payload: { startUrl: site.origin + '/', ...BASE },
        headers: { 'content-type': 'application/json' },
      });
      const { id } = start.json();
      await waitDone(sessions, id);

      const res = await app.inject({ method: 'GET', url: `/api/crawl/${id}/pages?limit=1&offset=1` });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      const total = sessions.get(id)!.results.size;
      expect(body.total).toBe(total);
      expect(body.items).toHaveLength(1);
      // сортировка по depth затем url: элемент с offset=1 — второй по этому порядку
      const all = [...sessions.get(id)!.results.values()]
        .sort((a, b) => a.depth - b.depth || a.url.localeCompare(b.url));
      expect(body.items[0].url).toBe(all[1].url);
    } finally {
      await site.close();
    }
  });

  it('GET pages?issue=noindex фильтрует: только noindex-страницы', async () => {
    const site = await startTestSite();
    try {
      const { app, sessions } = newApp();
      const start = await app.inject({
        method: 'POST',
        url: '/api/crawl',
        payload: { startUrl: site.origin + '/', ...BASE },
        headers: { 'content-type': 'application/json' },
      });
      const { id } = start.json();
      await waitDone(sessions, id);

      const res = await app.inject({ method: 'GET', url: `/api/crawl/${id}/pages?issue=noindex` });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.total).toBeGreaterThan(0);
      expect(body.items.every((p: { noindex: boolean }) => p.noindex === true)).toBe(true);
    } finally {
      await site.close();
    }
  });

  it('GET /api/crawls содержит созданную сессию', async () => {
    const site = await startTestSite();
    try {
      const { app, sessions } = newApp();
      const start = await app.inject({
        method: 'POST',
        url: '/api/crawl',
        payload: { startUrl: site.origin + '/', ...BASE },
        headers: { 'content-type': 'application/json' },
      });
      const { id } = start.json();
      const res = await app.inject({ method: 'GET', url: '/api/crawls' });
      expect(res.statusCode).toBe(200);
      const list = res.json();
      const meta = list.find((m: { id: string }) => m.id === id);
      expect(meta).toMatchObject({
        id,
        startUrl: site.origin + '/',
        mode: 'spider',
        state: 'running',
      });
      expect(typeof meta.startedAt).toBe('string');
      await waitDone(sessions, id);
    } finally {
      await site.close();
    }
  });

  it('POST /api/crawl/:id/stop → { ok: true }; неизвестный id → 404', async () => {
    const site = await startTestSite();
    try {
      const { app, sessions } = newApp();
      const start = await app.inject({
        method: 'POST',
        url: '/api/crawl',
        payload: { startUrl: site.origin + '/', ...BASE },
        headers: { 'content-type': 'application/json' },
      });
      const { id } = start.json();

      const stop = await app.inject({ method: 'POST', url: `/api/crawl/${id}/stop` });
      expect(stop.statusCode).toBe(200);
      expect(stop.json()).toEqual({ ok: true });

      const missing = await app.inject({ method: 'POST', url: '/api/crawl/nope/stop' });
      expect(missing.statusCode).toBe(404);
      expect(missing.json()).toMatchObject({ error: 'NOT_FOUND' });

      // после stop сессия достигает state=stopped
      await waitDone(sessions, id);
      expect(sessions.get(id)!.state).toBe('stopped');
    } finally {
      await site.close();
    }
  });

  it('GET /api/crawl/:id/issues после завершённого краула отдаёт массив', async () => {
    const site = await startTestSite();
    try {
      const { app, sessions } = newApp();
      const start = await app.inject({
        method: 'POST',
        url: '/api/crawl',
        payload: { startUrl: site.origin + '/', ...BASE },
        headers: { 'content-type': 'application/json' },
      });
      const { id } = start.json();
      await waitDone(sessions, id);

      const res = await app.inject({ method: 'GET', url: `/api/crawl/${id}/issues` });
      expect(res.statusCode).toBe(200);
      const issues = res.json();
      expect(Array.isArray(issues)).toBe(true);
      // битая ссылка /missing в фикстуре есть
      expect(issues.some((i: { kind: string }) => i.kind === 'broken-link')).toBe(true);
    } finally {
      await site.close();
    }
  });

  it('GET pages неизвестного id → 404', async () => {
    const { app } = newApp();
    const res = await app.inject({ method: 'GET', url: '/api/crawl/nope/pages' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'NOT_FOUND' });
  });
});
