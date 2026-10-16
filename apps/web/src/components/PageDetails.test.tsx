// apps/web/src/components/PageDetails.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import type { PageResult } from '@seo-crawler/shared';

import PageDetails from './PageDetails';
import ru from '../locales/ru.json';
import en from '../locales/en.json';

const i18n = createI18n({ legacy: false, locale: 'ru', messages: { ru, en } });

const page: PageResult = {
  url: 'http://example.com/a',
  status: 404,
  error: 'not-found',
  contentType: 'text/html; charset=utf-8',
  depth: 2,
  fetchedAt: '2026-10-13T00:00:00.000Z',
  responseTimeMs: 120,
  sizeBytes: 4096,
  rendered: true,
  title: 'Page A',
  description: 'Description of A',
  metaRobots: 'noindex,nofollow',
  canonical: 'http://example.com/a',
  headings: {
    h1: ['Heading One'],
    h2: ['Sub Heading'],
    h3: [],
    h4: [],
    h5: [],
    h6: [],
  },
  images: [
    { url: 'http://example.com/img.png', alt: 'Alt text' },
    { url: 'http://example.com/img2.png', alt: null },
  ],
  internalLinks: [{ url: 'http://example.com/in', anchor: 'In anchor', rel: null }],
  externalLinks: [{ url: 'http://external.com/x', anchor: 'X anchor', rel: 'nofollow' }],
  schemaOrg: [{ '@type': 'WebPage', name: 'Page A' }],
  noindex: true,
  nofollow: true,
  redirectChain: [],
  openGraph: null,
  twitter: null,
  hreflang: [],
  favicon: null,
  wordCount: 0,
  lang: null,
  headingOrder: [],
};

function mountDetails(getPage: PageResult = page) {
  return mount(PageDetails, {
    props: { page: getPage, onClose: () => {} },
    global: { plugins: [i18n] },
  });
}

describe('PageDetails', () => {
  it('рендерит все секции: URL, title, canonical, статус, ссылки, schema.org в pre, alt/без alt', () => {
    const wrapper = mountDetails();
    const text = wrapper.text();

    // URL и canonical
    expect(text).toContain('http://example.com/a');
    expect(wrapper.find('[data-test="meta-canonical"]').text()).toContain('http://example.com/a');

    // title в метаданных
    expect(wrapper.find('[data-test="meta-title"]').text()).toBe('Page A');

    // статус + текст ошибки
    expect(wrapper.find('[data-test="status-badge"]').text()).toContain('404');
    expect(wrapper.find('[data-test="page-error"]').text()).toBe('not-found');

    // fetchedAt (локальная строка; год стабилен) и пустая цепочка редиректов — «—»
    expect(wrapper.find('[data-test="meta-fetched-at"]').text()).toContain('2026');
    expect(wrapper.find('[data-test="redirect-chain"]').text()).toBe('—');

    // внутренние и внешние ссылки
    expect(text).toContain('http://example.com/in');
    expect(text).toContain('http://external.com/x');

    // заголовки
    expect(text).toContain('Heading One');
    expect(text).toContain('Sub Heading');

    // schema.org в <pre> с отступами
    const pre = wrapper.find('[data-test="schema-pre"]');
    expect(pre.exists()).toBe(true);
    const parsed = JSON.parse(pre.text()) as unknown[];
    expect(parsed).toEqual(page.schemaOrg);

    // изображения: alt-текст и «без alt»
    expect(text).toContain('Alt text');
    expect(wrapper.find('[data-test="missing-alt"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="missing-alt"]').text()).toBe(i18n.global.t('details.noAlt'));

    // бейджи noindex/nofollow
    expect(wrapper.find('[data-test="badge-noindex"]').text()).toBe(i18n.global.t('details.noindex'));
    expect(wrapper.find('[data-test="badge-nofollow"]').text()).toBe(i18n.global.t('details.nofollow'));
  });

  it('кнопка закрытия вызывает onClose', async () => {
    const onClose = vi.fn();
    const wrapper = mount(PageDetails, {
      props: { page, onClose },
      global: { plugins: [i18n] },
    });

    await wrapper.find('[data-test="close-details"]').trigger('click');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('цепочка редиректов показывается списком URL', () => {
    const redirected: PageResult = {
      ...page,
      redirectChain: ['http://example.com/redirect', 'http://example.com/mid'],
    };
    const wrapper = mountDetails(redirected);
    const chain = wrapper.find('[data-test="redirect-chain"]');
    expect(chain.exists()).toBe(true);
    expect(chain.text()).toContain('http://example.com/redirect');
    expect(chain.text()).toContain('http://example.com/mid');
    expect(wrapper.find('[data-test="redirect-chain"] li').exists()).toBe(true);
  });

  it('страница без ошибок и без schema — секции рендерятся корректно', () => {
    const clean: PageResult = {
      ...page,
      status: 200,
      error: null,
      schemaOrg: [],
      images: [],
      internalLinks: [],
      externalLinks: [],
      noindex: false,
      nofollow: false,
      headings: { h1: [], h2: [], h3: [], h4: [], h5: [], h6: [] },
    };
    const wrapper = mountDetails(clean);
    expect(wrapper.find('[data-test="status-badge"]').text()).toBe('200');
    expect(wrapper.find('[data-test="page-error"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="missing-alt"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="badge-noindex"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="badge-nofollow"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="schema-pre"]').text()).toContain('[]');
  });
});

describe('PageDetails: обогащённые данные', () => {
  const enriched = {
    ...page,
    openGraph: { title: 'OG Title', description: 'OG Desc', image: 'https://s.example/og.png', url: 'https://s.example/' },
    twitter: { card: 'summary_large_image', title: null, description: null, image: null },
    hreflang: [{ lang: 'en', href: 'https://s.example/en/' }],
    favicon: '/favicon.ico',
    wordCount: 322,
    lang: 'ru',
  };

  it('рендерит блоки OG/Twitter/hreflang/favicon/wordCount/lang', () => {
    const w = mount(PageDetails, { props: { page: enriched }, global: { plugins: [i18n] } });
    expect(w.text()).toContain('OG Title');
    expect(w.text()).toContain('OG Desc');
    expect(w.text()).toContain('summary_large_image');
    expect(w.text()).toContain('en=https://s.example/en/');
    expect(w.find('img[data-test="details-favicon"]').exists()).toBe(true);
    expect(w.find('[data-test="details-wordcount"]').text()).toBe('322');
    expect(w.find('[data-test="details-lang"]').text()).toBe('ru');
  });

  it('прочерки при отсутствии данных', () => {
    const w = mount(PageDetails, {
      props: { page: { ...page, openGraph: null, twitter: null, hreflang: [], favicon: null, lang: null } },
      global: { plugins: [i18n] },
    });
    expect(w.findAll('[data-test="details-og-empty"]').length).toBeGreaterThan(0);
    expect(w.find('img[data-test="details-favicon"]').exists()).toBe(false);
  });
});
