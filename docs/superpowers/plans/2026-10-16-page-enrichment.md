# Page Enrichment (подсистема A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Расширить сбор данных страницы (Open Graph, Twitter, hreflang, favicon, wordCount, lang, порядок заголовков) и добавить 4 новые проверки-issues.

**Architecture:** Новые поля проходят существующий конвейер: `extract.ts` (cheerio) → `engine.ts` (прокидка в `PageResult`) → `issues.ts` (отчёты) / `csv.ts` (экспорт) / фронтенд (детали страницы, таблица, i18n). Типы живут в `packages/shared`, WS/REST формы не меняются (superset).

**Tech Stack:** TypeScript, cheerio, vitest, Vue 3 TSX, vue-i18n.

**Spec:** `docs/superpowers/specs/2026-10-16-page-enrichment-design.md`

## Global Constraints

- Node >= 20, npm workspaces; новые зависимости запрещены.
- Тесты vitest, названия тестов — на русском, код/идентификаторы — English.
- Тесты не ходят в сеть (внешние хосты — через `NoNetworkFetcher`/инлайн-HTML).
- Стиль кода — под существующие файлы: в `extract.ts`/`issues.ts` комментарии по-русски, JSDoc на экспортируемых функциях.
- Пустая строка после trim трактируется как null (паттерн `?.trim() || null` из `extract.ts:20`).
- CSV-колонки с site-controlled текстом защищаются от формульной инъекции (`TEXT_FIELDS`).

## Review Focus

1. **`content=""` у og/twitter тегов** — пустая строка должна давать null в поле (и `openGraph === null`, если все поля пустые), а не `""`. Тест: Task 2.
2. **hreflang без href / с пустым hreflang** — запись пропускается, массив не содержит мусора. Тест: Task 2.
3. **Дублированные og-теги** (два `og:title`) — берётся первый по документу. Тест: Task 2.
4. **CSV-инъекция через og:description** (site-controlled текст, начинается с `=`) — апостроф-префикс. Тест: Task 4.
5. **Не-HTML/ошибочные страницы** (`status=null`, pdf) — `wordCount=0`, `openGraph=null`, и они НЕ попадают в `missing-og/missing-favicon/missing-lang/heading-order` (guard `isHtml`). Тест: Task 3.

---

### Task 1: Shared-типы и компилируемость движка

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `apps/server/src/crawler/engine.ts` (только `baseResult`, ~строка 247)
- Test: `packages/shared/src/types.test.ts`

**Interfaces:**
- Consumes: существующий `PageResult`, `IssueKind`, `HeadingLevel`.
- Produces: `OpenGraphInfo`, `TwitterInfo`, `HreflangInfo`; поля `PageResult.openGraph/twitter/hreflang/favicon/wordCount/lang/headingOrder`; `IssueKind += 'missing-og' | 'missing-favicon' | 'missing-lang' | 'heading-order'`. Всё следующее опирается на эти имена.

- [ ] **Step 1: Добавить типы в `packages/shared/src/types.ts`**

После `export type HeadingLevel = ...`:

```ts
export interface OpenGraphInfo { title: string | null; description: string | null; image: string | null; url: string | null; }
export interface TwitterInfo { card: string | null; title: string | null; description: string | null; image: string | null; }
export interface HreflangInfo { lang: string; href: string; }
```

В `PageResult` после `redirectChain: string[];`:

```ts
  openGraph: OpenGraphInfo | null;  // null если нет ни одного og:* тега
  twitter: TwitterInfo | null;      // null если нет ни одного twitter:* тега
  hreflang: HreflangInfo[];
  favicon: string | null;
  wordCount: number;                // слова видимого текста body
  lang: string | null;              // <html lang>
  headingOrder: HeadingLevel[];     // уровни заголовков в порядке документа
```

В `IssueKind` добавить в конец объединения:

```ts
  | 'missing-og' | 'missing-favicon' | 'missing-lang' | 'heading-order';
```

- [ ] **Step 2: Дефолты в `engine.ts:baseResult`** — чтобы движок компилировался до прокидки экстракции (Task 2 заполнит их реальными данными):

