# Структура проекта (web + server) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перенести структуру проекта на фиче-группировку и конфиг-структуры по образцу `fe/` без изменения логики.

**Architecture:** Чистый refactor: файлы переезжают в папки-фичи с barrel-экспортами, данные (вкладки, колонки, лейблы, лимиты валидации, маршруты) выносятся в типизированные конфиги, потребители читают их. Тесты переезжают вместе с кодом, data-test-атрибуты сохраняются.

**Tech Stack:** TypeScript, Vue 3 TSX, vue-router, pinia, vitest, Fastify.

**Spec:** `docs/superpowers/specs/2026-10-16-structure-refactor-design.md`

## Global Constraints

- Логика не меняется: полный `npm test` зелёный в конце каждой задачи; tsc --noEmit чист во всех пакетах.
- data-test-атрибуты и i18n-ключи не меняются.
- Компоненты — `setup()` → render-замыкание; конфиги — типизированные массивы.
- Коммиты по одной фиче.
- Названия тестов — на русском.

## Review Focus

1. **Ничего не потерять при переносе** — каждый barrel экспортирует всё, что импортировалось по старому пути; гейт — `tsc` + полный сюит после каждого таска.
2. **Конфиг колонок не меняет поведение таблицы** — сортируемые колонки дают ровно те же `th` с onClick, несортируемые — plain `th`; порядок и data-test совпадают. Тест: Task 4 (существующие тесты ResultsTable остаются зелёными без правок ассертов).
3. **Навигация из конфига даёт те же ссылки** — порядок и href как в текущем AppHeader. Тест: Task 2 (существующие тесты AppHeader зелёные).
4. **Валидация из конфига даёт те же 400** — сообщения дословно совпадают с текущими. Тест: Task 6 (существующие routes-тесты валидации зелёные).
5. **Lazy-импорты вью остаются lazy** — роутер конфига использует `() => import(...)`. Тест: Task 2.

---

### Task 1: Web — constants/, helpers/ и чистка корня

**Files:**
- Create: `apps/web/src/constants/issues.ts` (содержимое `src/issue-labels.ts`), `constants/tabs.ts`, `constants/index.ts`, `helpers/format.ts`, `helpers/index.ts`
- Delete: `apps/web/src/issue-labels.ts`
- Modify: импорты в `views/CrawlView.tsx`, `components/PageDetails.tsx`, `components/ResultsTable.tsx`, `components/ProgressDashboard.tsx` (если дублирует formatBytes/statusClass)

**Interfaces:**
- Produces: `ISSUE_LABELS: Record<IssueKind, string>` из `constants`; `TABS: Array<{ tab: CrawlTab; labelKey: string }>` из `constants/tabs.ts` (тип `CrawlTab` импортируется из stores); `formatBytes(n: number): string`, `statusClass(page: PageResult): string` из `helpers/format.ts`.

- [ ] **Step 1: Перенести issue-labels → constants/issues.ts** (содержимое с JSDoc «общий для CrawlView и PageDetails»), создать `constants/index.ts` (`export * from './issues'`). Удалить `src/issue-labels.ts`, обновить импорты в CrawlView и PageDetails на `../constants`.

- [ ] **Step 2: constants/tabs.ts** — перенести `TABS` из `views/CrawlView.tsx` (тип `CrawlTab` импортировать из `../stores/crawl`), экспорт через `constants/index.ts`. CrawlView импортирует TABS из `../constants`.

- [ ] **Step 3: helpers/format.ts** — `formatBytes` (из PageDetails) и `statusClass` (дублируется в ResultsTable и PageDetails — оставить одну копию в helpers, обе consume). `helpers/index.ts` — barrel. Удалить локальные копии.

- [ ] **Step 4: Проверка** — `npx tsc --noEmit -p apps/web && npm test -w @seo-crawler/web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "refactor: constants/ (issues, tabs) и helpers/format — чистые функции и данные из компонентов"
```

---

### Task 2: Web — роуты из конфига

**Files:**
- Create: `apps/web/src/router/routes.ts`, `apps/web/src/router/index.ts`
- Delete: `apps/web/src/router.ts`
- Modify: `apps/web/src/main.tsx` (импорт `./router`), `apps/web/src/components/AppHeader.tsx` (навигация из конфига)

**Interfaces:**
- Produces: `ROUTES: AppRoute[]` где `AppRoute = { path: string; name: string; component: () => Promise<unknown>; navLabelKey?: string }`; роутер строится из ROUTES; навигация = `ROUTES.filter((r) => r.navLabelKey !== undefined)`.

- [ ] **Step 1: router/routes.ts** — декларативный конфиг (см. спек):

```ts
import type { AppRoute } from './types';

export const ROUTES: AppRoute[] = [
  { path: '/', name: 'new-crawl', component: () => import('../views/new-crawl-view'), navLabelKey: 'nav.newCrawl' },
  { path: '/crawl/:id', name: 'crawl', component: () => import('../views/crawl-view') },
  { path: '/history', name: 'history', component: () => import('../views/history-view'), navLabelKey: 'nav.history' },
];
```

