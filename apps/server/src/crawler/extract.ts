import { load } from 'cheerio';
import type { HeadingLevel } from '@seo-crawler/shared';

export interface ExtractedHtml {
  title: string | null;
  description: string | null;
  metaRobots: string | null;
  canonical: string | null;
  headings: Record<HeadingLevel, string[]>;
  images: { src: string; alt: string | null }[];
  links: { href: string; anchor: string | null; rel: string | null }[];
  jsonLd: unknown[];
}

const HEADING_LEVELS: HeadingLevel[] = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];

export function extractPageData(html: string): ExtractedHtml {
  const $ = load(html);

  const title = $('title').first().text().trim() || null;
  const description = $('meta[name=description]').attr('content') ?? null;
  const metaRobots = $('meta[name=robots]').attr('content') ?? null;
  const canonical = $('link[rel=canonical]').attr('href') ?? null;

  const headings = {} as Record<HeadingLevel, string[]>;
  for (const level of HEADING_LEVELS) {
    const texts: string[] = [];
    $(level).each((_, el) => {
      const text = $(el).text().trim();
      if (text) texts.push(text);
    });
    headings[level] = texts;
  }

  const images = $('img[src]').map((_, el) => {
    const src = $(el).attr('src') ?? '';
    const altAttr = $(el).attr('alt');
    const alt = altAttr === undefined ? null : altAttr.trim() || null;
    return { src, alt };
  }).get();

  const links = $('a[href]').map((_, el) => {
    const href = $(el).attr('href') ?? '';
    const anchor = $(el).text().trim() || null;
    const rel = $(el).attr('rel') ?? null;
    return { href, anchor, rel };
  }).get();

  const jsonLd: unknown[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).html() ?? '';
    try {
      jsonLd.push(JSON.parse(raw));
    } catch {
      // битый JSON пропускается
    }
  });

  return { title, description, metaRobots, canonical, headings, images, links, jsonLd };
}
