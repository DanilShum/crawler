import { describe, it, expect } from 'vitest';
import type { PageResult, Issue } from '@seo-crawler/shared';
import { computeIssues } from './issues';

const BASE = 'https://site.test';

function page(over: Partial<PageResult> & { url: string }): PageResult {
  return {
    status: 200,
    error: null,
    contentType: 'text/html',
    depth: 0,
    fetchedAt: '2026-01-01T00:00:00.000Z',
    responseTimeMs: 10,
    sizeBytes: 100,
    rendered: false,
    title: null,
    description: null,
    metaRobots: null,
    canonical: null,
    headings: { h1: [], h2: [], h3: [], h4: [], h5: [], h6: [] },
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
    ...over,
  };
}

const imgNoAlt = { url: `${BASE}/img.png`, alt: null };

function makeResults(): PageResult[] {
  return [
    // A и B: одинаковые title/description/h1, ссылка на битый /missing, картинка без alt
    page({
      url: `${BASE}/a`,
      title: 'Dup Title',
      description: 'Dup Desc',
      headings: { h1: ['Same H1'], h2: [], h3: [], h4: [], h5: [], h6: [] },
      images: [imgNoAlt],
      internalLinks: [{ url: `${BASE}/missing`, anchor: 'missing', rel: null }],
    }),
    page({
      url: `${BASE}/b`,
      title: 'Dup Title',
      description: 'Dup Desc',
      headings: { h1: ['Same H1'], h2: [], h3: [], h4: [], h5: [], h6: [] },
      images: [imgNoAlt],
      internalLinks: [{ url: `${BASE}/missing`, anchor: 'missing', rel: null }],
    }),
    // C: без h1, noindex, картинка без alt
    page({
      url: `${BASE}/c`,
      title: 'Unique Title',
      description: 'Unique Desc',
      images: [imgNoAlt],
      noindex: true,
    }),
    // D: страница со статусом 404 — сама не даёт broken-link;
    // исходящая внешняя ссылка не fetch-нута (нет в linkStatuses) — тоже не битая
    page({
      url: `${BASE}/d`,
      status: 404,
      error: null,
      headings: { h1: ['Not Found'], h2: [], h3: [], h4: [], h5: [], h6: [] },
      internalLinks: [{ url: `${BASE}/valid`, anchor: 'ok', rel: null }],
      externalLinks: [{ url: 'https://other.test/not-fetched', anchor: 'nf', rel: null }],
    }),
  ];
}

function linkStatuses(): Map<string, number | null> {
  return new Map([
    [`${BASE}/missing`, 404],
    [`${BASE}/valid`, 200],
  ]);
}

function byKind(issues: Issue[]): Map<string, Issue> {
  return new Map(issues.map((i) => [i.kind, i]));
}

describe('computeIssues', () => {
  it('возвращает все 7 групп с верными count и sampleUrls', () => {
    const issues = computeIssues(makeResults(), linkStatuses());
    const by = byKind(issues);

    expect(issues).toHaveLength(7);

    // broken-link: только страницы A и B, чьи исходящие ведут на 404;
    // страница D (статус 404) и её unfetched-ссылка не засчитываются
    expect(by.get('broken-link')).toEqual({ kind: 'broken-link', count: 2, sampleUrls: [`${BASE}/a`, `${BASE}/b`] });
    expect(by.get('duplicate-title')).toEqual({ kind: 'duplicate-title', count: 2, sampleUrls: [`${BASE}/a`, `${BASE}/b`] });
    expect(by.get('duplicate-description')).toEqual({ kind: 'duplicate-description', count: 2, sampleUrls: [`${BASE}/a`, `${BASE}/b`] });
    expect(by.get('duplicate-h1')).toEqual({ kind: 'duplicate-h1', count: 2, sampleUrls: [`${BASE}/a`, `${BASE}/b`] });
    expect(by.get('missing-h1')).toEqual({ kind: 'missing-h1', count: 1, sampleUrls: [`${BASE}/c`] });
    expect(by.get('missing-alt')).toEqual({ kind: 'missing-alt', count: 3, sampleUrls: [`${BASE}/a`, `${BASE}/b`, `${BASE}/c`] });
    expect(by.get('noindex')).toEqual({ kind: 'noindex', count: 1, sampleUrls: [`${BASE}/c`] });
  });

  it('сортирует по count убыванию, sampleUrls не длиннее 5', () => {
    const issues = computeIssues(makeResults(), linkStatuses());

    for (let i = 1; i < issues.length; i++) {
      expect(issues[i].count).toBeLessThanOrEqual(issues[i - 1].count);
    }
    for (const issue of issues) {
      expect(issue.sampleUrls.length).toBeLessThanOrEqual(5);
    }
  });

  it('возвращает пустой список для пустых результатов', () => {
    expect(computeIssues([], new Map())).toEqual([]);
  });

  it('ограничивает sampleUrls пятью первыми URL по порядку обхода', () => {
    const results = Array.from({ length: 6 }, (_, i) =>
      page({ url: `${BASE}/p${i}`, noindex: true }),
    );
    const issues = computeIssues(results, new Map());
    const noindex = byKind(issues).get('noindex');

    expect(noindex?.count).toBe(6);
    expect(noindex?.sampleUrls).toEqual([`${BASE}/p0`, `${BASE}/p1`, `${BASE}/p2`, `${BASE}/p3`, `${BASE}/p4`]);
  });

  it('не даёт пустых групп: одиночные title/h1/description не считаются дублями', () => {
    const results = [
      page({
        url: `${BASE}/only`,
        title: 'Solo',
        description: 'Solo Desc',
        headings: { h1: ['Solo H1'], h2: [], h3: [], h4: [], h5: [], h6: [] },
      }),
    ];
    const issues = computeIssues(results, new Map());

    expect(issues).toEqual([]);
  });

  it('missing-h1/missing-alt не считаются для не-HTML и ошибочных страниц', () => {
    // 404 с text/plain (как /missing в фикстуре): HTML не парсится — missing-h1 нет.
    const txt404 = page({ url: `${BASE}/txt404`, status: 404, contentType: 'text/plain; charset=utf-8' });
    // Сетевая ошибка (status=null, без контента): тоже без missing-h1/missing-alt.
    const errPage = page({
      url: `${BASE}/err`,
      status: null,
      error: 'dns',
      contentType: null,
      images: [imgNoAlt],
      headings: { h1: ['Not really'], h2: [], h3: [], h4: [], h5: [], h6: [] },
    });
    // Контрольная HTML-страница без h1 — единственная, кто даёт missing-h1.
    const htmlPage = page({ url: `${BASE}/html`, contentType: 'text/html; charset=utf-8' });

    const issues = computeIssues([txt404, errPage, htmlPage], new Map());
    const by = byKind(issues);

    expect(by.get('missing-h1')).toEqual({ kind: 'missing-h1', count: 1, sampleUrls: [`${BASE}/html`] });
    expect(by.get('missing-alt')).toBeUndefined();
  });
});
