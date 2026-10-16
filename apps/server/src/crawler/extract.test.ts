import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { extractPageData } from './extract';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../test-helpers/fixtures/page.html'), 'utf8');

describe('extractPageData', () => {
  const data = extractPageData(html);
  it('извлекает метаданные и директивы', () => {
    expect(data.title).toBe('Test Page');
    expect(data.description).toBe('Desc here');
    expect(data.metaRobots).toBe('noindex, nofollow');
    expect(data.canonical).toBe('https://example.com/canonical');
  });
  it('извлекает h1 (в т.ч. дубли) и h2', () => {
    expect(data.headings.h1).toEqual(['First H1', 'Second H1']);
    expect(data.headings.h2).toEqual(['Sub']);
  });
  it('извлекает ссылки с anchor/rel', () => {
    expect(data.links).toContainEqual({ href: '/page1', anchor: 'Internal', rel: null });
    expect(data.links).toContainEqual({ href: 'https://other.com/x', anchor: 'Ext', rel: 'nofollow' });
  });
  it('извлекает картинки с alt-признаком', () => {
    expect(data.images).toContainEqual({ src: '/a.png', alt: 'has alt' });
    expect(data.images).toContainEqual({ src: '/b.png', alt: null });
  });
  it('извлекает JSON-LD', () => {
    expect(data.jsonLd).toHaveLength(1);
    expect(data.jsonLd[0]).toEqual({ '@type': 'WebPage' });
  });
});

describe('extractPageData: обогащение', () => {
  const full = `<!doctype html><html lang="ru"><head>
    <title>Т</title>
    <meta property="og:title" content="OG Title">
    <meta property="og:description" content="OG Desc">
    <meta property="og:image" content="https://s.example/og.png">
    <meta property="og:url" content="https://s.example/">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="TW">
    <link rel="alternate" hreflang="en" href="https://s.example/en/">
    <link rel="alternate" hreflang="x-default" href="https://s.example/">
    <link rel="icon" href="/favicon.ico">
    <link rel="alternate" hreflang="de">
  </head><body><h1>H1</h1><p>один два три</p><h3>H3 без H2</h3>
    <script>var a = "не считаем слова script text";</script><style>.a{}</style>
  </body></html>`;

  it('извлекает OG, twitter, hreflang, favicon, lang, headingOrder', () => {
    const d = extractPageData(full);
    expect(d.openGraph).toEqual({ title: 'OG Title', description: 'OG Desc', image: 'https://s.example/og.png', url: 'https://s.example/' });
    expect(d.twitter).toEqual({ card: 'summary_large_image', title: 'TW', description: null, image: null });
    expect(d.hreflang).toEqual([
      { lang: 'en', href: 'https://s.example/en/' },
      { lang: 'x-default', href: 'https://s.example/' },
    ]); // запись без href пропущена
    expect(d.favicon).toBe('/favicon.ico');
    expect(d.lang).toBe('ru');
    expect(d.headingOrder).toEqual(['h1', 'h3']);
  });

  it('wordCount не считает script/style и пустые токены', () => {
    expect(extractPageData(full).wordCount).toBe(7); // H1 + один два три + H3 без H2 (title из head не входит)
  });

  it('пустой content даёт null, дубль og:title — первый по документу', () => {
    const d = extractPageData(`<html><head><meta property="og:title" content=""><meta property="og:title" content="Second">
      <meta name="twitter:card" content=""></head><body></body></html>`);
    expect(d.openGraph).toEqual({ title: null, description: null, image: null, url: null });
    expect(d.twitter).toEqual({ card: null, title: null, description: null, image: null });
  });

  it('страница без мета-данных: null-объекты, пустые массивы, wordCount=0', () => {
    const d = extractPageData('<html><head><title>x</title></head></html>');
    expect(d.openGraph).toBeNull();
    expect(d.twitter).toBeNull();
    expect(d.hreflang).toEqual([]);
    expect(d.favicon).toBeNull();
    expect(d.lang).toBeNull();
    expect(d.wordCount).toBe(0);
    expect(d.headingOrder).toEqual([]);
  });
});
