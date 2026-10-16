import { load } from 'cheerio';
import type { HeadingLevel, HreflangInfo, OpenGraphInfo, TwitterInfo } from '@seo-crawler/shared';

export interface ExtractedHtml {
  title: string | null;
  description: string | null;
  metaRobots: string | null;
  canonical: string | null;
  headings: Record<HeadingLevel, string[]>;
  images: { src: string; alt: string | null }[];
  links: { href: string; anchor: string | null; rel: string | null }[];
  jsonLd: unknown[];
  openGraph: OpenGraphInfo | null;
  twitter: TwitterInfo | null;
  hreflang: HreflangInfo[];
  favicon: string | null;
  wordCount: number;
  lang: string | null;
  headingOrder: HeadingLevel[];
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

  // og/twitter: первый тег по документу; пустой content → null
  const metaContent = (selector: string): string | null =>
    $(selector).first().attr('content')?.trim() || null;
  const ogTitle = metaContent('meta[property="og:title"]');
  const ogDescription = metaContent('meta[property="og:description"]');
  const ogImage = metaContent('meta[property="og:image"]');
  const ogUrl = metaContent('meta[property="og:url"]');
  // объект создаётся при наличии хотя бы одного тега семейства (спек), даже если
  // весь content пустой — поле null, но факт «тег есть» информативнее отсутствия
  const openGraph: OpenGraphInfo | null =
    $('meta[property="og:title"], meta[property="og:description"], meta[property="og:image"], meta[property="og:url"]').length > 0
      ? { title: ogTitle, description: ogDescription, image: ogImage, url: ogUrl }
      : null;

  const twCard = metaContent('meta[name="twitter:card"]');
  const twTitle = metaContent('meta[name="twitter:title"]');
  const twDescription = metaContent('meta[name="twitter:description"]');
  const twImage = metaContent('meta[name="twitter:image"]');
  const twitter: TwitterInfo | null =
    $('meta[name="twitter:card"], meta[name="twitter:title"], meta[name="twitter:description"], meta[name="twitter:image"]').length > 0
      ? { card: twCard, title: twTitle, description: twDescription, image: twImage }
      : null;

  const hreflang: HreflangInfo[] = [];
  $('link[rel="alternate"][hreflang]').each((_, el) => {
    const lang = $(el).attr('hreflang')?.trim();
    const href = $(el).attr('href')?.trim();
    if (lang && href) hreflang.push({ lang, href }); // без href или с пустым hreflang — мусор, пропускаем
  });

  const favicon =
    $('link[rel~="icon"]').first().attr('href')?.trim() ||
    $('link[rel="apple-touch-icon"]').first().attr('href')?.trim() ||
    null;

  // wordCount: считаем по текстовым нодам (у каждой один родитель — двойного учёта нет);
  // .text() склеивает соседние блочные элементы без разделителей («H1один») — так нельзя
  const bodyClone = $('body').clone();
  bodyClone.find('script, style, noscript, svg').remove();
  let wordCount = 0;
  bodyClone.find('*').addBack().contents().each((_, node) => {
    if (node.type === 'text') {
      wordCount += ((node as { data?: string }).data ?? '').split(/\s+/).filter(Boolean).length;
    }
  });

  const lang = $('html').attr('lang')?.trim() || null;

  // headingOrder: уровни в порядке документа; пустые текстом заголовки не считаются
  const headingOrder: HeadingLevel[] = [];
  $('h1, h2, h3, h4, h5, h6').each((_, el) => {
    if ($(el).text().trim()) headingOrder.push(el.tagName.toLowerCase() as HeadingLevel);
  });

  return {
    title, description, metaRobots, canonical, headings, images, links, jsonLd,
    openGraph, twitter, hreflang, favicon, wordCount, lang, headingOrder,
  };
}
