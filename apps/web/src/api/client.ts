// apps/web/src/api/client.ts
import type { CrawlOptions, Issue, PageResult } from '@seo-crawler/shared';

export interface SessionMeta {
  id: string;
  startUrl: string;
  mode: string;
  state: string;
  crawled: number;
  errors: number;
  startedAt: string;
}

interface ErrorBody {
  error?: string;
  message?: string;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as ErrorBody;
      if (typeof body.error === 'string' && body.error) message = body.error;
      if (typeof body.message === 'string' && body.message) message = body.message;
    } catch {
      // ответ без JSON-тела — оставляем статус
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export function startCrawl(opts: CrawlOptions): Promise<{ id: string }> {
  return request<{ id: string }>('/api/crawl', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  });
}

export async function stopCrawl(id: string): Promise<void> {
  await request<unknown>(`/api/crawl/${id}/stop`, { method: 'POST' });
}

export interface FetchPagesParams {
  offset: number;
  limit: number;
  tab?: string;
  issue?: string;
}

export function fetchPages(
  id: string,
  params: FetchPagesParams,
): Promise<{ total: number; items: PageResult[] }> {
  const qs = new URLSearchParams();
  qs.set('offset', String(params.offset));
  qs.set('limit', String(params.limit));
  if (params.tab !== undefined) qs.set('tab', params.tab);
  if (params.issue !== undefined) qs.set('issue', params.issue);
  return request(`/api/crawl/${id}/pages?${qs.toString()}`);
}

export function fetchIssues(id: string): Promise<Issue[]> {
  return request<Issue[]>(`/api/crawl/${id}/issues`);
}

export function fetchCrawls(): Promise<SessionMeta[]> {
  return request<SessionMeta[]>('/api/crawls');
}

export function exportUrl(id: string): string {
  return `/api/crawl/${id}/export`;
}
