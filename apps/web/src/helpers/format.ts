import type { PageResult } from '@seo-crawler/shared';

/** CSS-класс бейджа по HTTP-статусу страницы. */
export function statusClass(page: PageResult): string {
  if (page.status === null) return 'badge-error';
  if (page.status < 300) return 'badge-ok';
  if (page.status < 400) return 'badge-redirect';
  return 'badge-error';
}

/** Человекочитаемый размер в байтах. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
