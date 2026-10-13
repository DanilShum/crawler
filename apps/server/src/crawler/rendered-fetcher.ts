import { chromium } from 'playwright';
import type { Browser, BrowserContext } from 'playwright';
import { HttpFetcher } from './fetcher';
import type { Fetcher, FetchOutcome } from './fetcher';

export function createFetcher(renderJs: boolean): Fetcher {
  return renderJs ? new RenderedFetcher() : new HttpFetcher();
}

export class RenderedFetcher implements Fetcher {
  // Один браузер на инстанс, лениво при первом fetch (не глобально).
  private browser: Browser | null = null;

  async fetch(url: string, timeoutMs: number): Promise<FetchOutcome> {
    const started = Date.now();
    let context: BrowserContext | null = null;
    try {
      const browser = await this.ensureBrowser();
      // Свежий контекст на каждый fetch — изоляция cookies/локального состояния.
      context = await browser.newContext();
      const page = await context.newPage();
      const response = await page.goto(url, { waitUntil: 'networkidle', timeout: timeoutMs });
      const body = await page.content();
      const finalUrl = page.url();
      return {
        status: response ? response.status() : null,
        error: null,
        contentType: response ? response.headers()['content-type'] ?? null : null,
        body,
        sizeBytes: Buffer.byteLength(body, 'utf8'),
        responseTimeMs: Date.now() - started,
        finalUrl,
        redirectChain: finalUrl !== url ? [url] : [],
      };
    } catch (err) {
      return {
        status: null,
        error: classifyRenderError(err),
        contentType: null,
        body: null,
        sizeBytes: 0,
        responseTimeMs: Date.now() - started,
        finalUrl: url,
        redirectChain: [],
      };
    } finally {
      if (context) await context.close().catch(() => undefined);
    }
  }

  async close(): Promise<void> {
    if (this.browser === null) return;
    const browser = this.browser;
    this.browser = null;
    await browser.close().catch(() => undefined);
  }

  private async ensureBrowser(): Promise<Browser> {
    if (this.browser === null) {
      this.browser = await chromium.launch();
    }
    return this.browser;
  }
}

function classifyRenderError(err: unknown): string {
  const name = (err as { name?: unknown })?.name;
  if (name === 'TimeoutError' || name === 'AbortError') return 'timeout';
  return 'connection';
}
