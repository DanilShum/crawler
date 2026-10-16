import { defineComponent } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import logoUrl from '../assets/spider-logo.svg';
import { ROUTES } from '../router/routes';

// Навигационная ссылка: RouterLink при установленном роутере,
// обычный <a> — без него (например, в изолированном юнит-тесте).
const Navlink = defineComponent({
  name: 'Navlink',
  props: { to: { type: String, required: true } },
  setup(props, { slots }) {
    const router = useRouter();
    return () =>
      router ? (
        <RouterLink to={props.to}>{slots.default?.()}</RouterLink>
      ) : (
        <a href={props.to}>{slots.default?.()}</a>
      );
  },
});

export default defineComponent({
  name: 'AppHeader',
  setup() {
    const { t, locale } = useI18n();
    const setLang = (lang: 'ru' | 'en') => {
      localStorage.setItem('lang', lang);
      locale.value = lang;
    };
    // пункты навигации — из того же конфига, что и маршруты
    const navRoutes = ROUTES.filter((r) => r.navLabelKey !== undefined);
    return () => (
      <header class="app-header">
        <img class="app-logo" src={logoUrl} alt="" />
        <h1 class="app-title">{t('header.title')}</h1>
        <nav class="app-nav">
          {navRoutes.map((r) => (
            <Navlink key={r.name} to={r.path} data-test={r.navDataTest}>
              {t(r.navLabelKey!)}
            </Navlink>
          ))}
        </nav>
        <div class="lang-switch" role="group" aria-label={t('langSwitch')}>
          <button type="button" data-test="lang-ru" onClick={() => setLang('ru')}>
            RU
          </button>
          <button type="button" data-test="lang-en" onClick={() => setLang('en')}>
            EN
          </button>
        </div>
      </header>
    );
  },
});