(Вью ещё в старых путях — Task 5 переименует; на этот таск пути указывают на текущие `../views/NewCrawlView` и т.д.) Тип:

```ts
import type { Component } from 'vue';
export interface AppRoute {
  path: string;
  name: string;
  component: () => Promise<{ default: Component }>;
  navLabelKey?: string;
}
```

- [ ] **Step 2: router/index.ts** — `createRouter({ history: createWebHistory(), routes: ROUTES.map((r) => ({ path: r.path, name: r.name, component: r.component })) })`, export default.

- [ ] **Step 3: AppHeader** — навигация из конфига:

```ts
import { ROUTES } from '../router/routes';
// в разметке:
<Navlink v-for по navRoutes />
```

```ts
const navRoutes = ROUTES.filter((r) => r.navLabelKey !== undefined);
```

```tsx
{navRoutes.map((r) => (
  <Navlink key={r.name} to={r.path} data-test={r.name === 'new-crawl' ? 'nav-new-crawl' : 'nav-history'}>
    {t(r.navLabelKey!)}
  </Navlink>
))}
```

data-test: добавить в AppRoute поле `navDataTest?: string` вместо условного тернарника — `{ path: '/', name: 'new-crawl', navLabelKey: 'nav.newCrawl', navDataTest: 'nav-new-crawl' }`. data-test-атрибуты в DOM не меняются.

