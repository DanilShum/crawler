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
    component: () => import('../views/new-crawl-view'),
    navLabelKey: 'nav.newCrawl',
    navDataTest: 'nav-new-crawl',
  },
  {
    path: '/crawl/:id',
    name: 'crawl',
    component: () => import('../views/crawl-view'),
  },
  {
    path: '/history',
    name: 'history',
    component: () => import('../views/history-view'),
    navLabelKey: 'nav.history',
    navDataTest: 'nav-history',
  },
];
