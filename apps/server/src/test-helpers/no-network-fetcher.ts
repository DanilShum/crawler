import { createFetcher } from '../crawler/fetch/rendered-fetcher';
import { HttpFetcher } from '../crawler/fetch/fetcher';
import type { Fetcher, FetchOutcome } from '../crawler/fetch/fetcher';

const LOCAL_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1']);

function dnsError(url: string): FetchOutcome {
  return {
    status: null,
    error: 'dns',
    contentType: null,
    body: null,
    sizeBytes: 0,
    responseTimeMs: 0,
    finalUrl: url,
    redirectChain: [],
  };
}

/**
 * Декоратор над Fetcher: запросы к тестовой фикстуре (localhost) проходят во
 * внутренний fetcher, любой другой хост отдаёт DNS-ошибку БЕЗ сети.
 * Инвариант тестов «наружу не ходим»: краулер может встречать внешние ссылки
 * (external.example в фикстуре), но реальных DNS/сетевых вызовов не делает.
 */
export class NoNetworkFetcher implements Fetcher {
  private readonly inner: Fetcher;

  constructor(inner: Fetcher = new HttpFetcher()) {
    this.inner = inner;
  }

  async fetch(url: string, timeoutMs: number): Promise<FetchOutcome> {
    let host = '';
    try {
      host = new URL(url).hostname;
    } catch {
      return dnsError(url);
    }
    if (!LOCAL_HOSTNAMES.has(host)) return dnsError(url);
    return this.inner.fetch(url, timeoutMs);
  }

  close(): Promise<void> {
    return this.inner.close();
  }
}

/** Фабрика для SessionManager: оборачивает штатный fetcher (renderJs-режим учитывается). */
export function createNoNetworkFetcher(renderJs: boolean): Fetcher {
  return new NoNetworkFetcher(createFetcher(renderJs));
}
