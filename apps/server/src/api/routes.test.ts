import { describe, it, expect, afterEach } from 'vitest';
import { buildApp, pagesInIssueGroup } from './routes';
import type { PageResult } from '@seo-crawler/shared';
import { SessionManager } from '../session/session-manager';
import { startTestSite } from '../test-helpers/test-site';
import { createNoNetworkFetcher } from '../test-helpers/no-network-fetcher';
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
  // Блокируем сетевые вызовы наружу (external.example в фикстуре).
  const sessions = new SessionManager(createNoNetworkFetcher);
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

  it('GET pages?issue=missing-lang фильтрует (не 400): фикстура без <html lang>', async () => {
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

      const res = await app.inject({ method: 'GET', url: `/api/crawl/${id}/pages?issue=missing-lang` });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.total).toBeGreaterThan(0);
      expect(body.items.every((p: { lang: string | null }) => p.lang === null)).toBe(true);
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

  it('GET /api/crawl/:id/export отдаёт CSV: 200, заголовки, BOM, URL страниц', async () => {
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

      const res = await app.inject({ method: 'GET', url: `/api/crawl/${id}/export` });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(res.headers['content-disposition']).toBe(`attachment; filename="crawl-${id}.csv"`);
      const body = res.body;
      // BOM + заголовок колонок первой строкой
      expect(body.startsWith('\uFEFFurl,status,error,')).toBe(true);
      // все URL прокрауленных страниц присутствуют в теле
      const all = [...sessions.get(id)!.results.values()];
      expect(all.length).toBeGreaterThan(0);
      for (const p of all) {
        expect(body).toContain(p.url);
      }
    } finally {
      await site.close();
    }
  });

  it('GET /api/crawl/:id/export неизвестного id → 404', async () => {
    const { app } = newApp();
    const res = await app.inject({ method: 'GET', url: '/api/crawl/nope/export' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'NOT_FOUND' });
  });

  it('GET pages неизвестного id → 404', async () => {
    const { app } = newApp();
    const res = await app.inject({ method: 'GET', url: '/api/crawl/nope/pages' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'NOT_FOUND' });
  });
});

describe('pagesInIssueGroup: новые kind', () => {
  function page(over: Partial<PageResult> & { url: string }): PageResult {
    return {
      status: 200, error: null, contentType: 'text/html', depth: 0,
      fetchedAt: '2026-01-01T00:00:00.000Z', responseTimeMs: 10, sizeBytes: 100, rendered: false,
      title: null, description: null, metaRobots: null, canonical: null,
      headings: { h1: [], h2: [], h3: [], h4: [], h5: [], h6: [] },
      images: [], internalLinks: [], externalLinks: [], schemaOrg: [],
      noindex: false, nofollow: false, redirectChain: [],
      openGraph: null, twitter: null, hreflang: [], favicon: null,
      wordCount: 0, lang: null, headingOrder: [],
      ...over,
    };
  }

  it('missing-og: только страницы без og:title и og:description', () => {
    const set = pagesInIssueGroup([
      page({ url: 'http://a/1' }),
      page({ url: 'http://a/2', openGraph: { title: 'T', description: null, image: null, url: null } }),
    ], new Map(), 'missing-og');
    expect(set).toEqual(new Set(['http://a/1']));
  });

  it('missing-favicon и missing-lang', () => {
    const results = [
      page({ url: 'http://a/1' }),
      page({ url: 'http://a/2', favicon: '/f.ico', lang: 'ru' }),
    ];
    expect(pagesInIssueGroup(results, new Map(), 'missing-favicon')).toEqual(new Set(['http://a/1']));
    expect(pagesInIssueGroup(results, new Map(), 'missing-lang')).toEqual(new Set(['http://a/1']));
  });

  it('heading-order: h2 первым — нарушение', () => {
    const set = pagesInIssueGroup([
      page({ url: 'http://a/1', headingOrder: ['h2', 'h1'] }),
      page({ url: 'http://a/2', headingOrder: ['h1', 'h2'] }),
    ], new Map(), 'heading-order');
    expect(set).toEqual(new Set(['http://a/1']));
  });
});

describe('GET /pages: обогащение issues', () => {
  it('каждый item содержит список проблем своей страницы', async () => {
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

      const res = await app.inject({ method: 'GET', url: `/api/crawl/${id}/pages` });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      const home = body.items.find((p: { url: string }) => p.url === site.origin + '/');
      // главная фикстуры: битая внешняя ссылка (external.example), нет h1, нет og/favicon/lang
      expect(home.issues).toEqual([
        'broken-link', 'missing-h1', 'missing-og', 'missing-favicon', 'missing-lang',
      ]);
      const noindex = body.items.find((p: { url: string }) => p.url.endsWith('/noindex'));
      expect(noindex.issues).toContain('noindex');
    } finally {
      await site.close();
    }
  });
});
