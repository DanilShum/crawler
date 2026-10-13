import { normalizeUrl, isInternal } from './url-utils';
import { extractPageData } from './extract';
import { fetchRobots } from './robots';
import type { RobotsInfo } from './robots';
import type { CrawlOptions, PageResult, HeadingLevel } from '@seo-crawler/shared';
import type { Fetcher } from './fetcher';

export type EngineEvent =
  | { type: 'page'; result: PageResult }
  | { type: 'progress'; crawled: number; queued: number; errors: number }
  | { type: 'done'; state: 'done' | 'stopped' };

interface QueueItem { url: string; depth: number; }

const EMPTY_HEADINGS: Record<HeadingLevel, string[]> = { h1: [], h2: [], h3: [], h4: [], h5: [], h6: [] };

export class Crawler {
  readonly linkStatuses = new Map<string, number | null>();

  private readonly options: CrawlOptions;
  private readonly fetcher: Fetcher;
  private readonly emit: (e: EngineEvent) => void;
  private readonly queue: QueueItem[] = [];
  private readonly seen = new Set<string>();
  private readonly results = new Map<string, PageResult>();
  private readonly checkedLinks = new Set<string>();
  private robots: RobotsInfo | null = null;
  private origin = '';
  private stopped = false;
  private started = false;
  private finished = false;
  private inFlight = 0;

  constructor(options: CrawlOptions, fetcher: Fetcher, emit: (e: EngineEvent) => void) {
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
    if (this.options.respectRobots) {
      this.robots = await fetchRobots(this.origin, this.options.requestTimeoutMs);
    }
    this.seedQueue();
    const workers = Array.from({ length: Math.max(1, this.options.concurrency) }, () => this.worker());
    await Promise.all(workers);
    if (!this.finished) {
      this.finished = true;
      this.emitProgress();
      this.emit({ type: 'done', state: this.stopped ? 'stopped' : 'done' });
    }
  }

  private seedQueue(): void {
    if (this.options.mode === 'spider') {
      this.enqueue(this.options.startUrl, 0);
      return;
    }
    // list/sitemap — семплирование своих стратегий появится в Task 7
    this.enqueue(this.options.startUrl, 0);
  }

  private enqueue(url: string, depth: number): void {
    if (this.seen.has(url)) return;
    this.seen.add(url);
    this.queue.push({ url, depth });
  }

  private robotsAllowed(url: string): boolean {
    return !this.options.respectRobots || this.robots === null || this.robots.allowed(url);
  }

  private async worker(): Promise<void> {
    for (;;) {
      if (this.stopped || this.results.size >= this.options.maxUrls) return;
      const item = this.queue.shift();
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

    const outcome = await this.fetcher.fetch(item.url, this.options.requestTimeoutMs);
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
      if (target && isInternal(target, this.origin) && !this.seen.has(target) && this.robotsAllowed(target)) {
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
        if (this.options.mode === 'spider'
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
        const check = await this.fetcher.fetch(ext.url, this.options.requestTimeoutMs);
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
      rendered: false,
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
    };
  }

  private record(result: PageResult): boolean {
    // Финальная страховка лимита: страница могла ждать check-запросы внешних ссылок,
    // пока другие воркеры уже дописали лимит. Повторные записи уже существующего URL не блокируем —
    // они не растят размер набора.
    if (this.results.size >= this.options.maxUrls && !this.results.has(result.url)) {
      return false;
    }
    this.results.set(result.url, result);
    this.emit({ type: 'page', result });
    this.emitProgress();
    return true;
  }

  private emitProgress(): void {
    let errors = 0;
    for (const r of this.results.values()) {
      if (r.status === null) errors++;
    }
    this.emit({ type: 'progress', crawled: this.results.size, queued: this.queue.length, errors });
  }
}
