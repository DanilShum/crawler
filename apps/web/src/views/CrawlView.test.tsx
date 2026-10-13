// apps/web/src/components/../views/CrawlView.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia, type Pinia } from 'pinia';
import { createRouter, createMemoryHistory, type Router } from 'vue-router';
import { createI18n } from 'vue-i18n';
import type { Issue, PageResult } from '@seo-crawler/shared';

import CrawlView from './CrawlView';
import ProgressDashboard from '../components/ProgressDashboard';
import { useCrawlSession, type CrawlTab } from '../stores/crawl';
import ru from '../locales/ru.json';
import en from '../locales/en.json';

const i18n = createI18n({ legacy: false, locale: 'ru', messages: { ru, en } });

// --- фейковый WebSocket (как в crawl.test.ts) --------------------------------

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
}

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
    title: url.slice(url.lastIndexOf('/') + 1),
    description: null,
    metaRobots: null,
    canonical: null,
    headings: { h1: ['H'], h2: [], h3: [], h4: [], h5: [], h6: [] },
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
const brokenLink: Issue = {
  kind: 'broken-link',
  count: 2,
  sampleUrls: ['http://example.com/a', 'http://example.com/b'],
};
const noindexIssue: Issue = { kind: 'noindex', count: 1, sampleUrls: ['http://example.com/a'] };

let fetchMock: ReturnType<typeof vi.fn>;
let router: Router;
let pinia: Pinia;

let store: ReturnType<typeof useCrawlSession>;
let wrapper: VueWrapper;

async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function mountView(): Promise<void> {
  pinia = createPinia();
  setActivePinia(pinia);
  store = useCrawlSession();

  router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/crawl/:id', name: 'crawl', component: CrawlView }],
  });
  await router.push('/crawl/s1');
  await router.isReady();

  wrapper = mount(CrawlView, { global: { plugins: [i18n, pinia, router] } });
  // open() из onMounted асинхронно грузит pages/issues через REST
  await flushPromises();
  await wrapper.vm.$nextTick();
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe('CrawlView', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      if (url.startsWith('/api/crawl/s1/pages')) return jsonResponse({ total: 2, items: [pageA, pageB] });
      if (url.startsWith('/api/crawl/s1/issues')) return jsonResponse([brokenLink, noindexIssue]);
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    wrapper?.unmount();
  });

  it('передаёт id из route.params в store.open и рендерит ProgressDashboard', async () => {
    await mountView();
    expect(store.id).toBe('s1');
    expect(wrapper.findComponent(ProgressDashboard).exists()).toBe(true);
  });

  it('рендерит ссылку Export CSV на /api/crawl/:id/export, когда id установлен', async () => {
    await mountView();
    const exportLink = wrapper.find('[data-test="export-link"]');
    expect(exportLink.exists()).toBe(true);
    expect(exportLink.attributes('href')).toBe('/api/crawl/s1/export');
    expect(exportLink.attributes('download')).toBeDefined();
  });

  it('клик по вкладке External ставит store.tab = external', async () => {
    await mountView();
    await wrapper.find('[data-test="tab-external"]').trigger('click');
    expect(store.tab).toBe('external');
  });

  it('клик по вкладке Images ставит store.tab = images', async () => {
    await mountView();
    await wrapper.find('[data-test="tab-images"]').trigger('click');
    expect(store.tab).toBe('images');
  });

  it('клик по issue-группе ставит issueFilter; повторный клик сбрасывает в null', async () => {
    await mountView();
    expect(store.tab).toBe('internal');
    expect(store.issues.length).toBeGreaterThan(0);
    expect(store.issues.some((i) => i.kind === 'broken-link')).toBe(true);

    const issueBtn = wrapper.find('[data-test="issue-broken-link"]');
    expect(issueBtn.exists()).toBe(true);

    await issueBtn.trigger('click');
    expect(store.issueFilter).toBe('broken-link');

    await wrapper.find('[data-test="issue-broken-link"]').trigger('click');
    expect(store.issueFilter).toBeNull();
  });

  it('клик по строке открывает PageDetails, кнопка закрытия прячет её', async () => {
    await mountView();
    expect(wrapper.find('[data-test="row"]').exists()).toBe(true);

    await wrapper.find('[data-test="row"]').trigger('click');
    expect(store.selectedUrl).toBe('http://example.com/a');

    const details = wrapper.find('[data-test="page-details"]');
    expect(details.exists()).toBe(true);

    await details.find('[data-test="close-details"]').trigger('click');
    expect(store.selectedUrl).toBeNull();
    expect(wrapper.find('[data-test="page-details"]').exists()).toBe(false);
  });
});
