// apps/web/src/stores/crawl.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { Issue, PageResult } from '@seo-crawler/shared';

import { useCrawlSession } from './crawl';

// --- фейковый WebSocket ------------------------------------------------------

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(_data: string): void {}

  close(): void {
    this.closed = true;
  }

  /** тест-хелпер: delivers событие, как будто пришло с сервера */
  receive(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  /** тест-хелпер: имитация закрытия сокета с серверной стороны */
  emitClose(): void {
    this.onclose?.();
  }
}

// --- заглушки ----------------------------------------------------------------

function makePage(url: string): PageResult {
  return {
    url,
    status: 200,
    error: null,
    contentType: 'text/html; charset=utf-8',
    depth: 0,
    fetchedAt: '2026-10-13T00:00:00.000Z',
    responseTimeMs: 12,
    sizeBytes: 2048,
    rendered: false,
    title: 'T',
    description: null,
    metaRobots: null,
    canonical: null,
    headings: { h1: [], h2: [], h3: [], h4: [], h5: [], h6: [] },
    images: [],
    internalLinks: [],
    externalLinks: [],
    schemaOrg: [],
    noindex: false,
    nofollow: false,
    redirectChain: [],
  };
}

const pageA = makePage('http://example.com/a');
const pageB = makePage('http://example.com/b');
const issue1: Issue = {
  kind: 'missing-h1',
  count: 2,
  sampleUrls: ['http://example.com/a', 'http://example.com/b'],
};

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function makeFetchMock() {
  return vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.startsWith('/api/crawl/s1/pages')) {
      return jsonResponse({ total: 2, items: [pageA, pageB] });
    }
    if (url.startsWith('/api/crawl/s1/issues')) {
      return jsonResponse([issue1]);
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

let fetchMock: ReturnType<typeof makeFetchMock>;

function calledUrls(): string[] {
  return fetchMock.mock.calls.map((c) => String(c[0]));
}

// --- тесты -------------------------------------------------------------------

describe('useCrawlSession', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    FakeWebSocket.instances = [];
    fetchMock = makeFetchMock();
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('open() ставит id, подключает WS и делает REST-загрузку (pages + issues)', async () => {
    const store = useCrawlSession();
    store.open('s1');

    expect(store.id).toBe('s1');
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0].url).toContain('/ws/crawl/s1');

    const urls = calledUrls();
    expect(urls.some((u) => u.startsWith('/api/crawl/s1/pages'))).toBe(true);
    expect(urls.some((u) => u.startsWith('/api/crawl/s1/issues'))).toBe(true);

    await vi.waitFor(() => {
      expect(store.pages).toEqual([pageA, pageB]);
      expect(store.total).toBe(2);
      expect(store.issues).toEqual([issue1]);
    });
  });

  it('событие progress обновляет счётчики', () => {
    const store = useCrawlSession();
    store.open('s1');

    FakeWebSocket.instances[0].receive({ type: 'progress', state: 'running', crawled: 5, queued: 2, errors: 0 });

    expect(store.progress).toEqual({ state: 'running', crawled: 5, queued: 2, errors: 0 });
  });

  it('событие summary обновляет issues', () => {
    const store = useCrawlSession();
    store.open('s1');

    const fresh: Issue[] = [{ kind: 'noindex', count: 1, sampleUrls: ['http://example.com/a'] }];
    FakeWebSocket.instances[0].receive({ type: 'summary', issues: fresh });

    expect(store.issues).toEqual(fresh);
  });

  it('событие done ставит state, закрывает WS и перезагружает pages + issues', async () => {
    const store = useCrawlSession();
    store.open('s1');
    const ws = FakeWebSocket.instances[0];

    await vi.waitFor(() => expect(store.pages).toEqual([pageA, pageB]));
    const callsBefore = fetchMock.mock.calls.length;

    ws.receive({ type: 'done', state: 'done' });

    expect(store.progress.state).toBe('done');
    expect(ws.closed).toBe(true);

    await vi.waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore));
    const urls = calledUrls();
    expect(urls.filter((u) => u.startsWith('/api/crawl/s1/pages')).length).toBeGreaterThanOrEqual(2);
    expect(urls.filter((u) => u.startsWith('/api/crawl/s1/issues')).length).toBeGreaterThanOrEqual(2);
  });

  it('setTab вызывает fetch с новым tab', async () => {
    const store = useCrawlSession();
    store.open('s1');

    store.setTab('external');

    await vi.waitFor(() => {
      expect(calledUrls().some((u) => u.includes('tab=external'))).toBe(true);
    });
    expect(store.tab).toBe('external');
  });

  it('loadPages учитывает pageOffset из стора', async () => {
    const store = useCrawlSession();
    store.open('s1');

    store.pageOffset = 50;
    await store.loadPages();

    const pagesCalls = calledUrls().filter((u) => u.startsWith('/api/crawl/s1/pages'));
    expect(pagesCalls.length).toBeGreaterThanOrEqual(2);
    expect(pagesCalls[pagesCalls.length - 1]).toContain('offset=50');
  });

  it('setTab сбрасывает pageOffset в 0', () => {
    const store = useCrawlSession();
    store.open('s1');

    store.pageOffset = 100;
    store.setTab('external');

    expect(store.pageOffset).toBe(0);
  });
});
