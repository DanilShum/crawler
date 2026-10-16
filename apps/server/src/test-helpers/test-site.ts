import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface TestSite {
  origin: string;
  close(): Promise<void>;
}

export interface TestSiteOptions {
  /** Crawl-delay в секундах для директивы robots.txt (по умолчанию директива отсутствует). */
  crawlDelaySeconds?: number;
}

const PDF_BUFFER = Buffer.from('%PDF-1.4\n% fake pdf body for tests\n');

function homeHtml(): string {
  return [
    '<html><head><title>Home</title></head><body>',
    '<a href="/about">About</a>',
    '<a href="/missing">Bad</a>',
    '<a href="/redirect">Redir</a>',
    '<a href="/binary.pdf">PDF</a>',
    '<a href="/loop">Loop</a>',
    '<a href="/noindex">NoIndex</a>',
    '<a href="https://external.example/">Ext</a>',
    '</body></html>',
  ].join('');
}

function noindexHtml(): string {
  return [
    '<html><head><title>NoIndex</title>',
    '<meta name="robots" content="noindex">',
    '</head><body>',
    '<p>hidden from search</p>',
    '</body></html>',
  ].join('');
}

function aboutHtml(): string {
  return [
    '<html><head><title>About</title>',
    '<link rel="icon" href="/favicon.ico">',
    '</head><body>',
    '<h1>About</h1>',
    '<img src="/logo.png" alt="">',
    '<img src="/pic.png">',
    '<a href="/private/secret">Secret</a>',
    '</body></html>',
  ].join('');
}

function loopHtml(): string {
  return [
    '<html><head><title>Loop</title></head><body>',
    '<a href="/loop">Loop</a>',
    '</body></html>',
  ].join('');
}

function secretHtml(): string {
  return [
    '<html><head><title>Secret</title></head><body>',
    '<p>top secret</p>',
    '</body></html>',
  ].join('');
}

function sitemapXml(origin: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    `<url><loc>${origin}/</loc></url>`,
    `<url><loc>${origin}/about</loc></url>`,
    '</urlset>',
  ].join('\n');
}

// Отличающийся urlset на дефолтном пути /sitemap.xml: он служит фоллбеком движка.
// Если sitemap-режим нашёл карту через robots.txt, в результатах не будет
// only-from-fallback — это честно отличает авто-обнаружение от жёсткого фоллбека.
function fallbackSitemapXml(origin: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    `<url><loc>${origin}/only-from-fallback</loc></url>`,
    '</urlset>',
  ].join('\n');
}

export async function startTestSite(port = 0, options: TestSiteOptions = {}): Promise<TestSite> {
  let origin = '';

  const server = http.createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    switch (path) {
      case '/':
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(homeHtml());
        break;
      case '/about':
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(aboutHtml());
        break;
      case '/redirect':
        res.writeHead(301, { location: '/about' });
        res.end();
        break;
      case '/missing':
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('not found');
        break;
      case '/binary.pdf':
        res.writeHead(200, { 'content-type': 'application/pdf' });
        res.end(PDF_BUFFER);
        break;
      case '/loop':
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(loopHtml());
        break;
      case '/noindex':
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(noindexHtml());
        break;
      case '/private/secret':
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(secretHtml());
        break;
      case '/robots.txt':
        const crawlDelayLine = options.crawlDelaySeconds !== undefined
          ? `Crawl-delay: ${options.crawlDelaySeconds}\n`
          : '';
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(`User-agent: *\nAllow: /\nDisallow: /private/\n${crawlDelayLine}Sitemap: ${origin}/sitemaps/index.xml\n`);
        break;
      // Каноническая карта: доступна только через robots.txt (нестандартный путь).
      case '/sitemaps/index.xml':
        res.writeHead(200, { 'content-type': 'application/xml; charset=utf-8' });
        res.end(sitemapXml(origin));
        break;
      // Дефолтный фоллбек-путь движка — заведомо другой urlset.
      case '/sitemap.xml':
        res.writeHead(200, { 'content-type': 'application/xml; charset=utf-8' });
        res.end(fallbackSitemapXml(origin));
        break;
      default:
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('not found');
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });

  const address = server.address() as AddressInfo;
  origin = `http://127.0.0.1:${address.port}`;

  return {
    origin,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
