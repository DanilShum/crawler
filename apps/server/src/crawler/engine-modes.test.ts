import { describe, it, expect } from 'vitest';
import { startTestSite } from '../test-helpers/test-site';
import { Crawler } from './engine';
import { HttpFetcher } from './fetcher';
import type { CrawlOptions, PageResult } from '@seo-crawler/shared';

function opts(origin: string, over: Partial<CrawlOptions> = {}): CrawlOptions {
  return { startUrl: origin + '/', mode: 'spider', maxUrls: 500, maxDepth: 10,
    respectRobots: true, renderJs: false, concurrency: 5, requestTimeoutMs: 5000, ...over };
}

async function run(origin: string, o: CrawlOptions) {
  const fetcher = new HttpFetcher();
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
});