```ts
      redirectChain: [],
      openGraph: null,
      twitter: null,
      hreflang: [],
      favicon: null,
      wordCount: 0,
      lang: null,
      headingOrder: [],
```

- [ ] **Step 3: Smoke-тест типов** — в `packages/shared/src/types.test.ts` добавить:

```ts
import type { OpenGraphInfo, TwitterInfo, HreflangInfo, PageResult } from './types';

test('новые поля PageResult типизируются', () => {
  const og: OpenGraphInfo = { title: null, description: null, image: null, url: null };
  const tw: TwitterInfo = { card: null, title: null, description: null, image: null };
  const hf: HreflangInfo[] = [{ lang: 'en', href: 'https://example.com/en' }];
  const p = { openGraph: og, twitter: tw, hreflang: hf, favicon: null,
    wordCount: 0, lang: null, headingOrder: ['h1'] } as unknown as PageResult;
  expect(p.wordCount).toBe(0);
});
```

- [ ] **Step 4: Запустить тесты** — `npm test`
Expected: все три пакета PASS (движок компилируется с дефолтами).

- [ ] **Step 5: Commit**

```bash
git add packages/shared apps/server/src/crawler/engine.ts
git commit -m "feat: типы OpenGraph/Twitter/Hreflang и новые поля PageResult"
```

---

### Task 2: Экстракция новых полей + прокидка в движке

**Files:**
- Modify: `apps/server/src/crawler/extract.ts`
- Modify: `apps/server/src/crawler/engine.ts` (блок присвоения `parsed.*`, ~строки 210-218)
- Test: `apps/server/src/crawler/extract.test.ts`

**Interfaces:**
- Consumes: типы из Task 1 (`OpenGraphInfo`, `TwitterInfo`, `HreflangInfo`), `HeadingLevel`.
- Produces: `ExtractedHtml` с полями `openGraph/twitter/hreflang/favicon/wordCount/lang/headingOrder` — Task 3 читает их из `PageResult`, Task 5 из CSV/UI.

- [ ] **Step 1: Падающие тесты в `extract.test.ts`**

Стиль файла — инлайн-HTML через `extractPageData(html)` (см. существующие тесты). Добавить:

```ts
describe('extractPageData: обогащение', () => {
  const full = `<!doctype html><html lang="ru"><head>
    <title>Т</title>
    <meta property="og:title" content="OG Title">
    <meta property="og:description" content="OG Desc">
    <meta property="og:image" content="https://s.example/og.png">
    <meta property="og:url" content="https://s.example/">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="TW">
    <link rel="alternate" hreflang="en" href="https://s.example/en/">
    <link rel="alternate" hreflang="x-default" href="https://s.example/">
    <link rel="icon" href="/favicon.ico">
    <link rel="alternate" hreflang="de">
  </head><body><h1>H1</h1><p>один два три</p><h3>H3 без H2</h3>
    <script>var a = "не считаем слова script text";</script><style>.a{}</style>
  </body></html>`;

  it('извлекает OG, twitter, hreflang, favicon, lang, headingOrder', () => {
    const d = extractPageData(full);
    expect(d.openGraph).toEqual({ title: 'OG Title', description: 'OG Desc', image: 'https://s.example/og.png', url: 'https://s.example/' });
    expect(d.twitter).toEqual({ card: 'summary_large_image', title: 'TW', description: null, image: null });
    expect(d.hreflang).toEqual([
      { lang: 'en', href: 'https://s.example/en/' },
      { lang: 'x-default', href: 'https://s.example/' },
    ]); // запись без href пропущена
    expect(d.favicon).toBe('/favicon.ico');
    expect(d.lang).toBe('ru');
    expect(d.headingOrder).toEqual(['h1', 'h3']);
  });

  it('wordCount не считает script/style и пустые токены', () => {
    expect(extractPageData(full).wordCount).toBe(6); // Т + один два три + H3 без H2
  });

  it('пустой content даёт null, дубль og:title — первый по документу', () => {
    const html = `<html><head><meta property="og:title" content=""><meta property="og:title" content="Second">
      <meta name="twitter:card" content=""></head><body></body></html>`;
    const d = extractPageData(html);
    expect(d.openGraph).toEqual({ title: null, description: null, image: null, url: null }); // content="" → null
    expect(d.twitter).toEqual({ card: null, title: null, description: null, image: null }); // объект есть, поля null
  });

  it('страница без мета-данных: null-объекты, пустые массивы, wordCount=0', () => {
    const d = extractPageData('<html><head><title>x</title></head></html>');
    expect(d.openGraph).toBeNull();
    expect(d.twitter).toBeNull();
    expect(d.hreflang).toEqual([]);
    expect(d.favicon).toBeNull();
    expect(d.lang).toBeNull();
    expect(d.wordCount).toBe(0);
    expect(d.headingOrder).toEqual([]);
  });
});
```

