// apps/web/src/components/AppHeader.test.tsx
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import AppHeader from './AppHeader';
import ru from '../locales/ru.json';
import en from '../locales/en.json';

const i18n = createI18n({ legacy: false, locale: 'ru', messages: { ru, en } });

describe('AppHeader', () => {
  it('рендерит навигацию и переключает язык', async () => {
    const wrapper = mount(AppHeader, { global: { plugins: [i18n] } });
    expect(wrapper.text()).toContain('Новое сканирование');
    await wrapper.find('[data-test="lang-en"]').trigger('click');
    expect(wrapper.text()).toContain('New crawl');
  });
});
