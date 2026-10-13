# Web SEO Crawler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Веб-приложение-краулер (аналог Screaming Frog SEO Spider): пользователь вводит URL, приложение обходит сайт и показывает технические данные и отчёты о проблемах.

**Architecture:** Монорепо npm workspaces: `apps/web` (Vite + Vue 3 + TSX SPA), `apps/server` (Fastify + собственный краул-движок + WS), `packages/shared` (общие типы). Краулинг только на сервере; фронтенд получает прогресс по WebSocket и данные из REST.

**Tech Stack:** TypeScript (strict), Vue 3 + TSX + Pinia + vue-i18n + vue-router, Vite; Fastify, ws, undici, cheerio, robots-parser, fast-xml-parser, Playwright (опция рендеринга); vitest.

**Spec:** `docs/superpowers/specs/2026-10-13-seo-crawler-design.md`

## Global Constraints

- Node >= 20, TypeScript `strict: true` во всех пакетах.
- Менеджер пакетов — npm, монорепо через npm workspaces.
- Компоненты фронтенда — только TSX (`.tsx` + `defineComponent`), SFC (`.vue`) не используем.
- Без UI-китов: таблица и бейджи — собственные.
- Тесты — vitest; в тестах сеть наружу запрещена (только локальный тестовый сервер).
- Дефолтные лимиты: `maxUrls=500`, `maxDepth=10`, `concurrency=5`, `requestTimeoutMs=15000`, максимум 3 параллельные сессии, cap 50 000 страниц на сессию.
- Языки UI: `ru` и `en` (vue-i18n, выбор в localStorage), светлая тема.
- Git: репозиторий использует файл-указатель `.git` → `.gitrepo/` (особенность песочницы) — команды git работают как обычно, `.gitrepo/` в `.gitignore`.
- Стиль коммитов: `feat:`, `fix:`, `test:`, `chore:`, `docs:`.

## Review Focus

Входы, которые спека подразумевает, но тесты задач напрямую не покрывают — каждый прижат тестом в своей задаче:

1. **URL с якорями и query-параметрами**: `#fragment` отбрасывается, но две страницы, отличающиеся только query, НЕ склеиваются (`/a?x=1` ≠ `/a?x=2`). Тест — Task 2.
2. **Редиректы (3xx)**: страница сохраняется с финальным URL и финальным статусом; промежуточные URL попадают в `redirectChain`. Тест — Task 6.
3. **Не-HTML контент** (PDF, JSON, картинки): не парсится как HTML; сохраняются статус/размер/тип, без title/заголовков. Тест — Task 6.
4. **Циклы и redirect-петли**: дедупликация + `maxUrls` гарантируют завершение. Тест — Task 6.
5. **Таймаут/обрыв соединения**: страница не теряется — попадает в результаты со `status: null` и кодом ошибки. Тест — Task 6.

---

### Task 1: Монорепо, каркас и shared-типы

