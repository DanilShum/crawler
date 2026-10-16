import { normalizeUrl, isInternal } from './url-utils';
import { extractPageData } from './extract';
import { fetchRobots } from './robots';
import type { RobotsInfo } from './robots';
import { fetchSitemapUrls } from './sitemap';
import type { CrawlOptions, PageResult, HeadingLevel } from '@seo-crawler/shared';
import { createFetcher } from './rendered-fetcher';
import type { Fetcher, FetchOutcome } from './fetcher';

export type EngineEvent =
  | { type: 'page'; result: PageResult }
  | { type: 'progress'; crawled: number; queued: number; errors: number }
  | { type: 'done'; state: 'done' | 'stopped' };

interface QueueItem { url: string; depth: number; }

const EMPTY_HEADINGS: Record<HeadingLevel, string[]> = { h1: [], h2: [], h3: [], h4: [], h5: [], h6: [] };

// Гейт Crawl-delay: общий «последний старт fetch» + цепочка обещаний, разводящая
// моменты стартов соседних запросов (сами фетчи выполняются конкурентно).
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class Crawler {
  readonly linkStatuses = new Map<string, number | null>();

  private readonly options: CrawlOptions;
  private readonly fetcher: Fetcher;
  private readonly emit: (e: EngineEvent) => void;
  private readonly queue: QueueItem[] = [];
  private queueHead = 0;
  private errors = 0;
  private readonly seen = new Set<string>();
  private readonly results = new Map<string, PageResult>();
  private readonly checkedLinks = new Set<string>();
  private robots: RobotsInfo | null = null;
  private origin = '';
  private followLinks = false;
  private stopped = false;
  private started = false;
  private finished = false;
  private inFlight = 0;
  private lastFetchStart = 0;
  private throttlePromise: Promise<void> | null = null;

  constructor(options: CrawlOptions, fetcher: Fetcher = createFetcher(options.renderJs), emit: (e: EngineEvent) => void) {
    this.options = options;
    this.fetcher = fetcher;
    this.emit = emit;
  }

  stop(): void {
    this.stopped = true;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.origin = new URL(this.options.startUrl).origin;
    // robots.txt фетчим всегда в sitemap-режиме (ради авто-обнаружения Sitemap-директивы) и при respectRobots.
    // allowed() при respectRobots=false не применяется — см. robotsAllowed().
    if (this.options.respectRobots || this.options.mode === 'sitemap') {
      this.robots = await fetchRobots(this.origin, this.options.requestTimeoutMs);
    }
    this.followLinks = this.options.mode === 'spider';
    if (!(await this.seedQueue())) {
      // Sitemap не найден или пуст — нечего обходить
      this.finish();
      return;
    }
    const workers = Array.from({ length: Math.max(1, this.options.concurrency) }, () => this.worker());
    await Promise.all(workers);
    if (!this.finished) this.finish();
  }

  private finish(): void {
    this.finished = true;
    this.emitProgress();
    this.emit({ type: 'done', state: this.stopped ? 'stopped' : 'done' });
  }

  // false — очередь пустая (sitemap не найден/пуст), запускать воркеры не нужно
  private async seedQueue(): Promise<boolean> {
    if (this.options.mode === 'list') {
      for (const raw of this.options.listUrls ?? []) {
        const url = normalizeUrl(raw, this.options.startUrl);
        if (url) this.enqueue(url, 0);
      }
      return true;
    }
    if (this.options.mode === 'sitemap') {
      const sitemapUrl = this.robots?.sitemaps[0] ?? `${this.origin}/sitemap.xml`;
      for (const raw of await fetchSitemapUrls(sitemapUrl, this.options.requestTimeoutMs)) {
        const url = normalizeUrl(raw, this.origin);
        if (url) this.enqueue(url, 0);
      }
      return this.pendingCount() > 0;
    }
    this.enqueue(this.options.startUrl, 0);
    return true;
  }

  private enqueue(url: string, depth: number): void {
    if (this.seen.has(url)) return;
    this.seen.add(url);
    this.queue.push({ url, depth });
  }

  /** Deque-подобный выбор: head-индекс вместо shift() (O(1) на элемент, O(n) амортизировано). */
  private dequeue(): QueueItem | undefined {
    if (this.queueHead >= this.queue.length) {
      this.queue.length = 0;
      this.queueHead = 0;
      return undefined;
    }
    const item = this.queue[this.queueHead];
    this.queueHead++;
    // Уплотняем массив, когда прочитанная часть занимает заметную долю.
    if (this.queueHead > 4096 && this.queueHead * 2 > this.queue.length) {
      this.queue.splice(0, this.queueHead);
      this.queueHead = 0;
    }
    return item;
  }

  /** Число ещё не выбранных из очереди элементов. */
  private pendingCount(): number {
    return this.queue.length - this.queueHead;
  }

  private robotsAllowed(url: string): boolean {
    return !this.options.respectRobots || this.robots === null || this.robots.allowed(url);
  }

  /**
   * Fetch с уважением Crawl-delay: при respectRobots=true и crawlDelayMs > 0 старты
   * соседних запросов на хост разносятся не меньше чем на crawlDelayMs (общий гейт
   * «последний старт»), при этом сами фетчи продолжают выполняться конкурентно.
   * Без троттлинга — прямой вызов fetcher'а.
   */
  private async throttledFetch(url: string, timeoutMs: number): Promise<FetchOutcome> {
    const delay = this.options.respectRobots ? (this.robots?.crawlDelayMs ?? 0) : 0;
    if (delay <= 0) return this.fetcher.fetch(url, timeoutMs);

    const prev = this.throttlePromise;
    this.throttlePromise = (async (): Promise<void> => {
      if (prev) await prev;
      const wait = this.lastFetchStart + delay - Date.now();
      // +5мс запаса: страхует от джиттера таймера/Date.now() — интервал строго >= crawlDelayMs.
      await sleep(Math.max(0, wait + 5));
      this.lastFetchStart = Date.now();
    })();
    await this.throttlePromise;
    return this.fetcher.fetch(url, timeoutMs);
  }

  private async worker(): Promise<void> {
    for (;;) {
      if (this.stopped || this.results.size >= this.options.maxUrls) return;
      const item = this.dequeue();
      if (!item) {
        // Очередь пуста, но другой воркер может ещё обрабатывать страницу и пополнить её.
        if (this.inFlight === 0) return;
        await new Promise((r) => setTimeout(r, 0));
        continue;
      }
      this.inFlight++;
      try {
        await this.process(item);
      } finally {
        this.inFlight--;
      }
    }
  }

  private async process(item: QueueItem): Promise<void> {
    if (item.depth > this.options.maxDepth) return;
    if (!this.robotsAllowed(item.url)) return;

    const outcome = await this.throttledFetch(item.url, this.options.requestTimeoutMs);
    this.linkStatuses.set(item.url, outcome.status);

    // maxUrls сверяется и после fetch: в полёте может быть несколько параллельных фетчей,
    // и страницы сверх лимита не должны попадать в результаты.
    if (this.results.size >= this.options.maxUrls) return;

    const isHtml = outcome.status !== null && (outcome.contentType ?? '').startsWith('text/html');
    const redirected = outcome.finalUrl !== item.url;

    if (redirected) {
      // undici уже следует редиректу, тело — это содержимое финального URL.
      // Не парсим его повторно под URL редиректа: финальный URL обрабатывается самостоятельно.
      const target = normalizeUrl(outcome.finalUrl, outcome.finalUrl);
      if (this.followLinks
        && target && isInternal(target, this.origin) && !this.seen.has(target) && this.robotsAllowed(target)) {
        this.seen.add(target);
        this.queue.push({ url: target, depth: item.depth + 1 });
      }
      this.record(this.baseResult(item, outcome));
      return;
    }

    const parsed = isHtml ? extractPageData(outcome.body ?? '') : null;
    const result = this.baseResult(item, outcome);
    if (parsed) {
      result.metaRobots = parsed.metaRobots;
      result.canonical = parsed.canonical;
      result.headings = parsed.headings;
      result.schemaOrg = parsed.jsonLd;
      const meta = parsed.metaRobots?.toLowerCase() ?? '';
      result.noindex = meta.includes('noindex');
      result.nofollow = meta.includes('nofollow');
      result.title = parsed.title;
      result.description = parsed.description;
      result.openGraph = parsed.openGraph;
      result.twitter = parsed.twitter;
      result.hreflang = parsed.hreflang;
      result.favicon = parsed.favicon;
      result.wordCount = parsed.wordCount;
      result.lang = parsed.lang;
      result.headingOrder = parsed.headingOrder;
      for (const img of parsed.images) {
        const url = normalizeUrl(img.src, outcome.finalUrl);
        if (url) result.images.push({ url, alt: img.alt });
      }

      for (const link of parsed.links) {
        const norm = normalizeUrl(link.href, outcome.finalUrl);
        if (!norm || !isInternal(norm, this.origin)) {
          if (norm) result.externalLinks.push({ url: norm, anchor: link.anchor, rel: link.rel });
          continue;
        }
        result.internalLinks.push({ url: norm, anchor: link.anchor, rel: link.rel });
        if (this.followLinks
          && item.depth + 1 <= this.options.maxDepth
          && !this.seen.has(norm)
          && this.robotsAllowed(norm)) {
          this.seen.add(norm);
          this.queue.push({ url: norm, depth: item.depth + 1 });
        }
      }

      // Внешние ссылки — «check»: лёгкий GET, статус в linkStatuses, без парсинга и без таблицы страниц
      for (const ext of result.externalLinks) {
        if (this.checkedLinks.has(ext.url)) continue;
        this.checkedLinks.add(ext.url);
        const check = await this.throttledFetch(ext.url, this.options.requestTimeoutMs);
        this.linkStatuses.set(ext.url, check.status);
      }
    }

    this.record(result);
  }

  private baseResult(item: QueueItem, o: Awaited<ReturnType<Fetcher['fetch']>>): PageResult {
    return {
      url: item.url,
      status: o.status,
      error: o.error,
      contentType: o.contentType,
      depth: item.depth,
      fetchedAt: new Date().toISOString(),
      responseTimeMs: o.responseTimeMs,
      sizeBytes: o.sizeBytes,
      // renderJs известен движку из опций: страницы, собранные через Playwright, помечаем rendered
      rendered: this.options.renderJs,
      title: null,
      description: null,
      metaRobots: null,
      canonical: null,
      headings: EMPTY_HEADINGS,
      images: [],
      internalLinks: [],
      externalLinks: [],
      schemaOrg: [],
      noindex: false,
      nofollow: false,
      redirectChain: o.redirectChain,
      openGraph: null,
      twitter: null,
      hreflang: [],
      favicon: null,
      wordCount: 0,
      lang: null,
      headingOrder: [],
    };
  }

  private record(result: PageResult): boolean {
    // Финальная страховка лимита: страница могла ждать check-запросы внешних ссылок,
    // пока другие воркеры уже дописали лимит. Повторные записи уже существующего URL не блокируем —
    // они не растят размер набора.
    if (this.results.size >= this.options.maxUrls && !this.results.has(result.url)) {
      return false;
    }
    const isNew = !this.results.has(result.url);
    this.results.set(result.url, result);
    if (isNew && result.status === null) this.errors++;
    this.emit({ type: 'page', result });
    this.emitProgress();
    return true;
  }

  private emitProgress(): void {
    // errors — инкрементальный счётчик (см. record), без повторного сканирования результатов.
    this.emit({ type: 'progress', crawled: this.results.size, queued: this.pendingCount(), errors: this.errors });
  }
}
