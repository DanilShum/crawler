# Ре-структура проекта по образцу fe/ (декларативная организация)

**Дата:** 2026-10-16
**Статус:** дизайн одобрен в диалоге
**Референс:** /Users/dashumilkin/VSCodeProject/fe (Nuxt-проект: components по фичам, constants/, helpers/, utils/, composables/)

## Контекст и цель

Фронтенд seo-crawler почти плоский: 5 компонентов в одной папке, `issue-labels.ts` и
`i18n.ts` на корне `src`, захардкоженные TABS в CrawlView и навигация в AppHeader.
Референсный проект группирует код по фичам и темам, объявляет данные как конфиги.

Цель: перенести принципы референса на оба приложения (web + server), не меняя логики.
Решение пользователя: web + server; декларативность = конфиг-структуры + стиль
компонентов (сохранить) + роуты из конфига.

## Фронтенд `apps/web/src`

```
api/client.ts                          # без изменений
components/<name>/
  <name>.tsx · <name>.test.tsx · index.ts   # папка на компонент, barrel
constants/
  index.ts                             # barrel: export * from './issues' и т.д.
  issues.ts                            # ISSUE_LABELS (из src/issue-labels.ts)
  tabs.ts                              # TABS краул-экрана (из CrawlView)
  table.ts                             # конфиг колонок ResultsTable
helpers/
  index.ts
  format.ts                            # formatBytes, statusClass (чистые функции)
router/
  index.ts                             # createRouter
  routes.ts                            # декларативный конфиг маршрутов
stores/crawl/ crawl.ts · crawl.test.ts · index.ts
views/<name>/ <name>.tsx · <name>.test.tsx · index.ts
i18n.ts · main.tsx · App.tsx · styles.css · vite-env.d.ts   # на корне src
```

### Конфиг колонок таблицы (`constants/table.ts`)

```ts
export interface TableColumn {
  key: SortKey;            // 'url' | 'status' | ...
  labelKey: string;        // i18n-ключ
  sortable: boolean;
  dataTest: string;
  cellClass?: string;      // для type-cell/url-cell
}
export const COLUMNS: TableColumn[] = [...];
export const PAGE_LIMIT = 50;   // из stores/crawl.ts
```

`ResultsTable` рендерит thead/tbody циклом по COLUMNS; не-sortable колонки — plain `<th>`.

### Роуты из конфига (`router/routes.ts`)

```ts
export interface AppRoute {
  path: string;
  name: string;
  component: () => Promise<{ default: Component }> | Component;
  navLabelKey?: string;    // наличие ключа = показ в шапке
}
export const ROUTES: AppRoute[] = [
  { path: '/', name: 'new-crawl', component: NewCrawlView, navLabelKey: 'header.newCrawl' },
  { path: '/crawl/:id', name: 'crawl', component: CrawlView },
  { path: '/history', name: 'history', component: HistoryView, navLabelKey: 'header.history' },
];
```

`router/index.ts` строит роутер из ROUTES; `AppHeader` строит навигацию из
`ROUTES.filter((r) => r.navLabelKey)`. Единственный источник маршрутов и навигации.

## Сервер `apps/server/src`

```
crawler/
  engine.ts · extract.ts · issues.ts · robots.ts · sitemap.ts · url-utils.ts
  fetch/ fetcher.ts · rendered-fetcher.ts    # fetcher'ы вместе
api/
  constants.ts   # лимиты валидации как данные: массив полей { name, min, max, message? }
  routes.ts
export/ · session/ · ws/ · test-helpers/    # как есть
```

Валидация `POST /api/crawl` переписывается декларативно: вместо цепочки if с
дублированными сообщениями — обход конфига полей с границами; специфичные правила
(mode/listUrls) остаются обычным кодом.

## Декларативный стиль (сохраняемый)

Компоненты — `setup()` возвращает render-замыкание; списки (вкладки, колонки,
навигация, лимиты) — типизированные массивы-конфиги, а не императивные блоки JSX/JS.

## Ограничения

- Логика не меняется — чистый refactor; полный сюит зелёный в каждой задаче.
- Тесты переезжают вместе с исходниками; data-test-атрибуты не меняются.
- Баррели `index.ts` на каждую папку компонента/вью/стора/констант.
- Транзитивные импорты обновляются на новые пути; `@seo-crawler/shared` не трогается.

## Вне скоупа

- Переименование CLI-скриптов, tsconfig-алиасы (`@/`), lazy-загрузка вью.
- Реструктуризация packages/shared.
- Изменение публичного API сервера.
