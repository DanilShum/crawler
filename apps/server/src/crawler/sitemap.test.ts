import { describe, it, expect } from 'vitest';
import { startTestSite } from '../test-helpers/test-site';
import { fetchSitemapUrls } from './sitemap';

describe('fetchSitemapUrls', () => {
  it('возвращает URL из urlset', async () => {
    const site = await startTestSite();
    try {
      const urls = await fetchSitemapUrls(`${site.origin}/sitemap.xml`, 5000);
      expect(urls).toContain(`${site.origin}/`);
      expect(urls).toContain(`${site.origin}/about`);
    } finally {
      await site.close();
    }
  });
});
