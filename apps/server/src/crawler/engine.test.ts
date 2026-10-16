import { describe, it, expect } from 'vitest';
import { startTestSite } from '../test-helpers/test-site';
import { NoNetworkFetcher } from '../test-helpers/no-network-fetcher';
import { Crawler } from './engine';
import type { Fetcher } from './fetcher';
import type { CrawlOptions, PageResult } from '@seo-crawler/shared';

function opts(origin: string, over: Partial<CrawlOptions> = {}): CrawlOptions {
  return { startUrl: origin + '/', mode: 'spider', maxUrls: 500, maxDepth: 10,
    respectRobots: true, renderJs: false, concurrency: 5, requestTimeoutMs: 5000, ...over };
}

async function run(origin: string, o: CrawlOptions) {
  // NoNetworkFetcher заглушает DNS-запросы к внешним хостам (external.example в фикстуре) —
  // тесты не делают сетевых вызовов наружу.
  const fetcher = new NoNetworkFetcher();
  const pages: PageResult[] = [];
  const finalState: { value: string | null } = { value: null };
  const crawler = new Crawler(o, fetcher, (e) => {
    if (e.type === 'page') pages.push(e.result);
    if (e.type === 'done') finalState.value = e.state;
  });
  await crawler.start();
  fetcher.close();
  return { pages, final: finalState.value, crawler };
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
      expect(final).toBe('done');
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

  it('maxUrls=1 не превышает лимит, даже пока страница ждёт check внешней ссылки', async () => {
    const site = await startTestSite();
    try {
      const { pages, crawler } = await run(site.origin,
        opts(site.origin, { maxUrls: 1 }));
      // Стартовая страница содержит внешнюю ссылку: пока она ждёт check-запрос,
      // другие воркеры могут успеть записать свои страницы — финальная страховка
      // в record() не должна дать результату вырасти сверх maxUrls.
      expect(pages.length).toBe(1);
      // Внешний check действительно выполнился при обработке единственной страницы —
      // окно гонки закрыто, а статус внешней ссылки зафиксирован.
      expect(pages[0].externalLinks.some((l) => l.url.startsWith('https://external.example'))).toBe(true);
      expect(crawler.linkStatuses.has('https://external.example/')).toBe(true);
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

  it('закрытый порт детерминированно даёт страницу со status=null и error=connection', async () => {
    // Self-Review плана: URL на закрытый порт локального тест-сервера → status: null
    const site = await startTestSite();
    const origin = site.origin;
    await site.close();
    const { pages } = await run(origin, opts(origin, { maxUrls: 1 }));
    expect(pages.length).toBe(1);
    expect(pages[0].status).toBeNull();
    expect(pages[0].error).toBe('connection');
  });

  it('respectRobots=false обходит запрещённые пути', async () => {
    const site = await startTestSite();
    try {
      const { pages } = await run(site.origin, opts(site.origin, { respectRobots: false }));
      expect(pages.length).toBeGreaterThan(2);
    } finally { await site.close(); }
  });

  it('уважает Crawl-delay: старты fetch разнесены не меньше crawlDelayMs', async () => {
    const site = await startTestSite(0, { crawlDelaySeconds: 0.15 });
    try {
      // Обёртка-рекордер замеряет моменты стартов fetch (гейт срабатывает до вызова fetcher'а).
      // Делегирует в NoNetworkFetcher: '/' парсится как HTML, и его внешняя ссылка
      // (https://external.example/) запускает check-запрос даже в list-режиме — он не должен идти в DNS.
      const starts: number[] = [];
      const inner = new NoNetworkFetcher();
      const recording: Fetcher = {
        fetch: async (url, timeout) => {
          starts.push(Date.now());
          return inner.fetch(url, timeout);
        },
        close: () => inner.close(),
      };
      const crawler = new Crawler(
        opts(site.origin, {
          mode: 'list',
          listUrls: ['/', '/about', '/missing', '/redirect', '/binary.pdf', '/loop', '/noindex'],
          concurrency: 5,
        }),
        recording,
        () => {},
      );
      await crawler.start();
      await inner.close();

      expect(starts.length).toBeGreaterThan(3);
      for (let i = 1; i < starts.length; i++) {
        expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(150);
      }
    } finally { await site.close(); }
  });
});
