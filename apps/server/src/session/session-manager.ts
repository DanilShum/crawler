import { randomUUID } from 'node:crypto';
import { Crawler } from '../crawler/engine';
import { createFetcher } from '../crawler/rendered-fetcher';
import { computeIssues } from '../crawler/issues';
import type { Fetcher } from '../crawler/fetcher';
import type { CrawlOptions, PageResult, CrawlEvent, CrawlState, Issue } from '@seo-crawler/shared';

export class TooManySessionsError extends Error {
  constructor() {
    super('TOO_MANY_SESSIONS');
    this.name = 'TooManySessionsError';
  }
}

export interface CrawlProgress {
  state: CrawlState;
  crawled: number;
  queued: number;
  errors: number;
}

export interface CrawlSession {
  id: string;
  options: CrawlOptions;
  readonly state: CrawlState;
  results: Map<string, PageResult>;
  linkStatuses: Map<string, number | null>;
  subscribe(fn: (e: CrawlEvent) => void): () => void;
  progress(): CrawlProgress;
  issues(): Issue[];
}

export interface SessionMeta {
  id: string;
  startUrl: string;
  mode: CrawlOptions['mode'];
  state: CrawlState;
  crawled: number;
  errors: number;
  startedAt: string;
}

/** Максимум одновременно запущенных краулов. */
const MAX_ACTIVE = 3;

interface InternalSession {
  session: CrawlSession;
  crawler: Crawler;
  fetcher: Fetcher;
  /** Помечает сессию завершённой, рассылает summary+done, закрывает fetcher. Идемпотентна. */
  finalize: (state: CrawlState) => void;
  startedAt: string;
}

export type FetcherFactory = (renderJs: boolean) => Fetcher;

export class SessionManager {
  private readonly internal = new Map<string, InternalSession>();

  constructor(private readonly fetcherFactory: FetcherFactory = createFetcher) {}

  /** Создаёт и запускает краул. Синхронный: движок стартует в фоне. */
  create(options: CrawlOptions): { id: string } {
    if (this.countRunning() >= MAX_ACTIVE) throw new TooManySessionsError();

    const id = randomUUID();
    const startedAt = new Date().toISOString();
    const results = new Map<string, PageResult>();
    const subscribers = new Set<(e: CrawlEvent) => void>();

    let currentState: CrawlState = 'running';
    let progressInfo: { crawled: number; queued: number; errors: number } = {
      crawled: 0, queued: 0, errors: 0,
    };
    let currentIssues: Issue[] = [];
    let issuesDirty = true;
    let finished = false;

    // fetcher и crawler должны существовать до того, как на них сошлются замыкания.
    const fetcher: Fetcher = this.fetcherFactory(options.renderJs);
    let crawler!: Crawler;

    const recomputeIssues = (): void => {
      currentIssues = computeIssues([...results.values()], crawler.linkStatuses);
      issuesDirty = false;
    };

    const notify = (e: CrawlEvent): void => {
      // Ошибка подписчика не должна ронять краул.
      for (const fn of [...subscribers]) {
        try { fn(e); } catch { /* noop */ }
      }
    };

    const finalize = (state: CrawlState): void => {
      if (finished) return;
      finished = true;
      currentState = state;
      recomputeIssues();
      notify({ type: 'summary', issues: currentIssues });
      notify({ type: 'done', state });
      void fetcher.close().catch(() => undefined);
    };

    const session: CrawlSession = {
      id,
      get state(): CrawlState { return currentState; },
      options,
      results,
      get linkStatuses(): Map<string, number | null> { return crawler.linkStatuses; },
      subscribe(fn) {
        subscribers.add(fn);
        return () => { subscribers.delete(fn); };
      },
      progress: () => ({ state: currentState, ...progressInfo }),
      issues: () => {
        if (issuesDirty) recomputeIssues();
        return currentIssues;
      },
    };

    crawler = new Crawler(options, fetcher, (e) => {
      if (e.type === 'page') {
        results.set(e.result.url, e.result);
        issuesDirty = true;
        // Кэш отчёта пересчитываем по завершении и периодически, чтобы issues() был дешёвым.
        if (results.size % 10 === 0) recomputeIssues();
        notify({ type: 'page', url: e.result.url });
        return;
      }
      if (e.type === 'progress') {
        progressInfo = { crawled: e.crawled, queued: e.queued, errors: e.errors };
        notify({ type: 'progress', state: currentState, ...progressInfo });
        return;
      }
      finalize(e.state);
    });

    const rec: InternalSession = { session, crawler, fetcher, finalize, startedAt };
    this.internal.set(id, rec);
    // Движок не бросает наружу (fetcher оборачивает ошибки), но страховка на случай будущего.
    void crawler.start().catch(() => finalize('stopped'));

    return { id };
  }

  get(id: string): CrawlSession | undefined {
    return this.internal.get(id)?.session;
  }

  stop(id: string): void {
    const rec = this.internal.get(id);
    if (!rec) return;
    rec.crawler.stop();
    // Переводим состояние немедленно; финальный done движка придёт идемпотентно.
    rec.finalize('stopped');
  }

  list(): SessionMeta[] {
    return [...this.internal.values()].map((rec) => {
      const { state, crawled, errors } = rec.session.progress();
      return {
        id: rec.session.id,
        startUrl: rec.session.options.startUrl,
        mode: rec.session.options.mode,
        state,
        crawled,
        errors,
        startedAt: rec.startedAt,
      };
    });
  }

  private countRunning(): number {
    let n = 0;
    for (const rec of this.internal.values()) {
      if (rec.session.state === 'running') n++;
    }
    return n;
  }
}
