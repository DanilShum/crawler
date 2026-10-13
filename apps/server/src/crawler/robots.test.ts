import { describe, it, expect } from 'vitest';
import { startTestSite } from '../test-helpers/test-site';
import { parseRobots, fetchRobots } from './robots';

describe('parseRobots', () => {
  it('запрещает URL из Disallow и разрешает остальные', () => {
    const info = parseRobots('https://example.com/robots.txt', 'User-agent: *\nDisallow: /private/');
    expect(info.allowed('https://example.com/private/x')).toBe(false);
    expect(info.allowed('https://example.com/ok')).toBe(true);
  });

  it('конвертирует Crawl-delay из секунд в миллисекунды', () => {
    const info = parseRobots('https://example.com/robots.txt', 'User-agent: *\nCrawl-delay: 5\nDisallow: /x/');
    expect(info.crawlDelayMs).toBe(5000);
  });
});

describe('fetchRobots', () => {
  it('загружает robots.txt и находит sitemap из директивы', async () => {
    const site = await startTestSite();
    try {
      const info = await fetchRobots(site.origin, 5000);
      expect(info.allowed(`${site.origin}/`)).toBe(true);
      expect(info.sitemaps).toContain(`${site.origin}/sitemap.xml`);
    } finally {
      await site.close();
    }
  });
});
