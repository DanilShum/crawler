import type { PageResult } from '@seo-crawler/shared';

/** BOM — чтобы Excel корректно определил UTF-8. */
const BOM = '\uFEFF';

const HEADER =
  'url,status,error,depth,title,description,meta_robots,canonical,' +
  'content_type,size_bytes,response_time_ms,noindex,nofollow,rendered,' +
  'h1_count,images_without_alt,internal_links,external_links,' +
  'og_title,og_description,og_image,twitter_card,hreflang,favicon,word_count,lang';

// Текстовые колонки, значения которых может подставить сайт: их защищаем от
// CSV-формульной инъекции (=, +, - или @ в начале → префикс апострофа).
// Числовые и boolean колонки подстановке не подвержены и не трогаются.
const TEXT_FIELDS = new Set([
  'url',
  'error',
  'title',
  'description',
  'metaRobots',
  'canonical',
  'contentType',
  'ogTitle',
  'ogDescription',
  'ogImage',
  'twitterCard',
  'hreflang',
  'favicon',
  'lang',
]);

/**
 * Экранирование ячейки по RFC 4180: значение с запятой, кавычкой или переносом
 * строки обрамляется кавычками, внутренние кавычки удваиваются. Для текстовых
 * полей дополнительно нейтрализуется формульная инъекция: `=`, `+`, `-` или `@`
 * в начале строки получают префикс апострофа. null → пустая строка, boolean → true/false.
 */
function escapeField(value: string | number | boolean | null, text = false): string {
  if (value === null) return '';
  const s = String(value);
  const safe = text && /^[=+\-@]/.test(s) ? `'${s}` : s;
  if (/[",\n\r]/.test(safe)) {
    return '"' + safe.replace(/"/g, '""') + '"';
  }
  return safe;
}

function toRow(p: PageResult): string {
  return [
    escapeField(p.url, TEXT_FIELDS.has('url')),
    escapeField(p.status),
    escapeField(p.error, TEXT_FIELDS.has('error')),
    escapeField(p.depth),
    escapeField(p.title, TEXT_FIELDS.has('title')),
    escapeField(p.description, TEXT_FIELDS.has('description')),
    escapeField(p.metaRobots, TEXT_FIELDS.has('metaRobots')),
    escapeField(p.canonical, TEXT_FIELDS.has('canonical')),
    escapeField(p.contentType, TEXT_FIELDS.has('contentType')),
    escapeField(p.sizeBytes),
    escapeField(p.responseTimeMs),
    escapeField(p.noindex),
    escapeField(p.nofollow),
    escapeField(p.rendered),
    escapeField(p.headings.h1.length),
    escapeField(p.images.filter((i) => i.alt === null).length),
    escapeField(p.internalLinks.length),
    escapeField(p.externalLinks.length),
    escapeField(p.openGraph?.title ?? null, true),
    escapeField(p.openGraph?.description ?? null, true),
    escapeField(p.openGraph?.image ?? null, true),
    escapeField(p.twitter?.card ?? null, true),
    escapeField(p.hreflang.map((h) => `${h.lang}=${h.href}`).join('; ') || null, true),
    escapeField(p.favicon, true),
    escapeField(p.wordCount),
    escapeField(p.lang, true),
  ].join(',');
}

/** Сериализует результаты краула в CSV (BOM + заголовок + строки, LF-разделитель). */
export function toCsv(results: PageResult[]): string {
  return BOM + [HEADER, ...results.map(toRow)].join('\n');
}
