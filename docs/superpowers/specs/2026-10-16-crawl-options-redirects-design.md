# Настройки краулинга (delay, исключение файлов) и честные цепочки редиректов

**Дата:** 2026-10-16
**Статус:** одобрено в диалоге, ожидает ревью
**Родительский документ:** docs/superpowers/specs/2026-10-13-seo-crawler-design.md
**Зависимости:** не требует подсистем A/B; добавляет поля в `CrawlOptions` и `PageResult` независимо от других спек.

## Контекст и цель

1. Ручная задержка между запросами (сейчас есть только Crawl-delay из robots.txt)
   и исключение типов файлов из обхода — штатные настройки референс-краулеров.
2. `HttpFetcher` использует `redirect: 'follow'` — undici не отдаёт промежуточные
   URL, поэтому `redirectChain` содержит только исходный URL (fetcher.ts:70), а
   циклические редиректы не детектируются. Переходим на ручное следование.

## Настройки краулинга

### Shared-типы (`packages/shared/src/types.ts`)

```ts
CrawlOptions += {
  requestDelayMs: number;        // задержка между стартами запросов, мс
  excludeExtensions: string[];   // расширения, не участвующие в обходе
}
```

Оба поля обязательные; дефолты применяются на границе: `parseCrawlOptions`
(`routes.ts`) подставляет `requestDelayMs = 0` и `excludeExtensions = []`,
если не переданы.

Валидация в `parseCrawlOptions`:

- `requestDelayMs` — целое 0–60000;
- `excludeExtensions` — массив строк, 0–30 элементов, каждый — `^[a-z0-9]{1,10}$`
  (UI приводит к нижнему регистру и отрезает точки).

### Задержка (`engine.ts`)

`throttledFetch` уже разводит старты запросов через общий гейт — теперь задержка:

```ts
const delay = Math.max(
  this.options.respectRobots ? (this.robots?.crawlDelayMs ?? 0) : 0,
  this.options.requestDelayMs,
);
```

`requestDelayMs` применяется всегда, независимо от respectRobots. Механизм
(цепочка обещаний + `lastFetchStart`) не меняется.

### Исключение расширений (`engine.ts`)

Проверка применяется во **всех** местах постановки в очередь: `enqueue` (стартовый
URL, list- и sitemap-режимы, внутренние ссылки) и прямой push финального URL
редиректа в `worker`-цикле (engine.ts:196). Для единства выносится в private-хелпер
`shouldCrawl(url): boolean` (robots-гейт + расширения), который используют оба пути.
Ссылка
остаётся в `internalLinks` результата (и проверяется как broken-link через
`linkStatuses` — см. ниже), но тело не скачивается и в таблицу страниц не
попадает.

Нюанс broken-link: исключённый по расширению URL не фетчился, его статус в
`linkStatuses` отсутствует (`undefined`) — битым не считается, поведение
идентично текущему «таргет вне карты».

## Редиректы: ручное следование (`fetcher.ts`)

`HttpFetcher.fetch` переписывается:

1. Первый запрос — `redirect: 'manual'`.
2. Цикл до `MAX_REDIRECTS = 10`: ответ 301/302/303/307/308 → URL из
   `location`-заголовка (относительный резолвится от текущего), следующий
   запрос — снова manual. Ответ 303 для несемантичных методов нас не касается
   (только GET).
3. Успех: `finalUrl` — URL последнего ответа, тело — его содержимое;
   `redirectChain` — **все промежуточные URL** (без финального), `redirectStatuses`
   — статусы каждого хопа, той же длины, что `redirectChain`. Без редиректов
   оба поля пустые.
4. Цикл: URL уже встречался в цепочке, или хопов больше `MAX_REDIRECTS` →
   `error = 'redirect-loop'`, `status = null`, `redirectChain`/`redirectStatuses`
   — собранная цепочка (для диагностики), тело пустое.

Сетевые ошибки и таймауты классифицируются как раньше (`classifyFetchError` не
меняется); `AbortController` покрывает весь цикл следования.

### Shared-типы и движок

```ts
PageResult += { redirectStatuses: number[]; }   // параллелен redirectChain
IssueKind += 'redirect-loop';
```

- `engine.ts` работает как раньше: `outcome.finalUrl !== item.url` — признак
  редиректа, финальный URL по-прежнему ставится в очередь самостоятельно, тело
  не парсится под URL редиректа.
- `issues.ts`: страница с `error === 'redirect-loop'` попадает в группу
  `redirect-loop` (правило одно, без области-ограничения).
- `routes.ts`: `ISSUE_KINDS += 'redirect-loop'`; `pagesInIssueGroup` повторяет правило.

### Рендерер

`rendered-fetcher.ts` (Playwright) не трогается — браузер следует редиректам сам;
его `redirectChain`-поведение остаётся прежним.

## CSV и фронтенд

- CSV: колонка `redirectStatuses` после `redirectChain` (значения через `; `).
- `CrawlForm`: числовое поле «Задержка между запросами, мс» (≥ 0) и текстовое
  «Исключить расширения» (через запятую, приводится к нижнему регистру, пустые
  элементы отбрасываются).
- i18n: ключ для `redirect-loop` и подписи полей формы (ru/en).

## Тесты

- `fetcher.test.ts`: цепочка 301→302→200 — `redirectChain` из двух промежуточных
  URL, `redirectStatuses = [301, 302]`, тело финального ответа; относительный
  `location`; без редиректа — оба поля пустые; цикл A→B→A — `error='redirect-loop'`,
  `status=null`; > 10 хопов — тоже `redirect-loop`; таймаут покрывает весь цикл.
- `engine.test.ts`: `excludeExtensions` — URL с исключённым расширением не в
  результатах, ссылка остаётся в `internalLinks`, в `linkStatuses` не появляется;
  `requestDelayMs` — интервал между стартами fetch ≥ max(delay, crawlDelay).
- `issues.test.ts`: страница с `error='redirect-loop'` → группа `redirect-loop`.
- `routes.test.ts`: валидация `requestDelayMs` (0–60000) и `excludeExtensions`
  (дефолт, регистр, ≤ 30 элементов), новый kind в фильтре issue.

## Вне скоупа

- Исключение по маскам URL (glob) — только расширения.
- Учёт `redirectChain`/`redirect-loop` в существующем `broken-link` (сейчас
  сетевая ошибка таргета уже делает ссылку битой — циклический редирект таргета
  попадёт через `status = null`).
- Ручное следование в рендерере.
