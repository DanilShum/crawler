import type { PageResult, Issue, IssueKind, HeadingLevel } from '@seo-crawler/shared';

const MAX_SAMPLES = 5;

interface Group {
  count: number;
  sampleUrls: string[];
}

/**
 * Строит отчёт о проблемах по результатам обхода.
 * `linkStatuses` — статусы fetch-нутых URL (null = сетевая ошибка);
 * таргет, отсутствующий в карте, неизвестен и не считается битым.
 * Возвращает только непустые группы, отсортированные по count убыванию.
 */
/**
 * Нарушение порядка заголовков: первый заголовок не h1 или
 * переход на уровень больше предыдущего более чем на 1 (пропуск уровней).
 */
export function isHeadingOrderBroken(order: HeadingLevel[]): boolean {
  if (order.length === 0) return false;
  const level = (h: HeadingLevel): number => Number(h[1]);
  if (level(order[0]) !== 1) return true;
  for (let i = 1; i < order.length; i++) {
    if (level(order[i]) > level(order[i - 1]) + 1) return true;
  }
  return false;
}

export function computeIssues(results: PageResult[], linkStatuses: Map<string, number | null>): Issue[] {
  const groups = new Map<IssueKind, Group>();

  const add = (kind: IssueKind, url: string): void => {
    let g = groups.get(kind);
    if (!g) {
      g = { count: 0, sampleUrls: [] };
      groups.set(kind, g);
    }
    g.count++;
    if (g.sampleUrls.length < MAX_SAMPLES) g.sampleUrls.push(url);
  };

  // missing-h1/missing-alt имеют смысл только для загруженных HTML-страниц:
  // не-HTML (pdf, text/plain) и ошибочные (status=null) страницы не парсились.
  const isHtml = (r: PageResult): boolean =>
    r.status !== null && (r.contentType ?? '').startsWith('text/html');

  // Первый проход: подсчёт повторов title/description/h1
  const titleCounts = new Map<string, number>();
  const descCounts = new Map<string, number>();
  const h1Counts = new Map<string, number>();

  for (const r of results) {
    if (r.title !== null) titleCounts.set(r.title, (titleCounts.get(r.title) ?? 0) + 1);
    if (r.description !== null) descCounts.set(r.description, (descCounts.get(r.description) ?? 0) + 1);
    const h1Key = r.headings.h1.join('\n');
    if (h1Key !== '') h1Counts.set(h1Key, (h1Counts.get(h1Key) ?? 0) + 1);
  }

  for (const r of results) {
    // broken-link: исходящая ссылка ведёт на URL со статусом >= 400 или сетевой ошибкой.
    // Статус самой страницы (например 404) на битость ссылок не влияет.
    const links = [...r.internalLinks, ...r.externalLinks];
    const hasBroken = links.some((l) => {
      const s = linkStatuses.get(l.url);
      // Таргет вне карты (undefined) — неизвестен и битым не считается.
      return s !== undefined && (s === null || s >= 400);
    });
    if (hasBroken) add('broken-link', r.url);

    if (r.title !== null && (titleCounts.get(r.title) ?? 0) > 1) add('duplicate-title', r.url);
    if (r.description !== null && (descCounts.get(r.description) ?? 0) > 1) add('duplicate-description', r.url);
    const h1Key = r.headings.h1.join('\n');
    if (h1Key !== '' && (h1Counts.get(h1Key) ?? 0) > 1) add('duplicate-h1', r.url);

    if (isHtml(r) && r.headings.h1.length === 0) add('missing-h1', r.url);
    if (isHtml(r) && r.images.some((i) => i.alt === null)) add('missing-alt', r.url);
    if (isHtml(r)) {
      if (r.openGraph === null || (r.openGraph.title === null && r.openGraph.description === null)) {
        add('missing-og', r.url);
      }
      if (r.favicon === null) add('missing-favicon', r.url);
      if (r.lang === null) add('missing-lang', r.url);
      if (isHeadingOrderBroken(r.headingOrder)) add('heading-order', r.url);
    }
    if (r.noindex) add('noindex', r.url);
  }

  return [...groups.entries()]
    .map(([kind, g]) => ({ kind, count: g.count, sampleUrls: g.sampleUrls }))
    .sort((a, b) => b.count - a.count);
}
