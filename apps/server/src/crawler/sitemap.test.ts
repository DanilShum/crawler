import { describe, it, expect } from 'vitest';
import { startTestSite } from '../test-helpers/test-site';
import { fetchSitemapUrls } from './sitemap';

describe('fetchSitemapUrls', () => {
  it('возвращает URL из urlset на каноническом пути фикстуры', async () => {
    const site = await startTestSite();
    try {
      const urls = await fetchSitemapUrls(`${site.origin}/sitemaps/index.xml`, 5000);
      expect(urls).toContain(`${site.origin}/`);
      expect(urls).toContain(`${site.origin}/about`);
    } finally {
      await site.close();
    }
  });

  it('дефолтный фоллбек-путь /sitemap.xml отдаёт другой urlset (различение авто-обнаружения)', async () => {
    const site = await startTestSite();
    try {
      const urls = await fetchSitemapUrls(`${site.origin}/sitemap.xml`, 5000);
      expect(urls).toEqual([`${site.origin}/only-from-fallback`]);
    } finally {
      await site.close();
    }
  });
});
