export type CrawlMode = 'spider' | 'list' | 'sitemap';

export interface CrawlOptions {
  startUrl: string;
  mode: CrawlMode;
  listUrls?: string[];
  maxUrls: number;
  maxDepth: number;
  respectRobots: boolean;
  renderJs: boolean;
  concurrency: number;
  requestTimeoutMs: number;
}

export interface LinkInfo { url: string; anchor: string | null; rel: string | null; }
export interface ImageInfo { url: string; alt: string | null; }
export type HeadingLevel = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

export interface PageResult {
  url: string;
  status: number | null;            // null при сетевой ошибке
  error: string | null;             // 'timeout' | 'dns' | 'ssl' | 'connection' | ...
  contentType: string | null;
  depth: number;
  fetchedAt: string;                // ISO
  responseTimeMs: number;
  sizeBytes: number;
  rendered: boolean;
  title: string | null;
  description: string | null;
  metaRobots: string | null;
  canonical: string | null;
  headings: Record<HeadingLevel, string[]>;
  images: ImageInfo[];
  internalLinks: LinkInfo[];
  externalLinks: LinkInfo[];
  schemaOrg: unknown[];
  noindex: boolean;
  nofollow: boolean;
  redirectChain: string[];          // промежуточные URL
}

export type CrawlState = 'running' | 'done' | 'stopped';

export type IssueKind =
  | 'broken-link' | 'duplicate-title' | 'duplicate-description'
  | 'duplicate-h1' | 'missing-h1' | 'missing-alt' | 'noindex';

export interface Issue {
  kind: IssueKind;
  count: number;
  sampleUrls: string[];
}

export type CrawlEvent =
  | { type: 'progress'; state: CrawlState; crawled: number; queued: number; errors: number }
  | { type: 'page'; url: string }
  | { type: 'summary'; issues: Issue[] }
  | { type: 'done'; state: CrawlState };
