// apps/web/src/views/history-view.test.tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { createRouter, createMemoryHistory, type Router } from 'vue-router';
import { createI18n } from 'vue-i18n';

import HistoryView from './history-view';
import type { SessionMeta } from '../../api/client';
import ru from '../../locales/ru.json';
import en from '../../locales/en.json';

const i18n = createI18n({ legacy: false, locale: 'ru', messages: { ru, en } });

// заглушка экрана краула — чтобы router.push('/crawl/:id') имел куда ходить
const CrawlStub = defineComponent({
  name: 'CrawlStub',
  setup() {
    return () => <div data-test="crawl-stub" />;
  },
});

const sessions: SessionMeta[] = [
  {
    id: 's1',
    startUrl: 'https://example.com',
    mode: 'spider',
    state: 'done',
    crawled: 12,
    errors: 0,
    startedAt: '2026-10-13T10:00:00.000Z',
  },
  {
    id: 's2',
    startUrl: 'https://test.example.org',
    mode: 'sitemap',
    state: 'running',
    crawled: 3,
    errors: 1,
    startedAt: '2026-10-13T11:30:00.000Z',
  },
];

let router: Router;
let wrapper: VueWrapper;

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

async function mountView(list: SessionMeta[]): Promise<void> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.startsWith('/api/crawls')) return jsonResponse(list);
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/history', name: 'history', component: HistoryView },
      { path: '/crawl/:id', name: 'crawl', component: CrawlStub },
    ],
  });
  await router.push('/history');
  await router.isReady();

  wrapper = mount(HistoryView, { global: { plugins: [i18n, router] } });
  // onMounted → fetchCrawls() асинхронный
  await new Promise((resolve) => setTimeout(resolve, 0));
  await wrapper.vm.$nextTick();
}

afterEach(() => {
  vi.unstubAllGlobals();
  wrapper?.unmount();
});

describe('HistoryView', () => {
  it('рендерит сессии из fetchCrawls: startUrl и mode в тексте', async () => {
    await mountView(sessions);
    const rows = wrapper.findAll('[data-test="history-row"]');
    expect(rows.length).toBe(2);
    const text = wrapper.text();
    for (const s of sessions) {
      expect(text).toContain(s.startUrl);
      expect(text).toContain(s.mode);
    }
    // бейдж состояния: done → badge-ok, running → badge-error
    const firstText = rows[0].html();
    expect(firstText).toContain('badge-ok');
    const secondText = rows[1].html();
    expect(secondText).toContain('badge-error');
  });

  it('клик по строке вызывает router.push(`/crawl/${id}`)', async () => {
    await mountView(sessions);
    await wrapper.find('[data-test="history-row"]').trigger('click');
    // push асинхронный — даём навигации завершиться
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();
    expect(router.currentRoute.value.path).toBe('/crawl/s1');
  });

  it('пустой список показывает заглушку', async () => {
    await mountView([]);
    expect(wrapper.find('[data-test="history-empty"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="history-row"]').exists()).toBe(false);
  });
});
