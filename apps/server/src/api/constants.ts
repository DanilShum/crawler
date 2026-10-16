/** Числовые поля POST /api/crawl с границами валидации. */
export interface NumericField {
  name: 'maxUrls' | 'maxDepth' | 'concurrency' | 'requestTimeoutMs';
  min: number;
  max: number;
}

export const NUMERIC_FIELDS: NumericField[] = [
  { name: 'maxUrls', min: 1, max: 10_000 },
  { name: 'maxDepth', min: 0, max: 20 },
  { name: 'concurrency', min: 1, max: 20 },
  { name: 'requestTimeoutMs', min: 1000, max: 120_000 },
];

/** Вкладки GET /pages. */
export const TABS = ['internal', 'external', 'images'] as const;