- [ ] **Step 2: Запустить, убедиться в падении**

Run: `cd apps/server && npx vitest run src/crawler/extract.test.ts`
Expected: FAIL — поля `undefined`.

- [ ] **Step 3: Реализовать в `extract.ts`**

Расширить `ExtractedHtml` (импортировать `OpenGraphInfo, TwitterInfo, HreflangInfo` из shared). Добавить перед `return`:

```ts
  // og/twitter: первый тег по документу; пустой content → null
  const metaContent = (selector: string): string | null =>
    $(selector).first().attr('content')?.trim() || null;
  const ogTitle = metaContent('meta[property="og:title"]');
  const ogDescription = metaContent('meta[property="og:description"]');
  const ogImage = metaContent('meta[property="og:image"]');
  const ogUrl = metaContent('meta[property="og:url"]');
  const openGraph: OpenGraphInfo | null =
    [ogTitle, ogDescription, ogImage, ogUrl].some((v) => v !== null)
      ? { title: ogTitle, description: ogDescription, image: ogImage, url: ogUrl }
      : null;

  const twCard = metaContent('meta[name="twitter:card"]');
  const twTitle = metaContent('meta[name="twitter:title"]');
  const twDescription = metaContent('meta[name="twitter:description"]');
  const twImage = metaContent('meta[name="twitter:image"]');
  const twitter: TwitterInfo | null =
    [twCard, twTitle, twDescription, twImage].some((v) => v !== null)
      ? { card: twCard, title: twTitle, description: twDescription, image: twImage }
      : null;

  const hreflang: HreflangInfo[] = [];
  $('link[rel="alternate"][hreflang]').each((_, el) => {
    const lang = $(el).attr('hreflang')?.trim();
    const href = $(el).attr('href')?.trim();
    if (lang && href) hreflang.push({ lang, href }); // без href или с пустым hreflang — мусор, пропускаем
  });

  const favicon =
    $('link[rel~="icon"]').first().attr('href')?.trim() ||
    $('link[rel="apple-touch-icon"]').first().attr('href')?.trim() ||
    null;

  const bodyClone = $('body').clone();
  bodyClone.find('script, style, noscript, svg').remove();
  const wordCount = bodyClone.text().split(/\s+/).filter(Boolean).length;

  const lang = $('html').attr('lang')?.trim() || null;

  // headingOrder: уровни в порядке документа; пустые текстом заголовки не считаются
  const headingOrder: HeadingLevel[] = [];
  $('h1, h2, h3, h4, h5, h6').each((_, el) => {
    if ($(el).text().trim()) headingOrder.push(el.tagName.toLowerCase() as HeadingLevel);
  });
```

В `return` добавить все семь полей. Примечание: `$('h1, h2, ...')` в cheerio обходит в порядке документа — это и есть источник `headingOrder`.

- [ ] **Step 4: Прокидка в `engine.ts`** — после `result.description = parsed.description;` (~строка 213):

```ts
      result.openGraph = parsed.openGraph;
      result.twitter = parsed.twitter;
      result.hreflang = parsed.hreflang;
      result.favicon = parsed.favicon;
      result.wordCount = parsed.wordCount;
      result.lang = parsed.lang;
      result.headingOrder = parsed.headingOrder;
```

