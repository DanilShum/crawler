import { defineComponent } from 'vue';

export default defineComponent({
  name: 'NewCrawlView',
  setup() {
    return () => (
      <main class="view">
        <h2>Новое сканирование</h2>
        <p>Заглушка: форма запуска краула появится позже.</p>
      </main>
    );
  },
});
