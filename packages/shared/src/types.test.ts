import { describe, it, expect } from 'vitest';
import type { PageResult, CrawlEvent, OpenGraphInfo, TwitterInfo, HreflangInfo } from './index';

describe('shared types', () => {
  it('PageResult принимает корректный объект', () => {
    const page: PageResult = {
      url: 'https://example.com/', status: 200, error: null,
      contentType: 'text/html', depth: 0, fetchedAt: new Date().toISOString(),
      responseTimeMs: 10, sizeBytes: 100, rendered: false,
      title: null, description: null, metaRobots: null, canonical: null,
      headings: { h1: [], h2: [], h3: [], h4: [], h5: [], h6: [] },
      images: [], internalLinks: [], externalLinks: [], schemaOrg: [],
      noindex: false, nofollow: false, redirectChain: [],
      openGraph: null, twitter: null, hreflang: [], favicon: null,
      wordCount: 0, lang: null, headingOrder: [],
    };
    expect(page.status).toBe(200);
    const ev: CrawlEvent = { type: 'progress', state: 'running', crawled: 1, queued: 0, errors: 0 };
    expect(ev.type).toBe('progress');
  });

  it('новые поля PageResult типизируются', () => {
    const og: OpenGraphInfo = { title: null, description: null, image: null, url: null };
    const tw: TwitterInfo = { card: null, title: null, description: null, image: null };
    const hf: HreflangInfo[] = [{ lang: 'en', href: 'https://example.com/en' }];
    const p = { openGraph: og, twitter: tw, hreflang: hf, favicon: null,
      wordCount: 0, lang: null, headingOrder: ['h1'] } as unknown as PageResult;
    expect(p.wordCount).toBe(0);
  });
});