- [ ] **Step 5: Запустить тесты** — `npm test`
Expected: PASS во всех пакетах.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/crawler/extract.ts apps/server/src/crawler/extract.test.ts apps/server/src/crawler/engine.ts
git commit -m "feat: экстракция OG/Twitter/hreflang/favicon/wordCount/lang/headingOrder"
```

---

### Task 3: Новые проверки-issues

**Files:**
- Modify: `apps/server/src/crawler/issues.ts`
- Test: `apps/server/src/crawler/issues.test.ts`

**Interfaces:**
- Consumes: `PageResult.openGraph/favicon/lang/headingOrder` (Task 1-2), существующий `computeIssues(results, linkStatuses)`.
- Produces: сигнатура `computeIssues` не меняется; 4 новых `IssueKind` в выходе. Фронтенд (Task 5) локализует kind'ы.

- [ ] **Step 1: Падающие тесты в `issues.test.ts`**

Стиль — синтетические `PageResult` (см. существующие тесты файла; базовую заглушку страницы можно вынести в локальную фабрику теста). Добавить:

```ts
describe('новые проверки', () => {
  const base = (over: Partial<PageResult>): PageResult => ({
    ...минимальныйВалидныйPageResult, // повторить фабрику из существующих тестов файла
    status: 200, contentType: 'text/html',
    ...over,
  });

  it('missing-og: нет og:title и og:description', () => {
    const issues = computeIssues([
      base({ url: 'http://a/1', openGraph: null }),
      base({ url: 'http://a/2', openGraph: { title: 'T', description: null, image: null, url: null } }), // есть title — ок
      base({ url: 'http://a/3', openGraph: { title: null, description: 'D', image: null, url: null } }), // есть description
    ], new Map());
    expect(issues.find((i) => i.kind === 'missing-og')).toEqual({
      kind: 'missing-og', count: 1, sampleUrls: ['http://a/1'],
    });
  });

  it('missing-favicon и missing-lang', () => {
    const issues = computeIssues([
      base({ url: 'http://a/1', favicon: null, lang: null }),
      base({ url: 'http://a/2', favicon: '/f.ico', lang: 'ru' }),
    ], new Map());
    expect(issues.find((i) => i.kind === 'missing-favicon')?.sampleUrls).toEqual(['http://a/1']);
    expect(issues.find((i) => i.kind === 'missing-lang')?.sampleUrls).toEqual(['http://a/1']);
  });

  it.each([
    [['h1', 'h2', 'h3'], false],          // порядок корректен
    [['h1', 'h3', 'h4'], true],           // пропуск уровня
    [['h2', 'h1'], true],                 // первый не h1
    [[], false],                          // нет заголовков — не нарушение
    [['h1', 'h1', 'h2'], false],          // повтор h1 — не про порядок
  ])('heading-order для %j → %j', (order, expected) => {
    const issues = computeIssues([base({ url: 'http://a/1', headingOrder: order })], new Map());
    const found = issues.find((i) => i.kind === 'heading-order');
    expect(found !== undefined).toBe(expected);
  });

  it('не-HTML и ошибочные страницы не попадают в новые проверки', () => {
    const issues = computeIssues([
      base({ url: 'http://a/pdf', contentType: 'application/pdf' }),
      base({ url: 'http://a/err', status: null, error: 'connection', contentType: null }),
    ], new Map());
    expect(issues.filter((i) =>
      ['missing-og', 'missing-favicon', 'missing-lang', 'heading-order'].includes(i.kind),
    )).toEqual([]);
  });
});
```

- [ ] **Step 2: Запустить, убедиться в падении**

Run: `cd apps/server && npx vitest run src/crawler/issues.test.ts`
Expected: FAIL (kind'ы не находятся).

- [ ] **Step 3: Реализовать в `issues.ts`**

Перед `computeIssues`:

```ts
/**
 * Нарушение порядка заголовков: первый заголовок не h1 или
 * переход на уровень больше предыдущего более чем на 1 (пропуск уровней).
 */
function isHeadingOrderBroken(order: HeadingLevel[]): boolean {
  if (order.length === 0) return false;
  const level = (h: HeadingLevel): number => Number(h[1]);
  if (level(order[0]) !== 1) return true;
  for (let i = 1; i < order.length; i++) {
    if (level(order[i]) > level(order[i - 1]) + 1) return true;
  }
  return false;
}
```

В основном цикле, рядом с существующими `isHtml`-проверками:

```ts
    if (isHtml(r)) {
      if (r.openGraph === null || (r.openGraph.title === null && r.openGraph.description === null)) {
        add('missing-og', r.url);
      }
      if (r.favicon === null) add('missing-favicon', r.url);
      if (r.lang === null) add('missing-lang', r.url);
      if (isHeadingOrderBroken(r.headingOrder)) add('heading-order', r.url);
    }
