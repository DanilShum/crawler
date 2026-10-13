import { describe, it, expect } from 'vitest';
import { SessionManager } from './session-manager';
import { startTestSite } from '../test-helpers/test-site';
import type { CrawlOptions, CrawlEvent } from '@seo-crawler/shared';

function opts(origin: string, over: Partial<CrawlOptions> = {}): CrawlOptions {
  return {
    startUrl: origin + '/',
    mode: 'spider',
    maxUrls: 50,
    maxDepth: 10,
    respectRobots: false,
    renderJs: false,
    concurrency: 5,
    requestTimeoutMs: 5000,
    ...over,
  };
}

type DoneEvent = Extract<CrawlEvent, { type: 'done' }>;

function waitDone(sm: SessionManager, id: string, timeoutMs = 10_000): Promise<DoneEvent> {
  const session = sm.get(id)!;
  if (session.state !== 'running') return Promise.resolve({ type: 'done', state: session.state });
  return new Promise<DoneEvent>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting for done')), timeoutMs);
    session.subscribe((e) => {
      if (e.type === 'done') {
        clearTimeout(timer);
        resolve(e);
      }
    });
  });
}

describe('SessionManager', () => {
  it('создаёт сессию с id и отдаёт её через get', async () => {
    const sm = new SessionManager();
    const { id } = sm.create(opts('http://localhost/'));
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);

    const session = sm.get(id);
    expect(session).toBeDefined();
    expect(session!.id).toBe(id);
    expect(session!.state).toBe('running');
    expect(session!.options.mode).toBe('spider');
  });

  it('get неизвестного id возвращает undefined, stop неизвестного id не бросает', () => {
    const sm = new SessionManager();
    expect(sm.get('missing')).toBeUndefined();
    expect(() => sm.stop('missing')).not.toThrow();
    expect(sm.list()).toEqual([]);
  });

  it('прогресс обновляется по событиям и по завершении state=done', async () => {
    const site = await startTestSite();
    const sm = new SessionManager();
    try {
      const { id } = sm.create(opts(site.origin));
      const session = sm.get(id)!;
      const doneEvent = await waitDone(sm, id);

      expect(doneEvent.state).toBe('done');
      expect(session.state).toBe('done');
      expect(session.results.size).toBeGreaterThan(0);

      const progress = session.progress();
      expect(progress.crawled).toBe(session.results.size);
      expect(progress.state).toBe('done');

      // issues() обязан работать и после завершения
      expect(Array.isArray(session.issues())).toBe(true);
    } finally {
      await site.close();
    }
  });

  it('лимит 3 активных сессий: четвёртая бросает TOO_MANY_SESSIONS', async () => {
    const site = await startTestSite();
    const sm = new SessionManager();
    try {
      // create синхронный, start асинхронный: сразу после трёх create все в state=running
      const a = sm.create(opts(site.origin));
      const b = sm.create(opts(site.origin));
      const c = sm.create(opts(site.origin));
      expect([a.id, b.id, c.id]).toHaveLength(3);
      expect(() => sm.create(opts(site.origin))).toThrow('TOO_MANY_SESSIONS');
    } finally {
      await site.close();
    }
  });

  it('stop переводит сессию в stopped и событие done приходит со state=stopped', async () => {
    const site = await startTestSite();
    const sm = new SessionManager();
    try {
      const { id } = sm.create(opts(site.origin));
      const session = sm.get(id)!;
      const doneEvent = waitDone(sm, id);
      sm.stop(id);

      const ev = await doneEvent;
      expect(ev.state).toBe('stopped');
      expect(session.state).toBe('stopped');
    } finally {
      await site.close();
    }
  });

  it('list() отдаёт меты в порядке создания со state и прогрессом', async () => {
    const site = await startTestSite();
    const sm = new SessionManager();
    try {
      const { id } = sm.create(opts(site.origin, { maxUrls: 1 }));
      const meta = sm.list().find((m) => m.id === id);
      expect(meta).toBeDefined();
      expect(meta!.startUrl).toBe(site.origin + '/');
      expect(meta!.mode).toBe('spider');
      expect(meta!.state).toBe('running');
      expect(typeof meta!.startedAt).toBe('string');
      expect(meta!.crawled).toBeGreaterThanOrEqual(0);
    } finally {
      await site.close();
    }
  });
});
