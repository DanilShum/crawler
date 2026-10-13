import { XMLParser } from 'fast-xml-parser';

const MAX_SITEMAP_DEPTH = 3;

export async function fetchSitemapUrls(sitemapUrl: string, timeoutMs: number): Promise<string[]> {
  try {
    return await collect(sitemapUrl, timeoutMs, 1);
  } catch {
    return [];
  }
}

async function collect(sitemapUrl: string, timeoutMs: number, depth: number): Promise<string[]> {
  const doc = new XMLParser().parse(await fetchText(sitemapUrl, timeoutMs));
  const urls: string[] = [];

  const urlset = doc?.urlset;
  if (urlset?.url) {
    for (const entry of toArray(urlset.url)) {
      if (typeof entry?.loc === 'string') urls.push(entry.loc);
    }
  }

  const index = doc?.sitemapindex;
  if (index?.sitemap && depth < MAX_SITEMAP_DEPTH) {
    for (const entry of toArray(index.sitemap)) {
      if (typeof entry?.loc !== 'string') continue;
      urls.push(...(await collect(entry.loc, timeoutMs, depth + 1)));
    }
  }

  return urls;
}

function fetchText(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { signal: controller.signal })
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    })
    .finally(() => clearTimeout(timer));
}

// XMLParser отдаёт одиночный элемент объектом, несколько — массивом
function toArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}