```

Импортировать `HeadingLevel` из `@seo-crawler/shared`.

- [ ] **Step 4: Запустить тесты** — `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/crawler/issues.ts apps/server/src/crawler/issues.test.ts
git commit -m "feat: issues missing-og/missing-favicon/missing-lang/heading-order"
```

---

### Task 4: CSV-колонки

**Files:**
- Modify: `apps/server/src/export/csv.ts`
- Test: `apps/server/src/export/csv.test.ts`

**Interfaces:**
- Consumes: поля `PageResult` из Task 1-2.
- Produces: колонки в конце строки — `og_title,og_description,og_image,twitter_card,hreflang,favicon,word_count,lang` (snake_case — стиль существующего заголовка: `meta_robots`, `content_type`; в спеке перечислены имена полей, а не заголовков).

- [ ] **Step 1: Падающие тесты в `csv.test.ts`**

```ts
describe('обогащённые колонки', () => {
  it('добавляет og/twitter/hreflang/favicon/word_count/lang после существующих', () => {
    const rows = toCsv([page]).split('\n');
    expect(rows[0].split(',').slice(-8)).toEqual(
      ['og_title', 'og_description', 'og_image', 'twitter_card', 'hreflang', 'favicon', 'word_count', 'lang'],
    );
    const cells = rows[1].split(',');
    expect(cells.at(-8)).toBe('OG Title');
    expect(cells.at(-4)).toBe('"en=https://s.example/en/; x-default=https://s.example/"');
    expect(cells.at(-3)).toBe('/favicon.ico');
    expect(cells.at(-2)).toBe('322');
    expect(cells.at(-1)).toBe('ru');
  });

  it('null-объекты и пустые поля — пустые ячейки', () => {
    const rows = toCsv([{ ...page, openGraph: null, twitter: null, hreflang: [], favicon: null, lang: null }]).split('\n');
    expect(rows[1].split(',').slice(-8).every((c) => c === '' || c === '322')).toBe(true);
  });

  it('og:description с формульным началом и запятой экранируется', () => {
    const rows = toCsv([{
      ...page,
      openGraph: { title: null, description: '=СУММ(A1;2)', image: null, url: null },
    }]).split('\n');
    // ячейка обрамлена кавычками, апостроф гасит формулу, кавычки внутри удвоены при необходимости
    expect(rows[1]).toContain(`"'=СУММ(A1;2)"`);
  });
});
```

(`page` — существующая фабрика/фикстура теста; `wordCount` в ней дополнить до фактического значения фабрики.)

- [ ] **Step 2: Запустить, убедиться в падении**

Run: `cd apps/server && npx vitest run src/export/csv.test.ts`
Expected: FAIL (колонок нет).

- [ ] **Step 3: Реализовать в `csv.ts`**

```ts
const HEADER =
  'url,status,error,depth,title,description,meta_robots,canonical,' +
  'content_type,size_bytes,response_time_ms,noindex,nofollow,rendered,' +
  'h1_count,images_without_alt,internal_links,external_links,' +
  'og_title,og_description,og_image,twitter_card,hreflang,favicon,word_count,lang';
```

В `TEXT_FIELDS` добавить: `'ogTitle'`, `'ogDescription'`, `'ogImage'`, `'twitterCard'`, `'hreflang'`, `'favicon'`, `'lang'`.

В конец массива `toRow`:

```ts
    escapeField(p.openGraph?.title ?? null, true),
    escapeField(p.openGraph?.description ?? null, true),
    escapeField(p.openGraph?.image ?? null, true),
    escapeField(p.twitter?.card ?? null, true),
    escapeField(p.hreflang.map((h) => `${h.lang}=${h.href}`).join('; ') || null, true),
    escapeField(p.favicon, true),
    escapeField(p.wordCount),
    escapeField(p.lang, true),
