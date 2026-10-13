import { existsSync } from 'node:fs';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { chromium } from 'playwright';
import { startTestSite } from '../test-helpers/test-site';
import type { TestSite } from '../test-helpers/test-site';
import { HttpFetcher } from './fetcher';
import { RenderedFetcher, createFetcher } from './rendered-fetcher';

// Сторож: true, если chromium и установлен, и запускается в текущем окружении.
// Браузер может быть недоступен по-разному: не установлен (нет доступа к CDN)
// или окружение не даёт ему стартовать (песочница: macOS denies Mach bootstrap).
// Тогда интеграционные тесты скипаются с предупреждением, а не падают.
let hasChromium = false;
let chromiumProblem = '';
try {
  const executable = chromium.executablePath();
  if (executable === '' || !existsSync(executable)) {
    chromiumProblem = 'браузер не установлен (установка: npm exec playwright install chromium)';
  } else {
    const probe = await chromium.launch();
    await probe.close();
    hasChromium = true;
  }
} catch (err) {
  chromiumProblem = (err as Error).message.split('\n')[0];
}
if (!hasChromium) {
  // process.stderr, а не console.warn: vitest глотает console.* для пропущенных файлов
  process.stderr.write(
    `Playwright: chromium недоступен — ${chromiumProblem}; интеграционные тесты RenderedFetcher будут пропущены\n`,
  );
}

describe('createFetcher', () => {
  it('renderJs=false возвращает HttpFetcher', async () => {
    const fetcher = createFetcher(false);
    expect(fetcher).toBeInstanceOf(HttpFetcher);
    await fetcher.close();
  });

  it('renderJs=true возвращает RenderedFetcher', async () => {
    const fetcher = createFetcher(true);
    expect(fetcher).toBeInstanceOf(RenderedFetcher);
    await fetcher.close();
  });
});

describe('RenderedFetcher close', () => {
  it('close() до первого fetch — безопасный no-op', async () => {
    const fetcher = new RenderedFetcher();
    await expect(fetcher.close()).resolves.toBeUndefined();
  });
});

describe.skipIf(!hasChromium)('RenderedFetcher (Playwright)', () => {
  let site: TestSite;
  let fetcher: RenderedFetcher;

  beforeAll(async () => {
    site = await startTestSite();
    fetcher = new RenderedFetcher();
  }, 60_000);

  afterAll(async () => {
    await fetcher.close();
    await site.close();
  }, 60_000);

  it('рендерит главную: body содержит ссылку /about, статус и content-type из ответа', async () => {
    const outcome = await fetcher.fetch(`${site.origin}/`, 30_000);
    expect(outcome.status).toBe(200);
    expect(outcome.error).toBeNull();
    expect(outcome.contentType).toMatch(/^text\/html/);
    expect(outcome.body).toContain('<a href="/about">About</a>');
    expect(outcome.finalUrl).toBe(`${site.origin}/`);
    expect(outcome.redirectChain).toEqual([]);
    expect(outcome.sizeBytes).toBeGreaterThan(0);
    expect(outcome.responseTimeMs).toBeGreaterThanOrEqual(0);
  }, 60_000);
});
