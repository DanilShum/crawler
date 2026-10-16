# Генерация sitemap.xml и панель robots.txt

**Дата:** 2026-10-16
**Статус:** одобрено в диалоге, ожидает ревью
**Родительский документ:** docs/superpowers/specs/2026-10-13-seo-crawler-design.md
**Зависимости:** не требует подсистем A/B/C (нумерация — по порядку реализации, не по связи).

## Контекст и цель

Краулер только читает sitemap и robots.txt. Закрываем вторую половину функции
«Работа с техническими файлами»: генерация sitemap.xml по результатам краула и
просмотр/разбор robots.txt в UI.

## Часть 1: генерация sitemap.xml

### Endpoint (`apps/server/src/api/routes.ts`)

```
GET /api/crawl/:id/sitemap.xml
```

- Сессия не найдена → 404 `{ error: 'NOT_FOUND' }` (как у соседних endpoint'ов).
- Ответ: `content-type: application/xml; charset=utf-8`,
  `content-disposition: attachment; filename="sitemap-<id>.xml"` — скачивание.
- Критерии включения страницы: `status === 200 && contentType.startsWith('text/html') && !noindex && error === null`.
- Ноль подходящих страниц → 200 с пустым `<urlset>` (валидный sitemap).
- Генерация — `apps/server/src/export/sitemap-xml.ts`, чистая функция
  `toSitemapXml(results: PageResult[]): string` (по образцу `csv.ts`).

### Формат

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://example.com/page</loc>
    <lastmod>2026-10-16T10:00:00.000Z</lastmod>
  </url>
</urlset>
```

- `loc` — `r.url` с XML-экранированием `& < > " '` (самописный эскейпер рядом
  с csv-эскейпером).
- `lastmod` — `r.fetchedAt` (уже ISO/UTC).
- Порядок: `url.localeCompare` (детерминированный вывод).

### Фронтенд

- Кнопка «Скачать sitemap.xml» видна, когда краул завершён (`state !== 'running'`):
  обычная ссылка `<a href={...} download>` на endpoint, без нового стора.
- Рядом с существующей кнопкой экспорта CSV.
- i18n: подпись кнопки (ru/en).

## Часть 2: панель robots.txt

### Движок (`engine.ts`)

- robots.txt уже фетчится при respectRobots и в sitemap-режиме. После фетча
  движок запоминает содержимое: `RobotsInfo` (`robots.ts`) дополняется полем
  `content: string`.
- Счётчик `robotsExcluded`: движок увеличивает его в `process()`, когда страница
  отсечена `robotsAllowed()` (сейчас там просто `return`).
- Новое событие движка: `{ type: 'robots', content: string; sitemaps: string[]; crawlDelayMs: number }`
  — эмитится сразу после фетча robots. При respectRobots=false и mode≠sitemap
  robots не фетчится и событие не эмитится (панель в UI не показывается).

### Проводка событий (`session-manager.ts`, WS)

```ts
CrawlEvent += { type: 'robots'; content: string; sitemaps: string[]; crawlDelayMs: number };
// progress-событие расширяется: { ...; excluded: number }  (superset)
```

- `session-manager` сохраняет robots-инфо сессии и пробрасывает событие
  подписчикам; `CrawlProgress += excluded: number`.
- Сессия хранит последнее robots-инфо: REST `GET /api/crawl/:id/robots` возвращает
  `{ content, sitemaps, crawlDelayMs, excluded }` (для восстановления после
  перезагрузки страницы); robots-инфо отсутствует → 404 `NOT_FOUND`.

### Фронтенд

- Новый компонент `RobotsPanel` (появляется после события robots):
  - содержимое robots.txt в `<pre>`;
  - сводка: обнаруженные Sitemap-директивы, Crawl-delay, число исключённых страниц;
  - счётчик исключённых берётся из прогресса (`excluded`).
- i18n: подписи панели (ru/en).

## Совместимость

- `CrawlEvent`/`progress` расширяются новыми полями/вариантами — существующие
  клиенты получают superset, форма старых событий не меняется.
- CSV не меняется.

## Тесты

- `sitemap-xml.test.ts`: фильтрация (200+html+без noindex vs 301/404/pdf/noindex),
  экранирование `&` в URL, пустой набор → пустой urlset, порядок сортировки.
- `routes.test.ts`: 404 для неизвестной сессии; заголовки ответа; валидный XML
  на фикстуре; `GET /robots` — 404 без robots и 200 с ним.
- `engine.test.ts`: событие `robots` эмитится при respectRobots и не эмитится без него;
  `robotsExcluded` растёт на запрещённых robots.txt страницах.
- `session-manager.test.ts`: событие robots пробрасывается подписчикам;
  `excluded` в progress.
- Web: RobotsPanel рендерит содержимое и сводку; кнопка sitemap видна только
  на завершённом крауле; presence новых i18n-ключей (ru/en).

## Вне скоупа

- Симуляция «доступен ли URL по правилам robots» (ввод произвольного URL) —
  только факт-панель.
- Разбиение sitemap на части при > 50000 URL (лимит maxUrls = 10000 снимает вопрос).
- lastmod из Last-Modified заголовка — только fetchedAt.