```

- [ ] **Step 4: Запустить тесты** — `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/export/csv.ts apps/server/src/export/csv.test.ts
git commit -m "feat: csv-колонки OG/Twitter/hreflang/favicon/word_count/lang"
```

---

### Task 5: Фронтенд — детали страницы, таблица, i18n

**Files:**
- Modify: `apps/web/src/components/PageDetails.tsx`
- Modify: `apps/web/src/components/ResultsTable.tsx` (колонка «Слова»)
- Modify: `apps/web/src/locales/ru.json`, `apps/web/src/locales/en.json`
- Test: `apps/web/src/components/PageDetails.test.tsx`, `apps/web/src/components/ResultsTable.test.tsx`

**Interfaces:**
- Consumes: `PageResult.openGraph/twitter/hreflang/favicon/wordCount/lang` (Task 1); ключи локализации этого таска.
- Produces: i18n-ключи `details.og`, `details.twitter`, `details.hreflang`, `details.favicon`, `details.wordCount`, `details.lang`, `details.ogNone`; `issues.missingOg/missingFavicon/missingLang/headingOrder`; колонка `wordCount` в таблице.

- [ ] **Step 1: Падающие тесты в `PageDetails.test.tsx`**

Фикстура `page` дополнить:

```ts
  openGraph: { title: 'OG Title', description: 'OG Desc', image: 'https://s.example/og.png', url: 'https://s.example/' },
  twitter: { card: 'summary_large_image', title: null, description: null, image: null },
  hreflang: [{ lang: 'en', href: 'https://s.example/en/' }],
  favicon: '/favicon.ico',
  wordCount: 322,
  lang: 'ru',
  headingOrder: ['h1', 'h2'],
```

Тесты:

```ts
it('рендерит блоки OG/Twitter/hreflang/favicon/wordCount/lang', () => {
  const w = mount(PageDetails, { props: { page }, global: { plugins: [i18n] } });
  expect(w.text()).toContain('OG Title');
  expect(w.text()).toContain('OG Desc');
  expect(w.text()).toContain('summary_large_image');
  expect(w.text()).toContain('en=https://s.example/en/');
  expect(w.find('img[data-test="details-favicon"]').exists()).toBe(true);
  expect(w.text()).toContain('322');
  expect(w.text()).toContain('ru');
});

