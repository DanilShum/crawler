# SEO Crawler

Веб-приложение-краулер для технического SEO-анализа сайта — аналог
Screaming Frog SEO Spider. Приложение имитирует поведение поискового бота:
пользователь задаёт стартовый URL, краулер обходит сайт и собирает
технические данные (статусы, мета-теги, заголовки, ссылки, директивы
индексации), а результаты показывает в таблицах и отчётах о проблемах.

## Возможности

- **Режимы обхода**: **Spider** (обход по внутренним ссылкам), **List**
  (список URL вручную или импорт из CSV), **Sitemap** (по XML-карте сайта,
  авто-обнаружение через robots.txt).
- **Сбор данных по странице**: HTTP-статус, title, description, meta-robots,
  заголовки h1–h6, изображения (с признаком alt), внутренние/внешние ссылки,
  canonical, noindex/nofollow, Schema.org (JSON-LD), размер и время ответа.
- **Отчёты о проблемах**: битые ссылки, дубли title/description/H1,
  отсутствие H1, изображения без alt, noindex-страницы.
- **JS-рендеринг** (опционально): headless Chromium через Playwright;
  по умолчанию — статический fetch.
- **robots.txt** учитывается (включая Crawl-delay), можно отключить.
- Живой прогресс краула по WebSocket, история завершённых сканирований,
  экспорт результатов в CSV.

## Структура монорепо

```
seo-crawler/
├── apps/
│   ├── web/       # фронтенд: Vite + Vue 3 (TSX), Pinia, vue-router, vue-i18n
│   └── server/    # бэкенд: Fastify, движок краула, REST API + WebSocket, CSV-экспорт
└── packages/
    └── shared/    # общие типы (PageResult, Issue, CrawlEvent, CrawlOptions)
```

## Запуск

Требуется Node.js и npm. Установите зависимости:

```bash
npm install
```

Дальше два терминала.

Терминал 1 — сервер (порт 3001):

```bash
npm run dev:server
```

Терминал 2 — фронтенд (порт 5173, запросы к `/api` и `/ws` проксируются
на сервер):

```bash
npm run dev:web
```

Откройте <http://localhost:5173>, укажите стартовый URL и запустите
сканирование.

## Тесты и сборка

```bash
npm test          # тесты всех пакетов (vitest)
npm run build:web # production-сборка фронтенда (vite build, результат в apps/web/dist)
```

## JS-рендеринг (Playwright)

Чтобы опция «Рендерить JavaScript» работала, нужен браузер Chromium.
Установите его один раз из `apps/server`:

```bash
cd apps/server && npx playwright install chromium
```
