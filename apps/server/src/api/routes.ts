import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { TooManySessionsError } from '../session/session-manager';
import type { SessionManager } from '../session/session-manager';
import type { CrawlOptions, IssueKind, PageResult } from '@seo-crawler/shared';

const MODES = ['spider', 'list', 'sitemap'] as const;
const TABS = ['internal', 'external', 'images'] as const;
const ISSUE_KINDS: IssueKind[] = [
  'broken-link', 'duplicate-title', 'duplicate-description',
  'duplicate-h1', 'missing-h1', 'missing-alt', 'noindex',
];

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

function isHttpUrl(v: unknown): v is string {
  if (typeof v !== 'string' || v.length === 0) return false;
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function isBool(v: unknown): v is boolean {
  return typeof v === 'boolean';
}

/** Валидация тела POST /api/crawl — вручную, без json-schema. */
function parseCrawlOptions(input: unknown): Parsed<CrawlOptions> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, message: 'тело должно быть JSON-объектом' };
  }
  const b = input as Record<string, unknown>;

  if (!isHttpUrl(b.startUrl)) return { ok: false, message: 'startUrl должен быть валидным http(s) URL' };

  const mode = b.mode;
  if (typeof mode !== 'string' || !(MODES as readonly string[]).includes(mode)) {
    return { ok: false, message: 'mode должен быть одним из: spider, list, sitemap' };
  }

  if (mode === 'list') {
    const listUrls = b.listUrls;
    if (!Array.isArray(listUrls) || listUrls.length === 0 || !listUrls.every(isHttpUrl)) {
      return { ok: false, message: 'mode=list требует непустой массив валидных http(s) URLs в listUrls' };
    }
  }

  const inRange = (v: unknown, min: number, max: number): number | null => {
    if (typeof v !== 'number' || !Number.isInteger(v)) return null;
    return v >= min && v <= max ? v : null;
  };

  const maxUrls = inRange(b.maxUrls, 1, 10000);
  if (maxUrls === null) return { ok: false, message: 'maxUrls должен быть целым числом от 1 до 10000' };

  const maxDepth = inRange(b.maxDepth, 0, 20);
  if (maxDepth === null) return { ok: false, message: 'maxDepth должен быть целым числом от 0 до 20' };

  const concurrency = inRange(b.concurrency, 1, 20);
  if (concurrency === null) return { ok: false, message: 'concurrency должен быть целым числом от 1 до 20' };

  const requestTimeoutMs = inRange(b.requestTimeoutMs, 1000, 120000);
  if (requestTimeoutMs === null) {
    return { ok: false, message: 'requestTimeoutMs должен быть целым числом от 1000 до 120000' };
  }

  if (!isBool(b.respectRobots)) return { ok: false, message: 'respectRobots должен быть boolean' };
  if (!isBool(b.renderJs)) return { ok: false, message: 'renderJs должен быть boolean' };

  return {
    ok: true,
    value: {
      startUrl: b.startUrl,
      mode: mode as CrawlOptions['mode'],
      ...(mode === 'list' ? { listUrls: b.listUrls as string[] } : {}),
      maxUrls,
      maxDepth,
      concurrency,
      requestTimeoutMs,
      respectRobots: b.respectRobots,
      renderJs: b.renderJs,
    },
  };
}

/**
 * Множество URL страниц, входящих в группу проблемы — по тем же правилам, что computeIssues,
 * но с полным охватом (sampleUrls из Issue содержат только до 5 примеров).
 */
