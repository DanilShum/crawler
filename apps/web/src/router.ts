import { createRouter, createWebHistory } from 'vue-router';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'new-crawl',
      component: () => import('./views/NewCrawlView'),
    },
    {
      path: '/crawl/:id',
      name: 'crawl',
      component: () => import('./views/CrawlView'),
    },
    {
      path: '/history',
      name: 'history',
      component: () => import('./views/HistoryView'),
    },
  ],
});

export default router;
