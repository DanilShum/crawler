import type { CrawlTab } from '../stores/crawl';

/** Вкладки краул-экрана: порядок в сайдбаре и i18n-ключи лейблов. */
export const TABS: Array<{ tab: CrawlTab; labelKey: string }> = [
  { tab: 'internal', labelKey: 'tabs.internal' },
  { tab: 'external', labelKey: 'tabs.external' },
  { tab: 'images', labelKey: 'tabs.images' },
];
