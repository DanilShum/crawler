import type { PageResult } from '@seo-crawler/shared';

/** BOM — чтобы Excel корректно определил UTF-8. */
const BOM = '\uFEFF';

const HEADER =
  'url,status,error,depth,title,description,meta_robots,canonical,' +
  'content_type,size_bytes,response_time_ms,noindex,nofollow,rendered,' +
  'h1_count,images_without_alt,internal_links,external_links';

/**
 * Экранирование поля по RFC 4180: значение с запятой, кавычкой или
 * переносом строки обрамляется кавычками, внутренние кавычки удваиваются.
 * null → пустая строка, boolean → true/false.
 */
function escapeField(value: string | number | boolean | null): string {
  if (value === null) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function toRow(p: PageResult): string {
  return [
    p.url,
    p.status,
    p.error,
    p.depth,
    p.title,
    p.description,
    p.metaRobots,
    p.canonical,
    p.contentType,
    p.sizeBytes,
    p.responseTimeMs,
    p.noindex,
    p.nofollow,
    p.rendered,
    p.headings.h1.length,
    p.images.filter((i) => i.alt === null).length,
    p.internalLinks.length,
    p.externalLinks.length,
  ].map(escapeField).join(',');
}

/** Сериализует результаты краула в CSV (BOM + заголовок + строки, LF-разделитель). */
export function toCsv(results: PageResult[]): string {
  return BOM + [HEADER, ...results.map(toRow)].join('\n');
}
