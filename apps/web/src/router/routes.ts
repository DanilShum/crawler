import type { Component } from 'vue';

/** Маршрут приложения; наличие navLabelKey = пункт в навигации шапки. */
export interface AppRoute {
  path: string;
  name: string;
  component: () => Promise<{ default: Component }>;
  navLabelKey?: string;
  navDataTest?: string;
}

/** Единственный источник маршрутов и навигации шапки. */
export const ROUTES: AppRoute[] = [
  {
    path: '/',
    name: 'new-crawl',
    component: () => import('../views/NewCrawlView'),
    navLabelKey: 'nav.newCrawl',
    navDataTest: 'nav-new-crawl',
  },
  {
    path: '/crawl/:id',
    name: 'crawl',
    component: () => import('../views/CrawlView'),
  },
  {
    path: '/history',
    name: 'history',
    component: () => import('../views/HistoryView'),
    navLabelKey: 'nav.history',
    navDataTest: 'nav-history',
  },
];
