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
