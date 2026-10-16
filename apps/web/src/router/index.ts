import { createRouter, createWebHistory } from 'vue-router';

import { ROUTES } from './routes';

const router = createRouter({
  history: createWebHistory(),
  routes: ROUTES.map((r) => ({ path: r.path, name: r.name, component: r.component })),
});

export default router;
