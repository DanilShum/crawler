# URL-проблемы и проверки метатегов + битые ссылки с целевыми URL

**Дата:** 2026-10-16
**Статус:** одобрено в диалоге, ожидает ревью
**Родительский документ:** docs/superpowers/specs/2026-10-13-seo-crawler-design.md
**Зависимости:** не требует подсистемы A; независима от подсистемы B (поле `Issue.details` не пересекается с её изменениями).

## Контекст и цель

Закрыть вторую группу пробелов сравнения с референсами (Screaming Frog и др.):
проблемные URL, длина метатегов, совпадение Title с H1, и — показать в отчёте
не только страницы-источники битых ссылок, но и сами битые целевые URL.

## Новые проверки (`packages/shared/src/types.ts`, `apps/server/src/crawler/issues.ts`)

```ts
IssueKind += 'non-ascii-url' | 'long-url' | 'dynamic-url'
           | 'title-too-long' | 'title-too-short'
           | 'description-too-long' | 'description-too-short'
           | 'title-equals-h1';
```

| Проверка | Область | Правило |
|---|---|---|
| `non-ascii-url` | все результаты | регулярное выражение «символ вне ASCII (U+0000–U+007F)» по `r.url` |
| `long-url` | все результаты | `r.url.length > 128` |
| `dynamic-url` | все результаты | у `new URL(r.url)` есть query string (`search !== ''`) |
| `title-too-long` | HTML-страницы (`isHtml`) | `title !== null && title.length > 65` |
| `title-too-short` | HTML-страницы | `title !== null && title.length < 30` |
| `description-too-long` | HTML-страницы | `description !== null && description.length > 160` |
| `description-too-short` | HTML-страницы | `description !== null && description.length < 70` |
| `title-equals-h1` | HTML-страницы | `title.trim() === headings.h1[0]?.trim()` при непустых обоих |

Пороги — константы в `issues.ts` (вынести в настройки краула можно позже,
сознательно не делаем). Длина title/description — по символам строки после
trim (существующие значения уже trim в экстракторе).

## Битые ссылки с целевыми URL

```ts
export interface BrokenLinkDetail { sourceUrl: string; targetUrl: string; status: number | null; }
export interface Issue { kind: IssueKind; count: number; sampleUrls: string[]; details?: BrokenLinkDetail[]; }
```

- Поле `details` заполняется **только** для `broken-link`: все пары
  (страница-источник, битый таргет), до 20 записей, порядок — по результатам.
- Битость — существующее правило: статус в карте `s !== undefined && (s === null || s >= 400)`.
- Для остальных kind `details` не выставляется (поле отсутствует — superset
  для WS/REST/CSV, обратно совместимо).

## Проводка (`routes.ts`)

- `ISSUE_KINDS` дополняется восемью новыми kind'ами.
- `pagesInIssueGroup` повторяет правила таблицы выше (каждая страница-результат
  проверяется независимо, страница попадает в группу один раз).
- Таргеты для `details` берутся из `linkStatuses` сессии — без новых данных движка.

## CSV и фронтенд

- CSV: новых колонок нет (проверки отчётные).
- i18n: ключи для 8 новых IssueKind (ru/en).
- Issues-список: при раскрытии группы `broken-link` показывается список
  `details` (source → target, статус); для остальных групп список не меняется.

## Тесты

- `issues.test.ts`: positive/negative на каждую проверку (границы 65/30/160/70 —
  ровно на пороге не попадает: 65 символов не входит, 66 входит; url 128 символов —
  не входит, 129 — входит); `title-equals-h1` с учётом trim; отсутствие битых
  ссылок → `details` отсутствует; > 20 битых пар → обрезка до 20.
- `routes.test.ts`: новые kind'ы принимаются фильтром issue; фильтрация
  `pagesInIssueGroup` согласована с `computeIssues` (совпадение наборов URL).

## Вне скоупа

- Настраиваемые пороги длины метатегов.
- Отдельная проверка «динамический URL с session id» — только факт наличия query.
- Проверки редиректов — отдельная спека (crawl-options-redirects).