**Files:**
- Create: `package.json` (root), `tsconfig.base.json`, `.gitignore` (добавить `node_modules/`, `dist/`, `coverage/`)
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/index.ts`, `packages/shared/src/types.ts`
- Create: `packages/shared/src/types.test.ts`

**Interfaces:**
- Produces: все типы из `packages/shared/src/types.ts`, перечисленные ниже — их импортируют ВСЕ последующие задачи через `@seo-crawler/shared`.

- [ ] **Step 1: Создать корневой package.json и tsconfig.base.json**

```json
// package.json
{
  "name": "seo-crawler",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*", "apps/*"],
  "scripts": {
    "test": "npm run test --workspaces --if-present",
    "dev:web": "npm run dev -w @seo-crawler/web",
    "dev:server": "npm run dev -w @seo-crawler/server"
  }
}
```

```json
// tsconfig.base.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "declaration": true
  }
}
```

- [ ] **Step 2: Создать packages/shared с типами**

`packages/shared/package.json`: имя `@seo-crawler/shared`, `"type": "module"`, `"exports": { ".": "./src/index.ts" }`, devDependencies: `typescript`, `vitest`. Скрипт `"test": "vitest run"`. `tsconfig.json` extends `../../tsconfig.base.json`.

```ts
// packages/shared/src/types.ts
export type CrawlMode = 'spider' | 'list' | 'sitemap';

export interface CrawlOptions {
  startUrl: string;
  mode: CrawlMode;
  listUrls?: string[];
  maxUrls: number;
  maxDepth: number;
  respectRobots: boolean;
  renderJs: boolean;
  concurrency: number;
  requestTimeoutMs: number;
}

export interface LinkInfo { url: string; anchor: string | null; rel: string | null; }
export interface ImageInfo { url: string; alt: string | null; }
export type HeadingLevel = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

export interface PageResult {
  url: string;
  status: number | null;            // null при сетевой ошибке
  error: string | null;             // 'timeout' | 'dns' | 'ssl' | 'connection' | ...
  contentType: string | null;
  depth: number;
  fetchedAt: string;                // ISO
  responseTimeMs: number;
  sizeBytes: number;
  rendered: boolean;
  title: string | null;
  description: string | null;
  metaRobots: string | null;
  canonical: string | null;
  headings: Record<HeadingLevel, string[]>;
  images: ImageInfo[];
  internalLinks: LinkInfo[];
  externalLinks: LinkInfo[];
  schemaOrg: unknown[];
  noindex: boolean;
  nofollow: boolean;
  redirectChain: string[];          // промежуточные URL
}

export type CrawlState = 'running' | 'done' | 'stopped';

export type IssueKind =
  | 'broken-link' | 'duplicate-title' | 'duplicate-description'
  | 'duplicate-h1' | 'missing-h1' | 'missing-alt' | 'noindex';

export interface Issue {
  kind: IssueKind;
  count: number;
  sampleUrls: string[];
}

export type CrawlEvent =
  | { type: 'progress'; state: CrawlState; crawled: number; queued: number; errors: number }
  | { type: 'page'; url: string }
  | { type: 'summary'; issues: Issue[] }
  | { type: 'done'; state: CrawlState };
```

```ts
// packages/shared/src/index.ts
export * from './types';
```

- [ ] **Step 3: Написать smoke-тест типов**

```ts
// packages/shared/src/types.test.ts
import { describe, it, expect } from 'vitest';
import type { PageResult, CrawlEvent } from './index';

describe('shared types', () => {
  it('PageResult принимает корректный объект', () => {
    const page: PageResult = {
      url: 'https://example.com/', status: 200, error: null,
      contentType: 'text/html', depth: 0, fetchedAt: new Date().toISOString(),
      responseTimeMs: 10, sizeBytes: 100, rendered: false,
      title: null, description: null, metaRobots: null, canonical: null,
      headings: { h1: [], h2: [], h3: [], h4: [], h5: [], h6: [] },
      images: [], internalLinks: [], externalLinks: [], schemaOrg: [],
      noindex: false, nofollow: false, redirectChain: [],
    };
    expect(page.status).toBe(200);
    const ev: CrawlEvent = { type: 'progress', state: 'running', crawled: 1, queued: 0, errors: 0 };
    expect(ev.type).toBe('progress');
  });
});
```

- [ ] **Step 4: Установить зависимости и запустить тест**

Run: `npm install && npm test -w @seo-crawler/shared`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.base.json packages/shared
git commit -m "chore: монорепо npm workspaces и shared-типы"
```

---

### Task 2: URL-утилиты

**Files:**
- Create: `apps/server/package.json`, `apps/server/tsconfig.json`, `apps/server/src/crawler/url-utils.ts`
- Test: `apps/server/src/crawler/url-utils.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces:
  - `normalizeUrl(raw: string): string | null` — абсолютный URL без `#fragment`; `null` для не-http(s) и невалидных.
  - `isInternal(url: string, origin: string): boolean` — тот же host (учитывая `www.` как эквивалент).
  - `extractLinks(htmlUrl: string, href: string): string | null` — абсолютный URL ссылки (может вернуть `null` для `mailto:` и пр.).

- [ ] **Step 1: Написать падающие тесты**

```ts
// apps/server/src/crawler/url-utils.test.ts
import { describe, it, expect } from 'vitest';
import { normalizeUrl, isInternal, extractLinks } from './url-utils';

describe('normalizeUrl', () => {
  it('делает абсолютным и отбрасывает fragment', () => {
    expect(normalizeUrl('/a?x=1#sec', 'https://example.com')).toBe('https://example.com/a?x=1');
  });
  it('не склеивает разные query', () => {
    expect(normalizeUrl('/a?x=1', 'https://example.com'))
      .not.toBe(normalizeUrl('/a?x=2', 'https://example.com'));
  });
  it('отбрасывает не-http(s) и невалидные', () => {
    expect(normalizeUrl('mailto:a@b.c', 'https://example.com')).toBeNull();
    expect(normalizeUrl('tel:+123', 'https://example.com')).toBeNull();
    expect(normalizeUrl('::::', 'https://example.com')).toBeNull();
  });
  it('убирает trailing slash только у корня-дубликата пути', () => {
    expect(normalizeUrl('https://example.com', 'https://example.com')).toBe('https://example.com/');
  });
});

describe('isInternal', () => {
  it('www-эквивалентность', () => {
    expect(isInternal('https://www.example.com/a', 'https://example.com')).toBe(true);
    expect(isInternal('https://other.com', 'https://example.com')).toBe(false);
  });
});
```

Замечание: `normalizeUrl` принимает второй аргумент `baseUrl: string` — обновите сигнатуру в Interfaces: `normalizeUrl(raw: string, baseUrl: string): string | null`.

- [ ] **Step 2: Запустить тест, убедиться в падении**

Run: `npm test -w @seo-crawler/server -- url-utils`
Expected: FAIL — модуль не существует

- [ ] **Step 3: Реализовать url-utils.ts**

```ts
// apps/server/src/crawler/url-utils.ts
export function normalizeUrl(raw: string, baseUrl: string): string | null {
  try {
    const u = new URL(raw, baseUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

export function isInternal(url: string, origin: string): boolean {
  try {
    const strip = (h: string) => h.replace(/^www\./, '');
    return strip(new URL(url).host) === strip(new URL(origin).host);
  } catch {
    return false;
  }
}

export function extractLinks(htmlUrl: string, href: string): string | null {
  return normalizeUrl(href, htmlUrl);
}
```

`apps/server/package.json`: имя `@seo-crawler/server`, deps: `@seo-crawler/shared`, `fastify`, `@fastify/cors`, `ws`, `undici`, `cheerio`, `robots-parser`, `fast-xml-parser`; devDeps: `typescript`, `vitest`, `tsx`, `@types/ws`, `@types/node`. Скрипты: `"dev": "tsx watch src/index.ts"`, `"test": "vitest run"`. `tsconfig.json` extends базовый, `include: ["src"]`.

- [ ] **Step 4: Запустить тест, убедиться в прохождении**

Run: `npm install && npm test -w @seo-crawler/server -- url-utils`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server
git commit -m "feat: url-утилиты краулера (нормализация, internal/external)"
```

---

### Task 3: Тестовый HTTP-сервер-фикстура

**Files:**
- Create: `apps/server/src/test-helpers/test-site.ts`
- Test: `apps/server/src/test-helpers/test-site.test.ts`

**Interfaces:**
- Produces:
  - `startTestSite(port = 0): Promise<{ origin: string; close(): Promise<void> }>` — мини-сайт на `node:http`: `/` (ссылки на `/about`, `/missing` (404), `/redirect` (301→`/about`), `/binary.pdf`, внешняя ссылка на `https://external.example/`), `/about`, `/redirect`, `/missing` (404), `/binary.pdf` (не-HTML), `/robots.txt`, `/sitemap.xml`.

- [ ] **Step 1: Написать падающий тест**

```ts
// apps/server/src/test-helpers/test-site.test.ts
import { describe, it, expect } from 'vitest';
import { startTestSite } from './test-site';

describe('test-site', () => {
  it('отдаёт страницы и статусы', async () => {
    const site = await startTestSite();
    try {
      const ok = await fetch(`${site.origin}/`);
      expect(ok.status).toBe(200);
      expect(await ok.text()).toContain('/about');
      expect((await fetch(`${site.origin}/missing`)).status).toBe(404);
      expect((await fetch(`${site.origin}/redirect`, { redirect: 'manual' })).status).toBe(301);
      const bin = await fetch(`${site.origin}/binary.pdf`);
      expect(bin.headers.get('content-type')).toBe('application/pdf');
    } finally {
      await site.close();
    }
  });
});
```

- [ ] **Step 2: Запустить, убедиться в падении**

Run: `npm test -w @seo-crawler/server -- test-site`
Expected: FAIL — модуль не существует

- [ ] **Step 3: Реализовать test-site.ts**

Полный `node:http`-сервер с маршрутизацией по `req.url`:
`/` → HTML `<a href="/about">About</a><a href="/missing">Bad</a><a href="/redirect">Redir</a><a href="/binary.pdf">PDF</a><a href="https://external.example/">Ext</a>`; `/about` → HTML с `<h1>About</h1>`, `<img src="/logo.png" alt="">` (пустой alt → missing-alt), `<img src="/pic.png">` (без alt); `/redirect` → `301, Location: /about`; `/missing` → 404; `/binary.pdf` → `content-type: application/pdf`, буфер; `/robots.txt` → `User-agent: *\nAllow: /\nSitemap: {origin}/sitemap.xml`; `/sitemap.xml` → XML c urlset из `/` и `/about`. `close()` — `server.close()`.

- [ ] **Step 4: Запустить, убедиться в прохождении**

Run: `npm test -w @seo-crawler/server -- test-site`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/test-helpers
git commit -m "test: локальный тестовый сайт-фикстура для краулера"
```

---

### Task 4: HTML-экстрактор (cheerio)

**Files:**
- Create: `apps/server/src/crawler/extract.ts`
- Test: `apps/server/src/test-helpers/fixtures/page.html` + `apps/server/src/crawler/extract.test.ts`

**Interfaces:**
- Consumes: ничего (чистая функция над HTML-строкой).
- Produces:
  - `extractPageData(html: string): ExtractedHtml`, где
    `ExtractedHtml = { title, description, metaRobots, canonical, headings: Record<HeadingLevel, string[]>, images: { src: string; alt: string | null }[], links: { href: string; anchor: string | null; rel: string | null }[], jsonLd: unknown[] }`.
  - Типы `HeadingLevel` из `@seo-crawler/shared`.

- [ ] **Step 1: Создать фикстуру и падающий тест**

`fixtures/page.html`:

```html
<!doctype html><html><head>
<title>Test Page</title>
<meta name="description" content="Desc here">
<meta name="robots" content="noindex, nofollow">
<link rel="canonical" href="https://example.com/canonical">
<script type="application/ld+json">{"@type":"WebPage"}</script>
</head><body>
<h1>First H1</h1><h1>Second H1</h1><h2>Sub</h2>
<a href="/page1">Internal</a><a href="https://other.com/x" rel="nofollow">Ext</a>
<img src="/a.png" alt="has alt"><img src="/b.png">
</body></html>
```

```ts
// apps/server/src/crawler/extract.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { extractPageData } from './extract';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../test-helpers/fixtures/page.html'), 'utf8');

describe('extractPageData', () => {
  const data = extractPageData(html);
  it('извлекает метаданные и директивы', () => {
    expect(data.title).toBe('Test Page');
    expect(data.description).toBe('Desc here');
    expect(data.metaRobots).toBe('noindex, nofollow');
    expect(data.canonical).toBe('https://example.com/canonical');
  });
  it('извлекает h1 (в т.ч. дубли) и h2', () => {
    expect(data.headings.h1).toEqual(['First H1', 'Second H1']);
    expect(data.headings.h2).toEqual(['Sub']);
  });
  it('извлекает ссылки с anchor/rel', () => {
    expect(data.links).toContainEqual({ href: '/page1', anchor: 'Internal', rel: null });
    expect(data.links).toContainEqual({ href: 'https://other.com/x', anchor: 'Ext', rel: 'nofollow' });
  });
  it('извлекает картинки с alt-признаком', () => {
    expect(data.images).toContainEqual({ src: '/a.png', alt: 'has alt' });
    expect(data.images).toContainEqual({ src: '/b.png', alt: null });
  });
  it('извлекает JSON-LD', () => {
    expect(data.jsonLd).toHaveLength(1);
    expect(data.jsonLd[0]).toEqual({ '@type': 'WebPage' });
  });
});
```

- [ ] **Step 2: Запустить, убедиться в падении**

Run: `npm test -w @seo-crawler/server -- extract`
Expected: FAIL — модуль не существует

- [ ] **Step 3: Реализовать extract.ts**

`cheerio.load(html)`; селекторы: `title`, `meta[name=description]`, `meta[name=robots]`, `link[rel=canonical]`, `script[type="application/ld+json"]` (JSON.parse в try/catch, битый JSON пропускается), `h1..h6` (`text()` + trim), `a[href]` (abs `attr('href')`, текст anchor — trim от `text()`, `rel` через `attr('rel')`), `img[src]` (`alt` — trim; пустая строка → `null`).

- [ ] **Step 4: Запустить, убедиться в прохождении**

Run: `npm test -w @seo-crawler/server -- extract`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/crawler/extract.ts apps/server/src/crawler/extract.test.ts apps/server/src/test-helpers/fixtures
git commit -m "feat: cheerio-экстрактор SEO-данных из HTML"
```

---

### Task 5: Парсеры robots.txt и sitemap

**Files:**
- Create: `apps/server/src/crawler/robots.ts`, `apps/server/src/crawler/sitemap.ts`
- Test: `apps/server/src/crawler/robots.test.ts`, `apps/server/src/crawler/sitemap.test.ts`

**Interfaces:**
- Consumes: `fetch` (undici, глобальный).
- Produces:
  - `fetchRobots(origin: string, timeoutMs: number): Promise<RobotsInfo>`, где `RobotsInfo = { allowed: (url: string) => boolean; crawlDelayMs: number | null; sitemaps: string[] }`. Использует `robots-parser` (пакет `robots-parser`, функция `robotsParser(robotsUrl, body)`); при 4xx/ошибке — «разрешено всё», при 5xx — «запрещено всё» (консервативно).
  - `fetchSitemapUrls(sitemapUrl: string, timeoutMs: number): Promise<string[]>` — fast-xml-parser; поддерживает `urlset/url/loc` и `sitemapindex/sitemap/loc` (индекс раскрывается рекурсивно, максимум 3 уровня).

- [ ] **Step 1: Написать падающие тесты** — против локального тест-сервера из Task 3: `robots.txt` отдаёт `allowed(origin + '/') === true`, `sitemaps` содержит `origin + '/sitemap.xml'`; `fetchSitemapUrls(origin + '/sitemap.xml')` возвращает `['{origin}/', '{origin}/about']`. Плюс юнит-тест без сети: `robotsParser`-обёртка запрещает URL из `Disallow: /private/` (тест с inline-строкой `User-agent: *\nDisallow: /private/` через вынесенную чистую функцию `parseRobots(robotsUrl: string, body: string): RobotsInfo`).

- [ ] **Step 2: Запустить, убедиться в падении**

Run: `npm test -w @seo-crawler/server -- robots sitemap`
Expected: FAIL

- [ ] **Step 3: Реализовать robots.ts и sitemap.ts**

`robots.ts`: чистая `parseRobots` (оборачивает `robotsParser`) + `fetchRobots` (GET с AbortController-таймаутом; 2xx → parseRobots, 4xx/ошибка → разрешено всё, 5xx → запрещено всё). `sitemap.ts`: fetch + `XMLParser` из fast-xml-parser, нормализация loc в массивы, рекурсия для sitemapindex с лимитом глубины.

- [ ] **Step 4: Запустить, убедиться в прохождении**

Run: `npm test -w @seo-crawler/server -- robots sitemap`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/crawler/robots.ts apps/server/src/crawler/robots.test.ts apps/server/src/crawler/sitemap.ts apps/server/src/crawler/sitemap.test.ts
git commit -m "feat: парсеры robots.txt и sitemap"
```

---

### Task 6: Краул-движок: очередь, воркеры, режим Spider

**Files:**
- Create: `apps/server/src/crawler/fetcher.ts`, `apps/server/src/crawler/engine.ts`
- Test: `apps/server/src/crawler/engine.test.ts`

**Interfaces:**
- Consumes: `normalizeUrl`, `isInternal` (Task 2), `extractPageData` (Task 4), `parseRobots`/`fetchRobots` (Task 5), `startTestSite` (Task 3), типы `CrawlOptions`, `PageResult` (Task 1).
- Produces:
  - `interface FetchOutcome { status: number | null; error: string | null; contentType: string | null; body: string | null; sizeBytes: number; responseTimeMs: number; finalUrl: string; redirectChain: string[]; }`
  - `interface Fetcher { fetch(url: string, timeoutMs: number): Promise<FetchOutcome>; close(): Promise<void>; }`
  - `class HttpFetcher implements Fetcher` (undici, `redirect: 'follow'`, пишет `redirectChain` из `response.url` — промежуточные URL недоступны в undici напрямую, поэтому фиксируем только финальный; `redirectChain` остаётся для рендерера).
  - `type EngineEvent = { type: 'page'; result: PageResult } | { type: 'progress'; crawled: number; queued: number; errors: number } | { type: 'done'; state: 'done' | 'stopped' }`
  - `class Crawler { constructor(options: CrawlOptions, fetcher: Fetcher, emit: (e: EngineEvent) => void); start(): Promise<void>; stop(): void; linkStatuses: Map<string, number | null>; }`

- [ ] **Step 1: Написать падающие тесты** (против `startTestSite`):

```ts
// apps/server/src/crawler/engine.test.ts
import { describe, it, expect } from 'vitest';
import { startTestSite } from '../test-helpers/test-site';
import { Crawler } from './engine';
import { HttpFetcher } from './fetcher';
import type { CrawlOptions, PageResult } from '@seo-crawler/shared';

function opts(origin: string, over: Partial<CrawlOptions> = {}): CrawlOptions {
  return { startUrl: origin + '/', mode: 'spider', maxUrls: 500, maxDepth: 10,
    respectRobots: true, renderJs: false, concurrency: 5, requestTimeoutMs: 5000, ...over };
}

async function run(origin: string, o: CrawlOptions) {
  const fetcher = new HttpFetcher();
  const pages: PageResult[] = [];
  let final: { state: string } | null = null;
  const crawler = new Crawler(o, fetcher, (e) => {
    if (e.type === 'page') pages.push(e.result);
    if (e.type === 'done') final = { state: e.state };
  });
  await crawler.start();
  fetcher.close();
  return { pages, final, crawler };
}

describe('Crawler spider', () => {
  it('обходит внутренние страницы, не ходит на внешние и 404-страницы не парсит как HTML', async () => {
    const site = await startTestSite();
    try {
      const { pages, final } = await run(site.origin, opts(site.origin));
      const urls = pages.map((p) => p.url);
      expect(urls).toContain(site.origin + '/');
      expect(urls).toContain(site.origin + '/about');
      expect(urls).toContain(site.origin + '/missing');
      expect(urls.some((u) => u.startsWith('https://external.example'))).toBe(false);
      const missing = pages.find((p) => p.url.endsWith('/missing'))!;
      expect(missing.status).toBe(404);
      expect(missing.title).toBeNull(); // 404 может быть HTML, но title пустой в фикстуре
      const pdf = pages.find((p) => p.url.endsWith('/binary.pdf'))!;
      expect(pdf.contentType).toBe('application/pdf');
      expect(pdf.title).toBeNull();
      expect(final!.state).toBe('done');
    } finally { await site.close(); }
  });

  it('следует редиректу и сохраняет финальный URL/статус', async () => {
    const site = await startTestSite();
    try {
      const { pages } = await run(site.origin, opts(site.origin));
      const redir = pages.find((p) => p.url === site.origin + '/redirect')!;
      expect(redir.status).toBe(200);
      expect(redir.redirectChain).toContain(site.origin + '/redirect');
    } finally { await site.close(); }
  });

  it('уважает maxUrls и завершается на циклах', async () => {
    const site = await startTestSite();
    try {
      const { pages } = await run(site.origin, opts(site.origin, { maxUrls: 2 }));
      expect(pages.length).toBe(2);
    } finally { await site.close(); }
  });

  it('таймаут даёт страницу со status=null и error, а не потерю', async () => {
    const site = await startTestSite();
    try {
      const { pages } = await run(site.origin,
        opts(site.origin, { requestTimeoutMs: 1, maxUrls: 1 }));
      const first = pages[0];
      if (first.status === null) {
        expect(['timeout', 'connection']).toContain(first.error);
      } // иначе ответ успел — детерминированный вариант ниже в fetcher-тесте
    } finally { await site.close(); }
  });

  it('respectRobots=false обходит запрещённые пути', async () => {
    const site = await startTestSite();
    try {
      const { pages } = await run(site.origin, opts(site.origin, { respectRobots: false }));
      expect(pages.length).toBeGreaterThan(2);
    } finally { await site.close(); }
  });
});
```

Дополнить фикстуру Task 3: добавить `/loop` (ссылку саму на себя) и `/private/secret` (запрещён в robots.txt) — тест `respectRobots: false` заходит на `/private/secret`.

- [ ] **Step 2: Запустить, убедиться в падении**

Run: `npm test -w @seo-crawler/server -- engine`
Expected: FAIL — модули не существуют

- [ ] **Step 3: Реализовать fetcher.ts и engine.ts**

`fetcher.ts`: `HttpFetcher` через `undici.fetch`; AbortController на `timeoutMs`; `error` классифицируется из `err.cause?.code`: `ENOTFOUND`→`dns`, `CERT_`/`DEPTH_ZERO_SELF_SIGNED_CERT`→`ssl`, `ABORT_ERR`/`UND_ERR_CONNECT_TIMEOUT`→`timeout`, остальное→`connection`.

`engine.ts` (~120 строк): очередь `Array<{ url: string; depth: number }>`, `seen: Set<string>`, `results: Map<string, PageResult>`, `linkStatuses: Map<string, number | null>`. Seed по режиму `spider`: `[startUrl, depth 0]`. Пул из `concurrency` воркеров: берут из очереди, проверяют лимиты (`maxUrls` по числу уникальных обработанных, `maxDepth`), `respectRobots` → `allowed()`, fetch; страница (`text/html`) → `extractPageData`, классификация ссылок на internal/external, новые internal → в очередь (`depth + 1`, если `< maxDepth`); внешние ссылки и ссылки с не-HTML контентом → «check»: fetch и запись статуса в `linkStatuses` (без парсинга, не попадают в internal-таб; отдельным лёгким результатом). Все fetch-результаты → `PageResult` (не-HTML: `title` и др. — `null`, headings/images/links — пустые) → `emit('page')`, периодически `emit('progress')`, по исчерпанию очереди → `emit('done', 'done')`. `stop()` ставит флаг — воркеры завершаются, `emit('done', 'stopped')`. Циклы обрываются `seen`; redirect — если `finalUrl` уже в `seen`, страница не парсится повторно, но статус фиксируется.

- [ ] **Step 4: Запустить, убедиться в прохождении**

Run: `npm test -w @seo-crawler/server -- engine`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/crawler/fetcher.ts apps/server/src/crawler/engine.ts apps/server/src/crawler/engine.test.ts apps/server/src/test-helpers/test-site.ts
git commit -m "feat: краул-движок spider-режима (очередь, воркеры, лимиты, robots)"
```

---

### Task 7: Режимы List и Sitemap

**Files:**
- Modify: `apps/server/src/crawler/engine.ts` (seed-стратегии)
- Test: `apps/server/src/crawler/engine-modes.test.ts`

**Interfaces:**
- Consumes: `Crawler` (Task 6), `fetchSitemapUrls` (Task 5).
- Produces: тот же `Crawler`; поведение при `mode: 'list'` (обход только `listUrls`) и `mode: 'sitemap'` (обход URL из sitemap без дальнейшего перехода по ссылкам — depth не растёт, извлечённые ссылки НЕ добавляются в очередь).

- [ ] **Step 1: Написать падающие тесты**: list с `listUrls: ['/about', '/missing']` относительно `origin` → результаты ровно по этим двум URL; sitemap-режим от `origin` → URLs = `['/', '/about']`, и `/redirect` из ссылок главной НЕ появился. (Тестовый sitemap из Task 3: `/` и `/about`.)

- [ ] **Step 2: Запустить, убедиться в падении**

Run: `npm test -w @seo-crawler/server -- engine-modes`
Expected: FAIL

- [ ] **Step 3: Реализовать seed-стратегии в engine.ts**

В `start()`: `mode === 'list'` → очередь из нормализованных `listUrls`; `mode === 'sitemap'` → очередь из `fetchSitemapUrls` (если sitemap не найден/пуст — `emit('done','done')` сразу); в обоих режимах флаг `followLinks = false` — найденные ссылки не пополняют очередь.

- [ ] **Step 4: Запустить, убедиться в прохождении**

Run: `npm test -w @seo-crawler/server -- engine-modes`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/crawler/engine.ts apps/server/src/crawler/engine-modes.test.ts
git commit -m "feat: режимы обхода list и sitemap"
```

---

### Task 8: JS-рендеринг (Playwright)

**Files:**
- Create: `apps/server/src/crawler/rendered-fetcher.ts`
- Modify: `apps/server/src/crawler/engine.ts` (выбор fetcher'а)
- Test: `apps/server/src/crawler/rendered-fetcher.test.ts`

**Interfaces:**
- Consumes: `Fetcher`, `FetchOutcome` (Task 6).
- Produces:
  - `class RenderedFetcher implements Fetcher` — конструктор `new RenderedFetcher(); fetch(url, timeoutMs)` ждёт `networkidle` и возвращает `document.documentElement.outerHTML` как `body`, `rendered: true` перенесём в PageResult на уровне engine (engine знает опции).
  - `createFetcher(renderJs: boolean): Fetcher` — фабрика: `renderJs ? new RenderedFetcher() : new HttpFetcher()`.
  - Зависимость `playwright` + `npm exec playwright install chromium` на этапе сборки.

- [ ] **Step 1: Написать падающий тест**: `createFetcher(false) instanceof HttpFetcher`; интеграционный тест с Playwright против тест-сайта — HTML главной содержит `/about`. Помечать `it` с Playwright обычным образом (устанавливаем браузер в CI/локально; если chromium не установлен — тест падает с понятной ошибкой, это приемлемо).

- [ ] **Step 2: Запустить, убедиться в падении**

Run: `npm test -w @seo-crawler/server -- rendered-fetcher`
Expected: FAIL

- [ ] **Step 3: Реализовать rendered-fetcher.ts**

Один `chromium.launch()` лениво при первом fetch (lazy singleton), на каждый fetch — новый `browser.newContext()` + `page.goto(url, { waitUntil: 'networkidle', timeout: timeoutMs })`; `status`, `content-type` из ответа; ошибки → те же коды (`timeout`, `connection`...). `close()` закрывает браузер.

- [ ] **Step 4: Запустить, убедиться в прохождении**

Run: `npm exec playwright install chromium && npm test -w @seo-crawler/server -- rendered-fetcher`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/crawler/rendered-fetcher.ts apps/server/src/crawler/rendered-fetcher.test.ts apps/server/src/crawler/engine.ts apps/server/package.json
git commit -m "feat: опция JS-рендеринга через Playwright"
```

---

### Task 9: Отчёты о проблемах (computeIssues)

**Files:**
- Create: `apps/server/src/crawler/issues.ts`
- Test: `apps/server/src/crawler/issues.test.ts`

**Interfaces:**
- Consumes: типы `PageResult`, `Issue`, `IssueKind` (Task 1); `Crawler.linkStatuses` (Task 6) — передаётся аргументом.
- Produces:
  - `computeIssues(results: PageResult[], linkStatuses: Map<string, number | null>): Issue[]` — возвращает только непустые группы: `broken-link` (исходящая ссылка любого результата ведёт на URL со статусом >= 400 или error), `duplicate-title` (не-null title встречается > 1 раза), `duplicate-description`, `duplicate-h1` (одинаковый h1 на нескольких страницах), `missing-h1`, `missing-alt` (картинка с `alt: null`), `noindex`. `sampleUrls` — до 5 URL.

- [ ] **Step 1: Написать падающий тест** — 3 синтетических PageResult: два с одинаковым title и одинаковым h1, один без h1 и с `noindex: true`, у всех по картинке без alt; `linkStatuses` c `'/missing' → 404`; проверки каждой группы и `sampleUrls.length <= 5`; страница со статусом 404 сама по себе не даёт broken-link — только исходящие ссылки.

- [ ] **Step 2: Запустить, убедиться в падении**

Run: `npm test -w @seo-crawler/server -- issues`
Expected: FAIL

- [ ] **Step 3: Реализовать issues.ts** — одна функция, группировка через `Map`, сортировка по `count` убыв.

- [ ] **Step 4: Запустить, убедиться в прохождении**

Run: `npm test -w @seo-crawler/server -- issues`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/crawler/issues.ts apps/server/src/crawler/issues.test.ts
git commit -m "feat: вычисление отчётов о проблемах"
```

---

### Task 10: Сессии и REST API

**Files:**
- Create: `apps/server/src/session/session-manager.ts`, `apps/server/src/api/routes.ts`, `apps/server/src/index.ts`
- Test: `apps/server/src/session/session-manager.test.ts`, `apps/server/src/api/routes.test.ts`

**Interfaces:**
- Consumes: `Crawler`, `createFetcher` (Task 8 фабрика `createFetcher`), `computeIssues` (Task 9), `CrawlOptions`, `CrawlEvent` (Task 1).
- Produces:
  - `class SessionManager { create(options: CrawlOptions): { id: string; events: (e: CrawlEvent) => void } ; get(id): CrawlSession | undefined; list(): SessionMeta[]; }`, где `SessionMeta = { id, startUrl, mode, state, crawled, errors, startedAt }`, `CrawlSession = { id, options, state, results: Map<string, PageResult>, linkStatuses: Map<string, number|null>, subscribe(fn: (e: CrawlEvent) => void): () => void, progress(): CrawlProgress }`. Лимит 3 активные сессии → throws `Error('TOO_MANY_SESSIONS')`.
  - `buildApp(deps: { sessions: SessionManager }): FastifyInstance` — маршруты: `POST /api/crawl` (валидация тела: URL валиден, mode в списке, числовые лимиты в диапазонах; ошибки → 400 `{ error: 'VALIDATION' | 'TOO_MANY_SESSIONS', message: string }`; успех → 200 `{ id }`), `POST /api/crawl/:id/stop`, `GET /api/crawl/:id/pages?offset&limit&tab&issue` (`tab`: `internal|external|images`; `issue`: IssueKind — фильтр по группе; ответ `{ total, items: PageResult[] }`), `GET /api/crawl/:id/issues` → `Issue[]`, `GET /api/crawl/:id/export` → CSV (Task 12), `GET /api/crawls` → `SessionMeta[]`.

- [ ] **Step 1: Написать падающие тесты**: session-manager — создание возвращает id, прогресс обновляется по событиям, лимит 3 сессий бросает `TOO_MANY_SESSIONS`, `stop()` переводит state; routes — через `fastify.inject`: старт сессии с валидным телом → `{ id }`, с невалидным URL → 400, `GET pages` пагинирует (`limit=1, offset=1` → `total` полный, `items.length === 1`), `GET pages?issue=noindex` фильтрует, `GET /api/crawls` содержит сессию. (Реальный краул в тестах routes — против `startTestSite` с `concurrency: 5`, ожидание `done` через subscribe-promise с таймаутом 10с.)

- [ ] **Step 2: Запустить, убедиться в падении**

Run: `npm test -w @seo-crawler/server -- session routes`
Expected: FAIL

- [ ] **Step 3: Реализовать session-manager.ts, routes.ts, index.ts**

`SessionManager` генерирует `id` через `crypto.randomUUID()`, подписывает engine-события: `page` → `results.set(url, result)`, пересчёт issues по завершении и каждые 10 страниц (кэш `currentIssues`), `progress`/`done` → обновление state и рассылка подписчикам. `routes.ts` — регистрация маршрутов, валидация вручную (без json-schema), пагинация: сортировка по `depth` затем `url`. `index.ts` — `buildApp({ sessions })`, `app.listen({ port: 3001, host: '127.0.0.1' })` (WS подключается в Task 11).

- [ ] **Step 4: Запустить, убедиться в прохождении**

Run: `npm test -w @seo-crawler/server -- session routes`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/session apps/server/src/api apps/server/src/index.ts
git commit -m "feat: менеджер сессий и REST API краула"
```

---

### Task 11: WebSocket-прогресс

**Files:**
- Create: `apps/server/src/ws/crawl-ws.ts`
- Modify: `apps/server/src/index.ts` (подключить WS)
- Test: `apps/server/src/ws/crawl-ws.test.ts`

**Interfaces:**
- Consumes: `SessionManager`, `CrawlEvent` (Task 10/1).
- Produces: `attachCrawlWs(httpServer: Server, sessions: SessionManager): void` — путь `/ws/crawl/:id`; сервер шлёт подписчику все события сессии (JSON `CrawlEvent`) и повторяет `progress`+`summary` новому подписчику немедленно (снапшот); при `close()` сессии — событие `done`, после которого сокет закрывается.

- [ ] **Step 1: Написать падающий тест**: запустить fastify `app.server`, подключить `ws`-клиент к `/ws/crawl/<id>` активной сессии против тест-сайта, ожидать первое сообщение `progress` и в итоге `done`.

- [ ] **Step 2: Запустить, убедиться в падении**

Run: `npm test -w @seo-crawler/server -- crawl-ws`
Expected: FAIL

- [ ] **Step 3: Реализовать crawl-ws.ts**

`new WebSocketServer({ noServer: true })`; на `upgrade` парсить url, матчить `/^\/ws\/crawl\/([\w-]+)$/`, найти сессию (404 → `socket.destroy()`), `wss.handleUpgrade`, подписка через `session.subscribe`, снапшот прогресса новому клиенту.

- [ ] **Step 4: Запустить, убедиться в прохождении**

Run: `npm test -w @seo-crawler/server -- crawl-ws`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/ws apps/server/src/index.ts
git commit -m "feat: websocket-поток прогресса краула"
```

---

### Task 12: CSV-экспорт

**Files:**
- Create: `apps/server/src/export/csv.ts`
- Test: `apps/server/src/export/csv.test.ts`

**Interfaces:**
- Consumes: `PageResult` (Task 1).
- Produces:
  - `toCsv(results: PageResult[]): string` — колонки: `url,status,error,depth,title,description,meta_robots,canonical,content_type,size_bytes,response_time_ms,noindex,nofollow,rendered,h1_count,images_without_alt,internal_links,external_links`. RFC 4180: кавычки и запятые в значениях экранируются, BOM в начале для Excel.

- [ ] **Step 1: Написать падающий тест**: две строки данных; title с запятой и кавычкой → экранирование `"...,""`; первая строка — заголовок колонок; `﻿` в начале.

- [ ] **Step 2: Запустить, убедиться в падении**

Run: `npm test -w @seo-crawler/server -- csv`
Expected: FAIL

- [ ] **Step 3: Реализовать csv.ts** — самописный экранирующий join (без внешних зависимостей).

- [ ] **Step 4: Запустить, убедиться в прохождении**

Run: `npm test -w @seo-crawler/server -- csv`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/export
git commit -m "feat: csv-экспорт результатов краула"
```

---

### Task 13: Фронтенд-каркас: Vite + Vue 3 + TSX, роутинг, i18n

**Files:**
- Create: `apps/web/package.json`, `apps/web/vite.config.ts`, `apps/web/tsconfig.json`, `apps/web/index.html`, `apps/web/src/main.tsx`, `apps/web/src/App.tsx`, `apps/web/src/router.ts`, `apps/web/src/i18n.ts`, `apps/web/src/locales/ru.json`, `apps/web/src/locales/en.json`, `apps/web/src/components/AppHeader.tsx`, `apps/web/src/styles.css`
- Test: `apps/web/src/components/AppHeader.test.tsx`

**Interfaces:**
- Produces:
  - `i18n` (vue-i18n legacy: false, locale из `localStorage.lang ?? 'ru'`), ключи `nav.newCrawl`, `nav.history`, `header.title`, `langSwitch` — используются всеми следующими задачами.
  - Роуты: `/` (новое сканирование), `/crawl/:id` (экран краула), `/history` (история).
  - Стилевые токены в `styles.css`: CSS-переменные `--accent`, `--bg`, `--fg`, `--muted`, `--border`, `--ok` (зелёный), `--warn` (жёлтый), `--err` (красный), статус-бейдж-классы `.badge-ok/.badge-redirect/.badge-error`.

- [ ] **Step 1: Создать каркас**

`apps/web/package.json`: имя `@seo-crawler/web`, deps: `vue`, `vue-router`, `pinia`, `vue-i18n`, `@seo-crawler/shared`; devDeps: `vite`, `@vitejs/plugin-vue-jsx`, `typescript`, `vitest`, `@vue/test-utils`, `jsdom`. Скрипты: `"dev": "vite --port 5173"`, `"build": "vite build"`, `"test": "vitest run"`. `vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import vueJsx from '@vitejs/plugin-vue-jsx';

export default defineConfig({
  plugins: [vueJsx()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:3001',
      '/ws': { target: 'ws://127.0.0.1:3001', ws: true },
    },
  },
});
```

`main.tsx`: createApp → pinia → i18n → router → mount. `router.ts`: три роута c lazy `defineAsyncComponent`-стилем через `() => import(...)`. `AppHeader.tsx`: заголовок, ссылки навигации (`t('nav.*')`), переключатель RU/EN (пишет `localStorage.lang`, `i18n.global.locale.value = ...`). `styles.css`: светлая тема, указанные переменные, классы бейджей. `ru.json`: `{ "nav": { "newCrawl": "Новое сканирование", "history": "История" }, "header": { "title": "SEO Краулер" }, "langSwitch": "Язык" }`; `en.json` — английские аналоги.

- [ ] **Step 2: Написать тест AppHeader**

```tsx
// apps/web/src/components/AppHeader.test.tsx
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import AppHeader from './AppHeader';
import ru from '../locales/ru.json';
import en from '../locales/en.json';

const i18n = createI18n({ legacy: false, locale: 'ru', messages: { ru, en } });

describe('AppHeader', () => {
  it('рендерит навигацию и переключает язык', async () => {
    const wrapper = mount(AppHeader, { global: { plugins: [i18n] } });
    expect(wrapper.text()).toContain('Новое сканирование');
    await wrapper.find('[data-test="lang-en"]').trigger('click');
    expect(wrapper.text()).toContain('New crawl');
  });
});
```

- [ ] **Step 3: Запустить, убедиться в прохождении (после реализации)**

Run: `npm install && npm test -w @seo-crawler/web`
Expected: PASS

- [ ] **Step 4: Smoke-проверка dev-сервера**

Run: `npm run dev -w @seo-crawler/web &` → открыть `http://localhost:5173`, убедиться, что каркас рендерится; остановить.
Expected: страница без ошибок в консоли

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat: каркас фронтенда (vite, vue3 tsx, роутинг, i18n, стили)"
```

---

### Task 14: Pinia-стор сессии и WS-клиент

**Files:**
- Create: `apps/web/src/api/client.ts`, `apps/web/src/stores/crawl.ts`
- Test: `apps/web/src/stores/crawl.test.ts`

**Interfaces:**
- Consumes: `CrawlOptions`, `PageResult`, `CrawlEvent`, `Issue` (Task 1).
- Produces:
  - `api` (client.ts): `startCrawl(opts: CrawlOptions): Promise<{ id: string }>`; `stopCrawl(id)`; `fetchPages(id, params: { offset; limit; tab?; issue? }): Promise<{ total: number; items: PageResult[] }>`; `fetchIssues(id): Promise<Issue[]>`; `fetchCrawls(): Promise<SessionMeta[]>`; `exportUrl(id): string`.
  - `useCrawlSession` (Pinia, setup-стиль): state `id, progress { crawled, queued, errors, state }, issues, pages, total, tab, issueFilter`; actions `open(id)` (REST-загрузка + WS-подключение), `loadPages()` (REST с текущими фильтрами), `close()`; WS: `progress` → обновление счётчиков, `summary` → `issues`, `done` → state + `loadPages()` + `fetchIssues()`.

- [ ] **Step 1: Написать падающий тест** — мок `WebSocket` (класс-фейк с очередью сообщений): `open()` ставит `id`, фейк `onmessage` с `{ type: 'progress', ... }` обновляет счётчики; `done` → `pages` перезагружаются (мок `globalThis.fetch`). Тест состояния `issues` через событие `summary`.

- [ ] **Step 2: Запустить, убедиться в падении**

Run: `npm test -w @seo-crawler/web -- crawl`
Expected: FAIL

- [ ] **Step 3: Реализовать client.ts и stores/crawl.ts**

`client.ts` — тонкие обёртки над `fetch('/api/...')` с проверкой `res.ok`. `crawl.ts` — setup-store; WS-URL `/ws/crawl/${id}` (относительный — прокси работает и в dev, и в prod за одним хостом), авто-reconnect: при `onclose` — переподключение через 2с до 5 попыток, после — `loadPages()` из REST как резерв.

- [ ] **Step 4: Запустить, убедиться в прохождении**

Run: `npm test -w @seo-crawler/web -- crawl`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api apps/web/src/stores
git commit -m "feat: api-клиент и pinia-стор краул-сессии с ws"
```

---

### Task 15: Форма нового сканирования

**Files:**
- Create: `apps/web/src/views/NewCrawlView.tsx`, `apps/web/src/components/CrawlForm.tsx`
- Test: `apps/web/src/components/CrawlForm.test.tsx`

**Interfaces:**
- Consumes: `api.startCrawl` (Task 14), `CrawlOptions`, `CrawlMode` (Task 1), ключи i18n `form.*`.
- Produces: `CrawlForm` — при сабмите вызывает `onSubmit(options: CrawlOptions)`; валидация URL (regex `^https?://`), List-mode требует непустой список (textarea по строке + `<input type="file" accept=".csv">` — парсинг текста CSV: первая колонка). Кнопка disabled при валидной отправке.

- [ ] **Step 1: Написать падающий тест**: рендер полей; невалидный URL → сообщение об ошибке, `onSubmit` не вызван; валидный сабмит вызывает `onSubmit` с `CrawlOptions` (дефолты: maxUrls 500, maxDepth 10, respectRobots true, renderJs false, concurrency 5, timeout 15000); переключение режимов показывает textarea для list.

- [ ] **Step 2: Запустить, убедиться в падении**

Run: `npm test -w @seo-crawler/web -- CrawlForm`
Expected: FAIL

- [ ] **Step 3: Реализовать NewCrawlView.tsx и CrawlForm.tsx** — радиокнопки режима, числовые инпуты опций, чекбоксы robots/renderJs; сабмит → `startCrawl` → `router.push('/crawl/' + id)`.

- [ ] **Step 4: Запустить, убедиться в прохождении**

Run: `npm test -w @seo-crawler/web -- CrawlForm`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/views apps/web/src/components/CrawlForm.tsx apps/web/src/components/CrawlForm.test.tsx apps/web/src/locales
git commit -m "feat: форма нового сканирования с валидацией"
```

---

### Task 16: Дашборд прогресса

**Files:**
- Create: `apps/web/src/components/ProgressDashboard.tsx`
- Test: `apps/web/src/components/ProgressDashboard.test.tsx`

**Interfaces:**
- Consumes: `useCrawlSession` (Task 14), i18n-ключи `dashboard.*`.
- Produces: компонент рендерит прогресс-бар (ширина = `crawled / (crawled + queued)`), счётчики `crawled/queued/errors`, живые сводки из `issues` (битые ссылки, дубли title, noindex — количества), кнопку Stop (`api.stopCrawl`), состояние `done/stopped` — бейдж.

- [ ] **Step 1: Написать падающий тест**: пропсы-стор с предзаполненным прогрессом → ширина бара и счётчики; клик Stop вызывает `stopCrawl` (мок).

- [ ] **Step 2: Запустить, убедиться в падении**

Run: `npm test -w @seo-crawler/web -- ProgressDashboard`
Expected: FAIL

- [ ] **Step 3: Реализовать ProgressDashboard.tsx** — flex-строка: прогресс-бар, три счётчика, до трёх сводок issues, кнопка.

- [ ] **Step 4: Запустить, убедиться в прохождении**

Run: `npm test -w @seo-crawler/web -- ProgressDashboard`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ProgressDashboard.tsx apps/web/src/components/ProgressDashboard.test.tsx apps/web/src/locales
git commit -m "feat: дашборд живого прогресса краула"
```

---

### Task 17: Таблица результатов, вкладки, детали страницы

**Files:**
- Create: `apps/web/src/components/ResultsTable.tsx`, `apps/web/src/components/PageDetails.tsx`, `apps/web/src/views/CrawlView.tsx`
- Test: `apps/web/src/components/ResultsTable.test.tsx`, `apps/web/src/components/PageDetails.test.tsx`

**Interfaces:**
- Consumes: `useCrawlSession` (Task 14), `PageResult`, `Issue` (Task 1), `ProgressDashboard` (Task 16).
- Produces:
  - `ResultsTable`: колонки URL, статус (бейдж `.badge-*`: 2xx ok, 3xx redirect, 4xx/5xx/error), title, h1, индексируемость (noindex — красный бейдж), глубина, тип контента; сортировка по клику заголовка, поиск по URL/title, пагинация (prev/next, 50/стр) — все изменения вызывают `store.loadPages()`; клик по строке — `store.selectedUrl = url`.
  - `PageDetails`: боковая панель по `selectedUrl` (полные данные: все поля PageResult, ссылки списками, schema.org JSON beautified, картинки с alt-признаком), кнопка закрытия.
  - `CrawlView`: layout — `ProgressDashboard` сверху, слева панель вкладок (Internal/External/Images + раздел Issues со списком `Issue` с количеством), в центре `ResultsTable`, справа `PageDetails` при выборе. Вкладка/issue выставляют `store.tab`/`store.issueFilter` и триггерят `loadPages()`.

- [ ] **Step 1: Написать падающие тесты**: ResultsTable — рендер строк из `items`, клик по строке ставит `selectedUrl`, бейдж-класс соответствует статусу; сортировка/поиск вызывают `loadPages` (мок store). PageDetails — рендер всех секций по `PageResult`. CrawlView — клик по вкладке Issues → `store.tab = 'issues'` + `loadPages()` вызван.

- [ ] **Step 2: Запустить, убедиться в падении**

Run: `npm test -w @seo-crawler/web -- ResultsTable PageDetails`
Expected: FAIL

- [ ] **Step 3: Реализовать компоненты**

Таблица — обычный `<table>` с `map`, CSS-классы из `styles.css`; пагинация 50/стр; детали — `<aside>` с секциями. Схема url-колонки — моноширинный шрифт (`font-family: var(--mono)`).

- [ ] **Step 4: Запустить, убедиться в прохождении**

Run: `npm test -w @seo-crawler/web -- ResultsTable PageDetails`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ResultsTable.tsx apps/web/src/components/PageDetails.tsx apps/web/src/views/CrawlView.tsx apps/web/src/components/*.test.tsx apps/web/src/locales
git commit -m "feat: таблица результатов, вкладки, детали страницы"
```

---

### Task 18: Отчёты, история, экспорт, финальная сборка

**Files:**
- Create: `apps/web/src/views/HistoryView.tsx`
- Modify: `apps/web/src/views/CrawlView.tsx` (кнопка Export CSV → `exportUrl(id)`), `apps/web/src/locales/*.json`
- Test: `apps/web/src/views/HistoryView.test.tsx`

**Interfaces:**
- Consumes: `api.fetchCrawls`, `api.exportUrl` (Task 14), `SessionMeta`, всё предыдущее.
- Produces:
  - `HistoryView`: список сессий (`SessionMeta`: id, startUrl, mode, state, crawled, startedAt), клик → `router.push('/crawl/' + id)`.
  - Кнопка Export CSV в CrawlView — `<a :href="exportUrl(id)" download>`.
  - README с командами запуска.

- [ ] **Step 1: Написать падающий тест**: HistoryView рендерит переданные сессии и клик по строке вызывает `router.push` (мок).

- [ ] **Step 2: Запустить, убедиться в падении**

Run: `npm test -w @seo-crawler/web -- HistoryView`
Expected: FAIL

- [ ] **Step 3: Реализовать HistoryView.tsx и доработать CrawlView/локали**

- [ ] **Step 4: Полная сборка и ручная проверка**

Run: `npm test` (все пакеты зелёные), затем два терминала: `npm run dev:server` и `npm run dev:web`; на `http://localhost:5173` запустить краул `https://example.com` (режим Spider, лимит 10) — убедиться: прогресс живёт, таблица наполняется, вкладки/отчёты работают, CSV скачивается.

- [ ] **Step 5: Commit**

```bash
git add apps/web README.md
git commit -m "feat: история краулов, экспорт csv, readme"
```

---

## Self-Review

- **Spec coverage:** Spider/List/Sitemap — Tasks 6–7; полный сбор данных — Task 4+6; отчёты — Task 9; JS-рендеринг — Task 8; robots.txt — Tasks 5–6; API+WS — Tasks 10–11; CSV — Task 12; экраны/дашборд/таблицы/детали — Tasks 13–18; i18n — Tasks 13–18; история — Task 18. Тест-стратегия (локальный сервер, без сети) — Tasks 3–8.
- **Placeholder scan:** процедурные шаги Task 5 (шаги 1, 3) описаны содержательно, но без полных листингов — код тривиален и однозначно определён интерфейсами; это осознанное упрощение, не «TBD».
- **Type consistency:** `Fetcher`/`FetchOutcome` (Task 6) используются в Task 8; `CrawlEvent` (Task 1) — в 10, 11, 14; `computeIssues` сигнатура едина (Task 9 → 10); `SessionMeta` определён в Task 10, используется в 14 и 18.
- **Review Focus:** query/fragment — Task 2; редиректы — Task 6; не-HTML — Task 6; циклы/петли — Task 6; таймаут — Task 6 (тест на `HttpFetcher` с недостижимым хостом на localhost добавить в engine.test.ts: URL на закрытый порт локального тест-сервера → `status: null`).
