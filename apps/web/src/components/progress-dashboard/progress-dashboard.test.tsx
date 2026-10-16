// apps/web/src/components/progress-dashboard.test.tsx
import { describe, it, expect, vi } from 'vitest';
import type { Mock } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import ProgressDashboard from './progress-dashboard';
import { useCrawlSession, type CrawlProgress } from '../../stores/crawl';
import type { Issue } from '@seo-crawler/shared';
import ru from '../../locales/ru.json';
import en from '../../locales/en.json';

const i18n = createI18n({ legacy: false, locale: 'ru', messages: { ru, en } });

const brokenLink: Issue = {
  kind: 'broken-link',
  count: 5,
  sampleUrls: ['http://example.com/missing'],
};

function mountDashboard(opts: { progress?: CrawlProgress; issues?: Issue[]; onStop?: Mock } = {}) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const store = useCrawlSession();
  if (opts.progress) store.progress = opts.progress;
  if (opts.issues) store.issues = opts.issues;
  return mount(ProgressDashboard, {
    props: opts.onStop ? { onStop: opts.onStop } : {},
    global: { plugins: [i18n, pinia] },
  });
}

describe('ProgressDashboard', () => {
  it('рендерит ширину бара, счётчики и сводки из стора', () => {
    const wrapper = mountDashboard({
      progress: { state: 'running', crawled: 30, queued: 70, errors: 2 },
      issues: [brokenLink],
    });

    const bar = wrapper.find('[data-test="progress-bar"]').element as HTMLDivElement;
    expect(bar.style.width).toBe('30%');
    expect(wrapper.find('[data-test="crawled-count"]').text()).toBe('30');
    expect(wrapper.find('[data-test="queued-count"]').text()).toBe('70');
    expect(wrapper.find('[data-test="errors-count"]').text()).toBe('2');
    expect(wrapper.find('[data-test="summary-broken-link"]').text()).toBe(
      `${i18n.global.t('issues.brokenLink')}: 5`,
    );
    expect(wrapper.find('[data-test="summary-duplicate-title"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="state-badge"]').text()).toBe(i18n.global.t('dashboard.running'));
    // без onStop кнопка Stop скрыта
    expect(wrapper.find('[data-test="stop-button"]').exists()).toBe(false);
  });

  it('при crawled+queued === 0 ширина бара 0%', () => {
    const wrapper = mountDashboard({
      progress: { state: 'running', crawled: 0, queued: 0, errors: 0 },
    });
    const bar = wrapper.find('[data-test="progress-bar"]').element as HTMLDivElement;
    expect(bar.style.width).toBe('0%');
  });

  it('клик по Stop вызывает onStop', async () => {
    const onStop = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountDashboard({
      progress: { state: 'running', crawled: 1, queued: 1, errors: 0 },
      onStop,
    });

    const button = wrapper.find('[data-test="stop-button"]');
    expect(button.exists()).toBe(true);
    await button.trigger('click');
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('state done: бейдж «Завершено», кнопка Stop скрыта', () => {
    const onStop = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountDashboard({
      progress: { state: 'done', crawled: 100, queued: 0, errors: 1 },
      onStop,
    });

    expect(wrapper.find('[data-test="state-badge"]').text()).toBe(i18n.global.t('dashboard.done'));
    expect(wrapper.find('[data-test="stop-button"]').exists()).toBe(false);
    expect(onStop).not.toHaveBeenCalled();
  });

  it('state stopped: бейдж «Остановлено», кнопка Stop скрыта', () => {
    const onStop = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountDashboard({
      progress: { state: 'stopped', crawled: 40, queued: 10, errors: 0 },
      onStop,
    });

    expect(wrapper.find('[data-test="state-badge"]').text()).toBe(i18n.global.t('dashboard.stopped'));
    expect(wrapper.find('[data-test="stop-button"]').exists()).toBe(false);
  });
});
