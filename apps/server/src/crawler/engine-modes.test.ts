import { describe, it, expect } from 'vitest';
import { startTestSite } from '../test-helpers/test-site';
import { NoNetworkFetcher } from '../test-helpers/no-network-fetcher';
import { Crawler } from './engine';
import type { CrawlOptions, PageResult } from '@seo-crawler/shared';

function opts(origin: string, over: Partial<CrawlOptions> = {}): CrawlOptions {
  return { startUrl: origin + '/', mode: 'spider', maxUrls: 500, maxDepth: 10,
    respectRobots: true, renderJs: false, concurrency: 5, requestTimeoutMs: 5000, ...over };
}

async function run(origin: string, o: CrawlOptions) {
  const fetcher = new NoNetworkFetcher();
  const pages: PageResult[] = [];
  const finalState: { value: string | null } = { value: null };
  const crawler = new Crawler(o, fetcher, (e) => {
    if (e.type === 'page') pages.push(e.result);
    if (e.type === 'done') finalState.value = e.state;
  });
  await crawler.start();
  fetcher.close();
  return { pages, final: finalState.value, crawler };
}

describe('Crawler list', () => {
  it('обходит ровно listUrls (нормализуя их к startUrl) и не следует ссылкам', async () => {
    const site = await startTestSite();
    try {
      const { pages, final } = await run(site.origin, opts(site.origin, {
        mode: 'list', listUrls: ['/about', '/missing'],
      }));
      const urls = pages.map((p) => p.url).sort();
      expect(urls).toEqual([site.origin + '/about', site.origin + '/missing'].sort());
      // 404 из listUrls фиксируется как результат со своим статусом
      const missing = pages.find((p) => p.url === site.origin + '/missing')!;
      expect(missing.status).toBe(404);
      // Главная не в списке — не обходится; ссылки /about (например /private/secret) не обходятся
      expect(urls.some((u) => u === site.origin + '/')).toBe(false);
      expect(urls.some((u) => u.endsWith('/private/secret'))).toBe(false);
      expect(final).toBe('done');
    } finally { await site.close(); }
  });
});

describe('Crawler sitemap', () => {
  it('обходит только URL из sitemap (с сайта) и не следует ссылкам', async () => {
    const site = await startTestSite();
    try {
      const { pages, final } = await run(site.origin, opts(site.origin, { mode: 'sitemap' }));
      const urls = pages.map((p) => p.url).sort();
      expect(urls).toEqual([site.origin + '/', site.origin + '/about'].sort());
      // Ссылки главной (/redirect, /missing, /binary.pdf, /loop) не обходятся
      expect(urls.some((u) => u.endsWith('/redirect'))).toBe(false);
      expect(urls.some((u) => u.endsWith('/missing'))).toBe(false);
      expect(urls.some((u) => u.endsWith('/loop'))).toBe(false);
      expect(final).toBe('done');
    } finally { await site.close(); }
  });

  it('при respectRobots=false всё равно находит sitemap через robots.txt', async () => {
    // Каноническая карта фикстуры лежит на нестандартном пути /sitemaps/index.xml,
    // известном только из Sitemap-директивы robots.txt. Дефолтный /sitemap.xml отдаёт
    // другой urlset (only-from-fallback). Если бы движок не фетчил robots.txt в этом
    // режиме, он бы споткнулся о фоллбек — и only-from-fallback попал бы в результаты.
    const site = await startTestSite();
    try {
      const { pages, final } = await run(site.origin, opts(site.origin, { mode: 'sitemap', respectRobots: false }));
      const urls = pages.map((p) => p.url).sort();
      expect(urls).toEqual([site.origin + '/', site.origin + '/about'].sort());
      expect(urls.some((u) => u.endsWith('only-from-fallback'))).toBe(false);
      expect(final).toBe('done');
    } finally { await site.close(); }
  });
});
