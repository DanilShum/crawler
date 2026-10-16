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
  // Кэшируем Promise запуска, а не Browser: check-then-launch атомарен —
  // N параллельных fetch'ов разделяют один launch, лишних браузеров нет.
  private launchPromise: Promise<Browser> | null = null;

  async fetch(url: string, timeoutMs: number): Promise<FetchOutcome> {
    const started = Date.now();
    let context: BrowserContext | null = null;
    try {
      const browser = await this.ensureBrowser(timeoutMs);
      // Свежий контекст на каждый fetch — изоляция cookies/локального состояния.
      context = await browser.newContext();
      const page = await context.newPage();
      const response = await page.goto(url, { waitUntil: 'networkidle', timeout: timeoutMs });
      if (response === null) {
        // goto резолвится с null-ответом (например, client-side redirect):
        // инвариант движка «status null ⇔ ошибка» — не выдаём «успех» без статуса.
        return this.errorOutcome(url, 'connection', started);
      }
      const body = await page.content();
      const finalUrl = page.url();
      return {
        status: response.status(),
        error: null,
        contentType: response.headers()['content-type'] ?? null,
        body,
        sizeBytes: Buffer.byteLength(body, 'utf8'),
        responseTimeMs: Date.now() - started,
        finalUrl,
        redirectChain: finalUrl !== url ? [url] : [],
      };
    } catch (err) {
      return this.errorOutcome(url, classifyRenderError(err), started);
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

  private ensureBrowser(timeoutMs: number): Promise<Browser> {
    if (this.launchPromise === null) {
      // Таймаут launch'а = timeoutMs fetch'а: воркер движка не должен вешаться вечно.
      // Упавший launch не кэшируем — следующий fetch может повторить запуск.
      this.launchPromise = chromium.launch({ timeout: timeoutMs })
        .then((browser) => {
          this.browser = browser;
          return browser;
        })
        .catch((err) => {
          this.launchPromise = null;
          throw err;
        });
    }
    return this.launchPromise;
  }

  private errorOutcome(url: string, error: string, started: number): FetchOutcome {
    return {
      status: null,
      error,
      contentType: null,
      body: null,
      sizeBytes: 0,
      responseTimeMs: Date.now() - started,
      finalUrl: url,
      redirectChain: [],
    };
  }
}

function classifyRenderError(err: unknown): string {
  const name = (err as { name?: unknown })?.name;
  if (name === 'TimeoutError' || name === 'AbortError') return 'timeout';
  return 'connection';
}
