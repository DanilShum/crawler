import { describe, it, expect } from 'vitest';
import type { PageResult, CrawlEvent } from './index';

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
    };
    expect(page.status).toBe(200);
    const ev: CrawlEvent = { type: 'progress', state: 'running', crawled: 1, queued: 0, errors: 0 };
    expect(ev.type).toBe('progress');
  });
});
