// apps/web/src/stores/crawl.ts
import { ref } from 'vue';
import { defineStore } from 'pinia';
import type { CrawlEvent, CrawlState, Issue, PageWithIssues } from '@seo-crawler/shared';

import { fetchIssues, fetchPages } from '../api/client';
import { PAGE_LIMIT } from '../constants';

export type CrawlTab = 'internal' | 'external' | 'images';

export interface CrawlProgress {
  state: CrawlState;
  crawled: number;
  queued: number;
  errors: number;
}

const RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_ATTEMPTS = 5;
const emptyProgress = (): CrawlProgress => ({ state: 'running', crawled: 0, queued: 0, errors: 0 });

export const useCrawlSession = defineStore('crawl-session', () => {
  const id = ref<string | null>(null);
  const progress = ref<CrawlProgress>(emptyProgress());
  const issues = ref<Issue[]>([]);
  const pages = ref<PageWithIssues[]>([]);
  const total = ref(0);
  const tab = ref<CrawlTab>('internal');
  const issueFilter = ref<string | null>(null);
  const selectedUrl = ref<string | null>(null);
  const pageOffset = ref(0);
  const apiError = ref<string | null>(null);

  let ws: WebSocket | null = null;
  let reconnectAttempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let closedByUs = false;

  function wsUrl(sessionId: string): string {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}/ws/crawl/${sessionId}`;
  }

  function connect(): void {
    if (!id.value) return;
    closedByUs = false;
    ws = new WebSocket(wsUrl(id.value));
    ws.onopen = () => {
      reconnectAttempts = 0;
    };
    ws.onmessage = (ev: MessageEvent) => {
      let event: CrawlEvent;
      try {
        event = JSON.parse(ev.data as string) as CrawlEvent;
      } catch {
        return;
      }
      handleEvent(event);
    };
    ws.onclose = () => {
      ws = null;
      if (closedByUs || !id.value || progress.value.state !== 'running') return;
      if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        // исчерпали попытки — REST-резерв
        reconnectAttempts = 0;
        void loadPages().catch(() => {});
        return;
      }
      reconnectAttempts += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, RECONNECT_DELAY_MS);
    };
  }

  function handleEvent(event: CrawlEvent): void {
    switch (event.type) {
      case 'progress':
        progress.value = {
          state: event.state,
          crawled: event.crawled,
          queued: event.queued,
          errors: event.errors,
        };
        break;
      case 'page':
        break;
      case 'summary':
        issues.value = event.issues;
        break;
      case 'done':
        progress.value = { ...progress.value, state: event.state };
        void loadPages().catch(() => {});
        void loadIssues().catch(() => {});
        closeWs();
        break;
    }
  }

  async function loadPages(offset = pageOffset.value): Promise<void> {
    if (!id.value) return;
    try {
      const data = await fetchPages(id.value, {
        offset,
        limit: PAGE_LIMIT,
        tab: tab.value,
        issue: issueFilter.value ?? undefined,
      });
      pages.value = data.items;
      total.value = data.total;
      apiError.value = null;
    } catch (e) {
      // ошибка не глотается молча: баннер в UI объясняет, почему список не обновился
      apiError.value = e instanceof Error ? e.message : String(e);
      throw e;
    }
  }

  async function loadIssues(): Promise<void> {
    if (!id.value) return;
    try {
      issues.value = await fetchIssues(id.value);
      apiError.value = null;
    } catch (e) {
      apiError.value = e instanceof Error ? e.message : String(e);
      throw e;
    }
  }

  function closeWs(): void {
    closedByUs = true;
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    reconnectAttempts = 0;
    if (ws) {
      const current = ws;
      ws = null;
      current.onopen = null;
      current.onmessage = null;
      current.onclose = null;
      current.onerror = null;
      current.close();
    }
  }

  function open(sessionId: string): void {
    closeWs();
    id.value = sessionId;
    progress.value = emptyProgress();
    issues.value = [];
    pages.value = [];
    total.value = 0;
    tab.value = 'internal';
    issueFilter.value = null;
    selectedUrl.value = null;
    pageOffset.value = 0;
    apiError.value = null;
    connect();
    // REST-база, чтобы UI не ждал WS
    void loadPages().catch(() => {});
    void loadIssues().catch(() => {});
  }

  function close(): void {
    closeWs();
  }

  function setTab(next: CrawlTab): void {
    tab.value = next;
    pageOffset.value = 0;
    void loadPages().catch(() => {});
  }

  function setIssueFilter(issue: string | null): void {
    issueFilter.value = issue;
    pageOffset.value = 0;
    void loadPages().catch(() => {});
  }

  return {
    id,
    progress,
    issues,
    pages,
    total,
    tab,
    issueFilter,
    selectedUrl,
    pageOffset,
    apiError,
    open,
    close,
    loadPages,
    setTab,
    setIssueFilter,
  };
});