- [ ] **Step 4: Проверка** — `npx tsc --noEmit -p apps/web && npm test -w @seo-crawler/web`
Expected: PASS (существующие тесты AppHeader зелёные).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "refactor: роуты и навигация шапки из единого декларативного конфига router/routes.ts"
```

---

### Task 3: Web — компоненты в папки-фичи

**Files:**
- Create: `apps/web/src/components/app-header/`, `crawl-form/`, `page-details/`, `progress-dashboard/`, `results-table/` — каждая: `<name>.tsx`, `<name>.test.tsx`, `index.ts` (`export { default } from './<name>'`)
- Modify: импорты в `views/*`, `App.tsx` (AppHeader), роутере (нет — роутер импортирует только вью)

- [ ] **Step 1: Перенести 5 компонентов** (git mv для сохранения истории), создать barrels, обновить импорты (`../components/AppHeader` → `../components/app-header` и т.д.).

- [ ] **Step 2: Проверка** — `npx tsc --noEmit -p apps/web && npm test -w @seo-crawler/web`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src
git commit -m "refactor: компоненты в папки-фичи с barrel-экспортами"
```

---

### Task 4: Web — конфиг колонок ResultsTable

**Files:**
- Create: `apps/web/src/constants/table.ts`
- Modify: `components/results-table/results-table.tsx` (thead/tbody циклом), `stores/crawl.ts` — `PAGE_LIMIT` переносится в `constants/table.ts`

**Interfaces:**
- Produces: `interface TableColumn { key: SortKey; labelKey: string; sortable: boolean; dataTest: string; cellClass?: string }`; `COLUMNS: TableColumn[]`; `PAGE_LIMIT = 50` из constants (stores/crawl.ts и ResultsTable импортируют оттуда).

- [ ] **Step 1: constants/table.ts**

```ts
import type { PageResult } from '@seo-crawler/shared';

export type SortKey = 'url' | 'status' | 'title' | 'h1' | 'noindex' | 'depth' | 'contentType';
export interface TableColumn {
  key: SortKey;
  labelKey: string;
  sortable: boolean;
  dataTest: string;
  cellClass?: string;
}
export const COLUMNS: TableColumn[] = [
  { key: 'url', labelKey: 'table.url', sortable: true, dataTest: 'th-url', cellClass: 'url-cell' },
  { key: 'status', labelKey: 'table.status', sortable: true, dataTest: 'th-status' },
  { key: 'title', labelKey: 'table.title', sortable: true, dataTest: 'th-title' },
  { key: 'h1', labelKey: 'table.h1', sortable: true, dataTest: 'th-h1' },
  { key: 'noindex', labelKey: 'table.indexability', sortable: true, dataTest: 'th-noindex' },
  { key: 'depth', labelKey: 'table.depth', sortable: true, dataTest: 'th-depth' },
  { key: 'contentType', labelKey: 'table.contentType', sortable: true, dataTest: 'th-contentType', cellClass: 'type-cell' },
  { key: 'wordCount', labelKey: 'table.wordCount', sortable: false, dataTest: 'th-wordCount' },
];
export const PAGE_LIMIT = 50;
```

dataTest для существующих колонок повторяет текущий шаблон `th-${key}` — DOM не меняется.

- [ ] **Step 2: ResultsTable** — `SortKey` импортируется из `constants/table.ts` (убрать локальный тип); thead:

```tsx
{COLUMNS.map((col) => col.sortable
  ? header(col.key, col.labelKey)
  : <th key={col.key} data-test={col.dataTest}>{t(col.labelKey)}</th>)}
```

tbody — рендер по `col.key` через существующий switch-хелпер (`renderCell(page, col)` локальный, значения как сейчас). `cellClass` применяется к td. Логика `sortValue`, бейджи статуса/noindex — без изменений (status/noindex не сводятся к простому тексту — их ячейки рендерятся спец-ветками по key, остальное — `{page[col.key] ?? '—'}`).

- [ ] **Step 3: stores/crawl.ts** — `const PAGE_LIMIT = 50` удалить, импортировать из `../constants`. `constants/index.ts` — добавить `export * from './table'`.

- [ ] **Step 4: Проверка** — `npx tsc --noEmit -p apps/web && npm test -w @seo-crawler/web`
Expected: PASS — все существующие тесты ResultsTable зелёные БЕЗ правок ассертов (Review Focus 2).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "refactor: колонки таблицы и PAGE_LIMIT — декларативный конфиг constants/table.ts"
```

---

### Task 5: Web — views в папки, stores/crawl/ с barrel

**Files:**
- Create: `views/crawl-view/` (crawl-view.tsx, crawl-view.test.tsx, index.ts), `views/history-view/`, `views/new-crawl-view/` (только index.ts + new-crawl-view.tsx)
- Create: `stores/crawl/crawl.ts`, `stores/crawl/crawl.test.ts`, `stores/crawl/index.ts`; удалить `stores/crawl.ts`, `stores/crawl.test.ts`
- Modify: `router/routes.ts` (пути импортов вью — на папки), `components/*` (импорт `../stores/crawl` → `../../stores/crawl`)

- [ ] **Step 1: Перенос** (git mv), barrels, обновление импортов (router, App, тесты).

- [ ] **Step 2: Проверка** — `npx tsc --noEmit -p apps/web && npm test -w @seo-crawler/web`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src
git commit -m "refactor: views и stores в папки-фичи с barrel-экспортами"
```

---

### Task 6: Server — crawler/fetch/ и декларативная валидация

**Files:**
- Create: `apps/server/src/crawler/fetch/` (fetcher.ts, rendered-fetcher.ts — git mv), `apps/server/src/api/constants.ts`
- Modify: все импорты fetcher'ов (`crawler/rendered-fetcher.ts` → `crawler/fetch/rendered-fetcher.ts`): `engine.ts`, `test-helpers/no-network-fetcher.ts`, тесты; `api/routes.ts`

**Interfaces:**
- Produces: `api/constants.ts`:

```ts
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
export const TABS = ['internal', 'external', 'images'] as const;
```

- [ ] **Step 1: git mv fetcher'ов в `crawler/fetch/`**, обновить импорты (grep по `from './fetcher'`, `from '../crawler/rendered-fetcher'`, `from './rendered-fetcher'`).

- [ ] **Step 2: api/constants.ts + декларативная валидация** — цикл по NUMERIC_FIELDS вместо четырёх if (сообщения генерируются шаблоном `${name} должен быть целым числом от ${min} до ${max}` — дословно текущие); `TABS` из констант в `GET /pages`. Специфичные правила (startUrl/mode/listUrls/boolean) остаются кодом. Проверка по Review Focus 4: сообщения в тестах не меняются.

- [ ] **Step 3: Проверка** — `npx tsc --noEmit -p apps/server && npm test -w @seo-crawler/server`
Expected: PASS — все тесты валидации зелёные без правок сообщений.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src
git commit -m "refactor: fetcher'ы в crawler/fetch/, лимиты валидации — конфиг api/constants.ts"
```

---

### Task 7: Финальная проверка

- [ ] **Step 1:** `npm test` в корне — все пакеты зелёные; tsc чист во всех трёх пакетах.
- [ ] **Step 2:** ручная проверка `npm run dev` — приложение работает, вкладки/навигация/таблица/детали без изменений.
- [ ] **Step 3:** финальный коммит, если что-то накопилось.

## Self-Review

- **Spec coverage:** constants/issues+tabs — Task 1; router config — Task 2; components по фичам — Task 3; конфиг колонок + PAGE_LIMIT — Task 4; views/stores папки — Task 5; server fetch/ + валидация-конфиг — Task 6; сборка — Task 7. `helpers/format.ts` — Task 1.
- **Placeholder scan:** «renderCell» в Task 4 описан контрактом (ключи, спец-ветки по key) — код ячеек остаётся существующим, переносится в switch по col.key; нет TBD.
- **Type consistency:** SortKey из constants/table.ts используется в ResultsTable; CrawlTab остаётся в stores/crawl (Task 1 импортирует его для tabs.ts — цикла нет: constants → stores тип, stores → constants PAGE_LIMIT в Task 4 — тип `CrawlTab` определяется в stores/crawl.ts, tabs.ts импортирует type-only — цикла рантайма нет).
- **Review Focus:** перенос без потерь — tsc+тесты каждый таск; таблица — Task 4; навигация — Task 3 (AppHeader тесты); валидация — Task 6; lazy-импорты — Task 2.
