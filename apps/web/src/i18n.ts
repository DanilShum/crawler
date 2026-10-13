import { createI18n } from 'vue-i18n';
import ru from './locales/ru.json';
import en from './locales/en.json';

const stored =
  typeof localStorage !== 'undefined' ? localStorage.getItem('lang') : null;

export const i18n = createI18n({
  legacy: false,
  locale: stored ?? 'ru',
  fallbackLocale: 'ru',
  messages: { ru, en },
});