it('прочерки при отсутствии данных', () => {
  const w = mount(PageDetails, { props: { page: { ...page, openGraph: null, twitter: null, hreflang: [], favicon: null, lang: null } }, global: { plugins: [i18n] } });
  expect(w.findAll('[data-test="details-og-empty"]').length).toBeGreaterThan(0);
  expect(w.find('img[data-test="details-favicon"]').exists()).toBe(false);
});
```

В `ResultsTable.test.tsx` — фиксатура строки получает `wordCount: 322`, тест: колонка «Слова» рендерит `322` (по образцу существующего теста колонок таблицы).

- [ ] **Step 2: Запустить, убедиться в падении**

Run: `cd apps/web && npx vitest run src/components/PageDetails.test.tsx src/components/ResultsTable.test.tsx`
Expected: FAIL (ключи/блоки отсутствуют).

- [ ] **Step 3: i18n-ключи**

`ru.json`: в `issues` — `"missingOg": "Отсутствует Open Graph", "missingFavicon": "Отсутствует favicon", "missingLang": "Отсутствует lang", "headingOrder": "Нарушен порядок заголовков"`; в `details` — `"og": "Open Graph"`, `"twitter": "Twitter"`, `"hreflang": "Hreflang"`, `"favicon": "Favicon"`, `"wordCount": "Слов"`, `"lang": "Язык"`, `"ogNone": "Не задано"`. `en.json` — зеркально английскими строками (`"Missing Open Graph"`, `"No favicon"`, `"Missing lang"`, `"Broken heading order"`, `"Words"`, `"Language"`, `"Not set"` и т.д.).

- [ ] **Step 4: PageDetails** — блоки в разметку после Schema.org (стиль повторяет `renderLinks` и блоки `caption`):

```tsx
function renderOg(page: PageResult) {
  if (page.openGraph === null) return <p class="pd-muted" data-test="details-og-empty">—</p>;
  const og = page.openGraph;
  return (
    <ul class="pd-list">
      <li><span class="caption">title</span><span>{og.title ?? '—'}</span></li>
      <li><span class="caption">description</span><span>{og.description ?? '—'}</span></li>
      <li><span class="caption">image</span><span class="mono pd-url-sm">{og.image ?? '—'}</span></li>
      <li><span class="caption">url</span><span class="mono pd-url-sm">{og.url ?? '—'}</span></li>
    </ul>
  );
}
```

Секции:

```tsx
        <div class="pd-section">
          <div class="caption">{t('details.og')}</div>
          {renderOg(props.page)}
        </div>
        <div class="pd-section">
          <div class="caption">{t('details.twitter')}</div>
          {props.page.twitter === null
            ? <p class="pd-muted" data-test="details-og-empty">{t('details.ogNone')}</p>
            : <p class="pd-list">{props.page.twitter.card ?? '—'}</p>}
        </div>
        <div class="pd-section">
          <div class="caption">{t('details.hreflang')}</div>
          {props.page.hreflang.length === 0
            ? <p class="pd-muted">—</p>
            : <ul class="pd-list">{props.page.hreflang.map((h, i) => (
                <li key={i}><span class="mono pd-url-sm">{h.lang}={h.href}</span></li>
              ))}</ul>}
        </div>
        <div class="pd-section">
          <div class="caption">{t('details.favicon')}</div>
          {props.page.favicon === null
            ? <p class="pd-muted">—</p>
            : <img data-test="details-favicon" class="pd-favicon" src={props.page.favicon} alt="" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
        </div>
```

В блок метаданных (рядом с существующими `caption`-парами) добавить wordCount и lang:

```tsx
            <div class="caption">{t('details.wordCount')}</div>
            <div data-test="details-wordcount">{props.page.wordCount}</div>
            <div class="caption">{t('details.lang')}</div>
            <div data-test="details-lang">{props.page.lang ?? '—'}</div>
```

CSS (`.pd-favicon { max-width: 32px; max-height: 32px; }`) — в соответствующий `*.module.css`/`styles.css`, следуя тому, где лежат стили `pd-*`.

- [ ] **Step 5: ResultsTable** — колонка «Слова» (key `wordCount`, значение `page.wordCount`) по образцу существующих простых колонок; заголовок через `t('details.wordCount')`.

- [ ] **Step 6: Запустить тесты** — `npm test`
Expected: PASS во всех пакетах.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat: OG/Twitter/hreflang/favicon/wordCount/lang в деталях страницы, колонка слов, i18n новых issues"
```

---

### Task 6: Финальная сборка и ручная проверка

- [ ] **Step 1: Полный прогон** — `npm test` в корне.
Expected: все пакеты зелёные.

- [ ] **Step 2: Ручная проверка** — `npm run dev`; на `http://localhost:5173` прогнать краул тестового/реального сайта; убедиться: новые блоки в деталях страницы, колонка «Слова», новые группы в Issues, CSV содержит новые колонки.

- [ ] **Step 3: Финальный коммит** (если накопились правки после ручной проверки).

## Self-Review

- **Spec coverage:** типы/экстракция — Tasks 1-2; четыре issues — Task 3; CSV — Task 4; UI/i18n/таблица — Task 5; сборка — Task 6. `thin-content` вне скоупа (спек).
- **Placeholder scan:** фабрика `минимальныйВалидныйPageResult` в Task 3 — указание повторить фабрику из существующих тестов файла; в Task 4 — дополнить существующую фиксатуру `page`. Оба указывают на конкретное существующее место в файле.
- **Type consistency:** имена полей `openGraph/twitter/hreflang/favicon/wordCount/lang/headingOrder` едины во всех тасках; kind'ы `missing-og/missing-favicon/missing-lang/heading-order` совпадают между Task 1/3/5.
- **Review Focus:** пустой content — Task 2 (тест 3); hreflang без href — Task 2 (фикстура `full`); дубли og:title — Task 2 (тест 3); CSV-инъекция og:description — Task 4; не-HTML guard — Task 3 (тест 5).
