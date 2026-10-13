import { defineComponent } from 'vue';

export default defineComponent({
  name: 'CrawlView',
  setup() {
    return () => (
      <main class="view">
        <h2>Краул</h2>
        <p>Заглушка: экран хода краула появится позже.</p>
      </main>
    );
  },
});