function pagesInIssueGroup(
  results: PageResult[],
  linkStatuses: Map<string, number | null>,
  kind: IssueKind,
): Set<string> {
  const countDuplicates = (getKey: (p: PageResult) => string | null): Map<string, number> => {
    const m = new Map<string, number>();
    for (const p of results) {
      const key = getKey(p);
      if (key !== null) m.set(key, (m.get(key) ?? 0) + 1);
    }
    return m;
  };
  const titleCounts = countDuplicates((p) => p.title);
  const descCounts = countDuplicates((p) => p.description);
  const h1Key = (p: PageResult): string => p.headings.h1.join('\n');
  const h1Counts = new Map<string, number>();
  for (const p of results) {
    const key = h1Key(p);
    if (key !== '') h1Counts.set(key, (h1Counts.get(key) ?? 0) + 1);
  }

  const out = new Set<string>();
  for (const p of results) {
    let hit = false;
    switch (kind) {
      case 'broken-link':
        hit = [...p.internalLinks, ...p.externalLinks].some((l) => {
          const s = linkStatuses.get(l.url);
          // Таргет вне карты (undefined) — неизвестен и битым не считается.
          return s !== undefined && (s === null || s >= 400);
        });
        break;
      case 'duplicate-title':
        hit = p.title !== null && (titleCounts.get(p.title) ?? 0) > 1;
        break;
      case 'duplicate-description':
        hit = p.description !== null && (descCounts.get(p.description) ?? 0) > 1;
        break;
      case 'duplicate-h1': {
        const key = h1Key(p);
        hit = key !== '' && (h1Counts.get(key) ?? 0) > 1;
        break;
      }
      case 'missing-h1':
        hit = p.headings.h1.length === 0;
        break;
      case 'missing-alt':
        hit = p.images.some((i) => i.alt === null);
        break;
      case 'noindex':
        hit = p.noindex;
        break;
    }
    if (hit) out.add(p.url);
  }
  return out;
}

function intParam(value: string | undefined, def: number, max?: number): number {
  if (value === undefined) return def;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) return def;
  return max !== undefined ? Math.min(n, max) : n;
}

export function buildApp(deps: { sessions: SessionManager }): FastifyInstance {
  const app = Fastify({ logger: false });

  app.post('/api/crawl', async (req, reply) => {
    const parsed = parseCrawlOptions(req.body);
    if (!parsed.ok) {
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.message });
    }
    try {
      const { id } = deps.sessions.create(parsed.value);
      return reply.code(200).send({ id });
    } catch (err) {
      if (err instanceof TooManySessionsError) {
        return reply.code(429).send({ error: 'TOO_MANY_SESSIONS', message: err.message });
      }
      throw err;
    }
  });

  app.post('/api/crawl/:id/stop', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!deps.sessions.get(id)) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'сессия не найдена' });
    }
    deps.sessions.stop(id);
    return reply.code(200).send({ ok: true });
  });

  app.get('/api/crawl/:id/pages', async (req, reply) => {
    const { id } = req.params as { id: string };
    const session = deps.sessions.get(id);
    if (!session) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'сессия не найдена' });
    }
    const q = req.query as Record<string, string | undefined>;

    let tab: (typeof TABS)[number] = 'internal';
    if (q.tab !== undefined) {
      if (!(TABS as readonly string[]).includes(q.tab)) {
        return reply.code(400).send({ error: 'VALIDATION', message: 'tab должен быть internal|external|images' });
      }
      tab = q.tab as (typeof TABS)[number];
    }

    let issue: IssueKind | undefined;
    if (q.issue !== undefined) {
      if (!(ISSUE_KINDS as readonly string[]).includes(q.issue)) {
        return reply.code(400).send({ error: 'VALIDATION', message: `issue должен быть одним из: ${ISSUE_KINDS.join(', ')}` });
      }
      issue = q.issue as IssueKind;
    }

    const offset = intParam(q.offset, 0);
    const limit = intParam(q.limit, 50, 200);

    let items = [...session.results.values()];
    if (tab === 'external') items = items.filter((p) => p.externalLinks.length > 0);
    if (tab === 'images') items = items.filter((p) => p.images.length > 0);
    if (issue !== undefined) {
      const inGroup = pagesInIssueGroup([...session.results.values()], session.linkStatuses, issue);
      items = items.filter((p) => inGroup.has(p.url));
    }
    items.sort((a, b) => a.depth - b.depth || a.url.localeCompare(b.url));

    const total = items.length;
    const pageItems = items.slice(offset, offset + limit);
    return reply.code(200).send({ total, items: pageItems });
  });

  app.get('/api/crawl/:id/issues', async (req, reply) => {
    const { id } = req.params as { id: string };
    const session = deps.sessions.get(id);
    if (!session) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'сессия не найдена' });
    }
    return reply.code(200).send(session.issues());
  });

  app.get('/api/crawls', async () => {
    return deps.sessions.list();
  });

  return app;
}
