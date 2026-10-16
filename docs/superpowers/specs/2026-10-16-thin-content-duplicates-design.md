# Thin-content и дубли контента (подсистема B)

**Дата:** 2026-10-16
**Статус:** одобрено в диалоге, ожидает ревью
**Родительский документ:** docs/superpowers/specs/2026-10-13-seo-crawler-design.md
**Зависимость:** требует подсистемы A (docs/superpowers/specs/2026-10-16-page-enrichment-design.md) — `wordCount` в `PageResult`.

## Контекст и цель

По декомпозиции 2026-10-16 подсистема B — анализ качества контента: страницы с
малым объёмом текста (thin-content) и дубли контента (одинаковый текст под
разными URL). Обе проверки входят в отчёт issues через существующий механизм
группировки (`computeIssues`).

## Изменения в shared-типах (`packages/shared/src/types.ts`)

```ts
CrawlOptions += { thinContentThreshold: number; }   // слов; обязательное поле
IssueKind += 'thin-content' | 'duplicate-content';
```

Дефолт 100 применяется на границе: `parseCrawlOptions` (apps/server/src/api/routes.ts)
подставляет 100, если поле не передано, и валидирует диапазон 0–10000
(целое). UI всегда отправляет значение явно.

## thin-content (`apps/server/src/crawler/issues.ts`)

Страница попадает в группу, если:

- `isHtml(r)` — та же проверка, что у missing-h1/missing-alt (загруженная HTML-страница);
- `r.wordCount < threshold`.

Порог передаётся в `computeIssues` новым параметром (см. ниже).

## Дубли контента: simhash

**Где считается.** Текст body доступен только в движке при парсинге — `PageResult`
его не хранит. Поэтому simhash вычисляется в движке (`engine.ts`) при парсинге
HTML и хранится во внутреннем публичном поле `textHashes: Map<string, string>`
(url → 64-битный хэш в hex), аналогично существующему `linkStatuses`. В
`PageResult` хэш не попадает.

**Алгоритм** (своя реализация в `apps/server/src/crawler/simhash.ts`, без зависимостей):

1. Текст — тот же, что для `wordCount`: `body` без `script, style, noscript, svg`.
2. Шинглы — последовательности из 3 слов подряд (при < 3 слов шингл один из всех слов).
3. Каждому шинглу — 64-битный FNV-1a хэш.
4. Векторные веса: для каждого бита суммируем +1/-1 по хэшам шинглов; итоговый
   бит = 1, если сумма > 0.

**Сравнение** (`issues.ts`): расстояние Хэмминга ≤ 3 → дубли. Алгоритм — попарное
сравнение O(N²) с XOR + подсчётом битов; N ограничено maxUrls ≤ 10000, XOR+popcount
дешевы — оптимизация не требуется.

**Группа в отчёте:** все участники дубль-группы, кроме первой страницы группы
(первой = минимальный url в группе — детерминированный «эталон»).

## Частотный анализ слов (ключевые слова страницы)

Лёгкий аналог вкладки «Words» референс-краулеров: топ слов текста страницы.
Считается там же, где `wordCount` (экстрактор, `apps/server/src/crawler/extract.ts`),
по тому же тексту (`body` без `script, style, noscript, svg`):

1. Текст приводится к нижнему регистру, знаки препинания заменяются на пробелы.
2. Слова короче 2 символов и числа отбрасываются.
3. Стоп-слова отбрасываются — преднастроенный список ru+en константой в
   `extract.ts` (~150 слов: предлоги, союзы, местоимения, `the/and/is` и т.п.).
4. `PageResult += topWords: { word: string; count: number }[]` — топ-20 слов по
   убыванию count, при равенстве — алфавит (детерминированный вывод).

Отображение — блок «Ключевые слова» в `PageDetails` (список «слово — N»);
в CSV и таблицу не выносим, чтобы не перегружать. i18n: подпись блока (ru/en).

## Сигнатура computeIssues

```ts
computeIssues(
  results: PageResult[],
  linkStatuses: Map<string, number | null>,
  extras?: { textHashes?: Map<string, string>; thinContentThreshold?: number },
): Issue[]
```

- `thinContentThreshold` не передан (например, в старых тестах) → дефолт 100.
- `textHashes` не передан → проверка duplicate-content не выполняется.

## Проводка (`session-manager.ts`, `routes.ts`)

- `session-manager` в `recomputeIssues` передаёт `crawler.textHashes` и
  `options.thinContentThreshold`.
- `routes.ts`: `ISSUE_KINDS` дополняется `'thin-content' | 'duplicate-content'`;
  `pagesInIssueGroup` повторяет правила групп (thin — по wordCount; duplicate —
  по принадлежности дубль-группе, пересчитанной из `crawler.textHashes` — для
  этого текстовые хэши выносятся в helper, общий для issues и routes).
- `parseCrawlOptions` валидирует `thinContentThreshold` (см. выше).

## CSV и фронтенд

- CSV: новых колонок нет (проверки отчётные, данные — wordCount уже добавлен подсистемой A).
- i18n: ключи для двух новых IssueKind (ru/en).
- Issues-список и фильтр «страницы по issue» работают через существующий механизм.

## Тесты

- `simhash.test.ts`: идентичные тексты → расстояние 0; малая правка (пара слов) → ≤ 3;
  разные тексты → расстояние > 3; детерминированность (одинаковый вход → одинаковый хэш).
- `extract.test.ts`: topWords — регистронезависимость, отбрасывание стоп-слов и
  коротких слов/чисел, сортировка по count/алфавиту, максимум 20 записей.
- `issues.test.ts`: thin-content — positive (wordCount < порога) и negative (равен порогу);
  duplicate-content — группа из двух идентичных страниц (в отчёте одна, эталон не попал);
  отсутствие `textHashes` → duplicate-content не возникает.
- `engine.test.ts`: `textHashes` наполняется для HTML-страниц и пуст для не-HTML/ошибочных.
- `routes.test.ts`: валидация thinContentThreshold (дефолт, диапазон), новые ISSUE_KINDS
  принимаются фильтром issue.

## Вне скоупа

- Настраиваемые пороги близости simhash (3 — константа).
- Биграммы, лемматизация, семантический анализ ключевых слов — только частотный топ.
- Дубли по title/description уже есть; пересечения групп не дедуплицируются.
- Персистентность и скорость — подсистема C.
- Орфография/грамматика — docs/superpowers/specs/2026-10-16-feature-backlog-design.md.
