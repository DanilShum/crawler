/** Ключ сортируемых колонок таблицы результатов. */
export type SortKey =
  | 'url'
  | 'status'
  | 'title'
  | 'h1'
  | 'noindex'
  | 'depth'
  | 'contentType'
  | 'wordCount';

/** Декларативное описание колонки таблицы результатов. */
export interface TableColumn {
  key: SortKey;
  labelKey: string;
  sortable: boolean;
  dataTest: string;
  cellDataTest?: string;
  cellClass?: string;
}

export const COLUMNS: TableColumn[] = [
  { key: 'url', labelKey: 'table.url', sortable: true, dataTest: 'th-url', cellDataTest: 'cell-url', cellClass: 'url-cell' },
  { key: 'status', labelKey: 'table.status', sortable: true, dataTest: 'th-status' },
  { key: 'title', labelKey: 'table.title', sortable: true, dataTest: 'th-title', cellDataTest: 'cell-title' },
  { key: 'h1', labelKey: 'table.h1', sortable: true, dataTest: 'th-h1', cellDataTest: 'cell-h1' },
  { key: 'noindex', labelKey: 'table.indexability', sortable: true, dataTest: 'th-noindex' },
  { key: 'depth', labelKey: 'table.depth', sortable: true, dataTest: 'th-depth', cellDataTest: 'cell-depth' },
  { key: 'contentType', labelKey: 'table.contentType', sortable: true, dataTest: 'th-contentType', cellDataTest: 'cell-content-type', cellClass: 'type-cell' },
  { key: 'wordCount', labelKey: 'table.wordCount', sortable: false, dataTest: 'th-wordCount', cellDataTest: 'cell-wordcount' },
];

/** Размер страницы таблицы (клиентская пагинация). */
export const PAGE_LIMIT = 50;
