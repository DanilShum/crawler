import robotsParser from 'robots-parser';

export interface RobotsInfo {
  allowed(url: string): boolean;
  crawlDelayMs: number | null;
  sitemaps: string[];
}

export function parseRobots(robotsUrl: string, body: string): RobotsInfo {
  const robots = robotsParser(robotsUrl, body);
  const crawlDelay = robots.getCrawlDelay();
  return {
    // Нет совпавшего правила (undefined) — по robots spec URL разрешён
    allowed: (url: string) => robots.isAllowed(url) ?? true,
    // robots-parser отдаёт Crawl-delay в секундах — контракт требует миллисекунды
    crawlDelayMs: typeof crawlDelay === 'number' ? crawlDelay * 1000 : null,
    sitemaps: robots.getSitemaps(),
  };
}

const allAllowed: RobotsInfo = {
  allowed: () => true,
  crawlDelayMs: null,
  sitemaps: [],
};

const allDenied: RobotsInfo = {
  allowed: () => false,
  crawlDelayMs: null,
  sitemaps: [],
};

export async function fetchRobots(origin: string, timeoutMs: number): Promise<RobotsInfo> {
  const robotsUrl = `${origin}/robots.txt`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(robotsUrl, { signal: controller.signal });
      if (res.ok) {
        return parseRobots(robotsUrl, await res.text());
      }
      // 5xx — консервативно: запрещено всё; 4xx — robots отсутствует, разрешено всё
      return res.status >= 500 ? allDenied : allAllowed;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return allAllowed;
  }
}
