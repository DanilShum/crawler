// apps/web/src/components/ResultsTable.test.tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import type { PageResult } from '@seo-crawler/shared';

import ResultsTable from './ResultsTable';
import { useCrawlSession } from '../stores/crawl';
import ru from '../locales/ru.json';
import en from '../locales/en.json';

const i18n = createI18n({ legacy: false, locale: 'ru', messages: { ru, en } });

function makePage(over: Partial<PageResult> = {}): PageResult {
  const base: PageResult = {
    url: 'http://example.com/a',
    status: 200,
    error: null,
    contentType: 'text/html; charset=utf-8',
    depth: 0,
    fetchedAt: '2026-10-13T00:00:00.000Z',
    responseTimeMs: 12,
    sizeBytes: 2048,
    rendered: false,
    title: 'Home',
    description: null,
    metaRobots: null,
    canonical: null,
    headings: { h1: ['Заголовок'], h2: [], h3: [], h4: [], h5: [], h6: [] },
    images: [],
    internalLinks: [],
    externalLinks: [],
    schemaOrg: [],
    noindex: false,
    nofollow: false,
    redirectChain: [],
  openGraph: null,
  twitter: null,
  hreflang: [],
  favicon: null,
  wordCount: 0,
  lang: null,
  headingOrder: [],
  };
  return { ...base, ...over };
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

function mountTable(pages: PageResult[]) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const store = useCrawlSession();
  store.pages = pages;
  store.total = pages.length;
  const wrapper = mount(ResultsTable, { global: { plugins: [i18n, pinia] } });
  return { wrapper, store };
}

describe('ResultsTable', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('рендерит строки из стора и по клику по строке ставит selectedUrl', async () => {
    const p1 = makePage({ url: 'http://example.com/a' });
    const p2 = makePage({ url: 'http://example.com/b', title: 'About' });
    const { wrapper, store } = mountTable([p1, p2]);

    const cells = wrapper.findAll('[data-test="cell-url"]');
    expect(cells).toHaveLength(2);
    expect(cells[0].text()).toContain('http://example.com/a');
    expect(cells[1].text()).toContain('http://example.com/b');

    await wrapper.findAll('[data-test="row"]')[0].trigger('click');
    expect(store.selectedUrl).toBe('http://example.com/a');
  });

  it('статус 404 помечает строку классом badge-error, а 200 — badge-ok', () => {
    const err = makePage({ url: 'http://example.com/404', status: 404 });
    const ok = makePage({ url: 'http://example.com/ok', status: 200 });
    const { wrapper } = mountTable([err, ok]);

    const rows = wrapper.findAll('[data-test="row"]');
    const errCell = rows[0].find('[data-test="status-badge"]');
    expect(errCell.classes()).toContain('badge-error');
    expect(errCell.text()).toBe('404');

    const okCell = rows[1].find('[data-test="status-badge"]');
    expect(okCell.classes()).toContain('badge-ok');
    expect(okCell.text()).toBe('200');
  });

  it('noindex показывает красный бейдж с текстом "noindex"', () => {
    const ni = makePage({ url: 'http://example.com/ni', noindex: true });
    const ok = makePage({ url: 'http://example.com/ok' });
    const { wrapper } = mountTable([ni, ok]);

    const rows = wrapper.findAll('[data-test="row"]');
    expect(rows[0].find('[data-test="badge-noindex"]').exists()).toBe(true);
    expect(rows[0].find('[data-test="badge-noindex"]').text()).toBe(i18n.global.t('table.noindex'));
    expect(rows[1].find('[data-test="badge-noindex"]').exists()).toBe(false);
  });

  it('поиск фильтрует строки по URL/title на клиенте, без loadPages', async () => {
    const a = makePage({ url: 'http://example.com/alpha', title: 'Alpha page' });
    const b = makePage({ url: 'http://example.com/beta', title: 'Beta page' });
    const { wrapper, store } = mountTable([a, b]);
    const loadSpy = vi.spyOn(store, 'loadPages');

    // по URL
    await wrapper.find('[data-test="search"]').setValue('beta');
    let cells = wrapper.findAll('[data-test="cell-url"]');
    expect(cells).toHaveLength(1);
    expect(cells[0].text()).toContain('beta');

    // по title (регистронезависимо)
    await wrapper.find('[data-test="search"]').setValue('ALPHA');
    cells = wrapper.findAll('[data-test="cell-url"]');
    expect(cells).toHaveLength(1);
    expect(cells[0].text()).toContain('alpha');

    // сброс
    await wrapper.find('[data-test="search"]').setValue('');
    cells = wrapper.findAll('[data-test="cell-url"]');
    expect(cells).toHaveLength(2);

    expect(loadSpy).not.toHaveBeenCalled();
  });

  it('клик по заголовку URL сортирует строки, второй клик — разворачивает порядок', async () => {
    const zeta = makePage({ url: 'http://example.com/zeta' });
    const alpha = makePage({ url: 'http://example.com/alpha' });
    const { wrapper } = mountTable([zeta, alpha]);

    await wrapper.find('[data-test="th-url"]').trigger('click');
    let cells = wrapper.findAll('[data-test="cell-url"]');
    expect(cells[0].text()).toContain('alpha');
    expect(cells[1].text()).toContain('zeta');

    await wrapper.find('[data-test="th-url"]').trigger('click');
    cells = wrapper.findAll('[data-test="cell-url"]');
    expect(cells[0].text()).toContain('zeta');
    expect(cells[1].text()).toContain('alpha');
  });

  it('пагинация: кнопки disabled на границах, next двигает pageOffset и грузит страницу', async () => {
    const nextPage = makePage({ url: 'http://example.com/next', status: 200 });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ total: 1, items: [nextPage] })),
    );

    const { wrapper, store } = mountTable([makePage()]);
    store.id = 's1';
    store.total = 50;
    await wrapper.vm.$nextTick();

    // первая страница: prev недоступен, next доступен
    expect(wrapper.find('[data-test="prev-page"]').attributes('disabled')).toBeDefined();
    expect(wrapper.find('[data-test="next-page"]').attributes('disabled')).toBeUndefined();

    await wrapper.find('[data-test="next-page"]').trigger('click');

    await vi.waitFor(() => expect(store.pageOffset).toBe(50));
    await vi.waitFor(() => {
      const fetchMock = (globalThis.fetch as ReturnType<typeof vi.fn>);
      expect(fetchMock).toHaveBeenCalled();
    });

    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('offset=50');

    await wrapper.vm.$nextTick();
    // после перехода на вторую страницу prev становится доступен
    expect(wrapper.find('[data-test="prev-page"]').attributes('disabled')).toBeUndefined();
  });
});

describe('ResultsTable: колонка слов', () => {
  it('рендерит wordCount', () => {
    const { wrapper } = mountTable([makePage({ wordCount: 322 })]);
    expect(wrapper.find('[data-test="th-wordCount"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="cell-wordcount"]').text()).toBe('322');
  });
});
