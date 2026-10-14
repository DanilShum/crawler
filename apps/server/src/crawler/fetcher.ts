import { fetch as undiciFetch, EnvHttpProxyAgent, type Dispatcher } from 'undici';

export interface FetchOutcome {
  status: number | null;
  error: string | null;
  contentType: string | null;
  body: string | null;
  sizeBytes: number;
  responseTimeMs: number;
  finalUrl: string;
  redirectChain: string[];
}

export interface Fetcher {
  fetch(url: string, timeoutMs: number): Promise<FetchOutcome>;
  close(): Promise<void>;
}

function classifyFetchError(err: unknown): string {
  const e = err as { code?: unknown; cause?: { code?: unknown }; name?: string };
  const code = e?.cause?.code !== undefined ? e.cause.code : e?.code;
  if (code === 'ENOTFOUND') return 'dns';
  if (typeof code === 'string' && (code.startsWith('CERT_') || code === 'DEPTH_ZERO_SELF_SIGNED_CERT')) {
    return 'ssl';
  }
  if (code === 'ABORT_ERR' || code === 'UND_ERR_CONNECT_TIMEOUT' || e?.name === 'AbortError' || e?.name === 'TimeoutError') {
    return 'timeout';
  }
  return 'connection';
}

export class HttpFetcher implements Fetcher {
  // undici игнорирует HTTP(S)_PROXY из окружения — в корпоративных сетях за
  // прокси прямые соединения режутся файрволом. EnvHttpProxyAgent читает
  // HTTP_PROXY/HTTPS_PROXY/NO_PROXY и проксирует соответствующие запросы.
  private static proxyAgent: EnvHttpProxyAgent | null = null;
  private static dispatcher(): Dispatcher | undefined {
    const hasProxy = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'].some((k) => process.env[k]);
    if (!hasProxy) return undefined;
    HttpFetcher.proxyAgent ??= new EnvHttpProxyAgent();
    return HttpFetcher.proxyAgent;
  }

  async fetch(url: string, timeoutMs: number): Promise<FetchOutcome> {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await undiciFetch(url, { redirect: 'follow', signal: controller.signal, dispatcher: HttpFetcher.dispatcher() });
      const body = await res.text();
      const finalUrl = res.url || url;
      const redirected = finalUrl !== url;
      return {
        status: res.status,
        error: null,
        contentType: res.headers.get('content-type'),
        body,
        sizeBytes: Buffer.byteLength(body, 'utf8'),
        responseTimeMs: Date.now() - started,
        finalUrl,
        // undici не отдаёт промежуточные URL при redirect: 'follow' — фиксируем исходный,
        // полная цепочка остаётся рендереру (Playwright)
        redirectChain: redirected ? [url] : [],
      };
    } catch (err) {
      return {
        status: null,
        error: classifyFetchError(err),
        contentType: null,
        body: null,
        sizeBytes: 0,
        responseTimeMs: Date.now() - started,
        finalUrl: url,
        redirectChain: [],
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async close(): Promise<void> {
    // undici использует глобальный пул соединений — закрывать нечего
  }
}
