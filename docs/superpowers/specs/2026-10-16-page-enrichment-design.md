# Обогащение данных страницы: Open Graph, Twitter, hreflang, favicon, wordCount, lang

**Дата:** 2026-10-16
**Статус:** одобрено в диалоге, ожидает ревью
**Родительский документ:** docs/superpowers/specs/2026-10-13-seo-crawler-design.md

## Контекст и цель

Краулер (план 2026-10-13 выполнен) собирает базовый SEO-набор: title, description,
meta robots, canonical, заголовки, картинки/alt, ссылки, Schema.org. Главный сценарий
использования — SEO-аудит сайтов; выбранное направление — глубина сбора данных
(подсистема A декомпозиции 2026-10-16: A → B → C → D).

Цель: расширить сбор данных мета-информацией и сразу добавить новые проверки-issues
(решение пользователя: не откладывать отчёты на потом).

## Изменения в shared-типах (`packages/shared/src/types.ts`)

```ts
export interface OpenGraphInfo { title: string | null; description: string | null; image: string | null; url: string | null; }
export interface TwitterInfo { card: string | null; title: string | null; description: string | null; image: string | null; }
export interface HreflangInfo { lang: string; href: string; }

PageResult += {
  openGraph: OpenGraphInfo | null;   // null если нет ни одного og:* тега
  twitter: TwitterInfo | null;       // null если нет ни одного twitter:* тега
  hreflang: HreflangInfo[];
  favicon: string | null;
  wordCount: number;
  lang: string | null;
  headingOrder: HeadingLevel[];      // уровни заголовков в порядке документа
}

IssueKind += 'missing-og' | 'missing-favicon' | 'missing-lang' | 'heading-order';
```

Объект `openGraph`/`twitter` не null, если встречен хотя бы один тег семейства;
отсутствующие отдельные поля внутри — null.

## Экстракция (`apps/server/src/crawler/extract.ts`)

- `openGraph` — `meta[property=og:title|og:description|og:image|og:url]`, content → trim.
- `twitter` — `meta[name=twitter:card|twitter:title|twitter:description|twitter:image]`.
- `hreflang` — `link[rel=alternate][hreflang]`; hreflang и href обязательны, `hreflang="x-default"`
  сохраняется как обычная запись.
- `favicon` — первый из `link[rel~=icon]`, затем `link[rel=apple-touch-icon]`; href как есть.
- `wordCount` — текст `body`, из которого удалены `script, style, noscript, svg`;
  слова считаются по whitespace (`.split(/\s+/)` с фильтром пустых).
- `lang` — атрибут `lang` у `<html>`, trim или null.
- `headingOrder: HeadingLevel[]` — новая выходная структура экстрактора: уровни заголовков
  **в порядке документа** (сейчас `headings` хранится поуровнево, порядок теряется).
  В `PageResult` попадает как `headingOrder` (компактный массив уровней).

## Новые проверки (`apps/server/src/crawler/issues.ts`)

Проверки выполняются по уже собранному `PageResult`, группировка через существующий
Map-механизм, `sampleUrls` ≤ 5, сортировка по count — без изменений.

- **`missing-og`** — страница без `og:title` и без `og:description`.
- **`missing-favicon`** — `favicon === null`.
- **`missing-lang`** — `lang === null` (пустая строка после trim тоже null).
- **`heading-order`** — по `headingOrder` документа:
  1. первый заголовок страницы — не `h1`, **или**
  2. переход с уровня N на M, где M > N + 1 (пропуск уровней).
  Нарушение — boolean на страницу; страница попадает в группу один раз.

`thin-content` (по wordCount) — сознательно не здесь: войдёт в подсистему B
с настраиваемым порогом.

## Экспорт CSV (`apps/server/src/export/`)

Новые колонки после существующих: `ogTitle, ogDescription, ogImage, twitterCard,
hreflang, favicon, wordCount, lang`.

- `ogTitle/ogDescription/ogImage` — из `openGraph` (пусто при null-объекте/поле).
- `twitterCard` — из `twitter.card`.
- `hreflang` — строки `lang=href`, разделитель `; `.
- Экранирование — существующий самописный csv-эскейпер.

## Фронтенд (`apps/web/`)

- **PageDetails** (`apps/web/src/components/PageDetails.tsx`): блоки «Open Graph»
  и «Twitter» (поля таблицей, прочерки при отсутствии), список hreflang,
  favicon с превью `<img>` (лениво, с обработкой ошибки загрузки), wordCount и lang
  в блок метаданных.
- **ResultsTable**: новая колонка «Слова» (wordCount); остальные новые данные —
  только в деталях, таблицу не перегружать.
- **i18n** (`apps/web/src/locales/`): ключи для новых блоков и 4 новых IssueKind
  (ru/en).
- Issues-список отображает новые группы через существующий механизм — нужна только
  локализация kind'ов.

Совместимость: WS-события и REST-ответы не меняют форму — `PageResult` расширяется
новыми полями; старые клиенты получают superset.

## Тесты

- `extract.test.ts`: фикстура с полным набором (OG/Twitter/hreflang/favicon/lang,
  порядок заголовков h1→h3→h3) и страница без них (null-объекты, пустые массивы,
  wordCount=0); wordCount не считает текст внутри script/style.
- `issues.test.ts`: каждая новая группа — positive и negative кейс; для
  `heading-order`: h1→h3 (ok), h1→h3→h4 (нарушение), h2 первым (нарушение),
  нет заголовков (не нарушение).
- CSV-тест: новые колонки, hreflang-сериализация, экранирование og-описания с кавычкой.
- Web: PageDetails рендерит OG/Twitter/hreflang/favicon и прочерки при null;
  Presence новых ключей i18n (ru/en).

## Вне скоупа

- `thin-content`, дубли контента (simhash) — подсистема B.
- Скорость движка и персистентность — подсистема C.
- Diff краулов, фильтры таблицы — подсистема D.
- Валидация значений og:url/lang (сбор «как есть», без нормализации).
