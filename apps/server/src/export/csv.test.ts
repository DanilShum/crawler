import { describe, it, expect } from 'vitest';
import type { PageResult } from '@seo-crawler/shared';
import { toCsv } from './csv';

const BOM = '\uFEFF';

const HEADER =
  'url,status,error,depth,title,description,meta_robots,canonical,' +
  'content_type,size_bytes,response_time_ms,noindex,nofollow,rendered,' +
  'h1_count,images_without_alt,internal_links,external_links';

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
    ...over,
  };
}

describe('toCsv', () => {
  it('начинается с BOM для Excel', () => {
    expect(toCsv([])).toBe(BOM + HEADER);
  });

  it('первая строка — заголовок колонок, затем по строке на страницу', () => {
    const a = page({ url: 'https://a.test/', title: 'Home' });
    const b = page({ url: 'https://a.test/about', depth: 1, status: 404, noindex: true });
    const expected =
      BOM + HEADER + '\n' +
      'https://a.test/,200,,0,Home,,,,text/html,100,10,false,false,false,0,0,0,0\n' +
      'https://a.test/about,404,,1,,,,,text/html,100,10,true,false,false,0,0,0,0';
    expect(toCsv([a, b])).toBe(expected);
  });

  it('экранирует запятую и кавычку по RFC 4180', () => {
    const p = page({
      url: 'https://a.test/',
      title: 'He said, "hi"',
      description: 'a, b',
    });
    const body = toCsv([p]).slice(BOM.length);
    const dataLine = body.split('\n')[1];
    expect(dataLine).toBe(
      'https://a.test/,200,,0,"He said, ""hi""","a, b",,,text/html,100,10,false,false,false,0,0,0,0',
    );
  });

  it('экранирует перенос строки в значении', () => {
    const p = page({ url: 'https://a.test/', description: 'line1\nline2' });
    const body = toCsv([p]);
    // BOM+header + одна строка данных: перенос внутри кавычек не делит строку
    expect(body.split('\n')).toHaveLength(3);
    expect(body).toContain('"line1\nline2"');
  });

  it('null → пустая строка (status, title, content_type)', () => {
    const p = page({
      url: 'https://a.test/',
      status: null,
      error: 'timeout',
      contentType: null,
    });
    const dataLine = toCsv([p]).split('\n')[1];
    // status пустой, error = timeout, content_type пустой
    expect(dataLine).toBe('https://a.test/,,timeout,0,,,,,,100,10,false,false,false,0,0,0,0');
  });

  it('booleans → true/false; счётчики считаются из массивов', () => {
    const p = page({
      url: 'https://a.test/',
      noindex: true,
      nofollow: true,
      rendered: true,
      headings: { h1: ['A', 'B'], h2: ['C'], h3: [], h4: [], h5: [], h6: [] },
      images: [
        { url: '/a.png', alt: 'x' },
        { url: '/b.png', alt: null },
        { url: '/c.png', alt: null },
      ],
      internalLinks: [{ url: '/i', anchor: null, rel: null }],
      externalLinks: [
        { url: 'https://x.test/', anchor: null, rel: null },
        { url: 'https://y.test/', anchor: null, rel: null },
      ],
    });
    const dataLine = toCsv([p]).split('\n')[1];
    expect(dataLine).toBe(
      'https://a.test/,200,,0,,,,,text/html,100,10,true,true,true,2,2,1,2',
    );
  });
});
