import { defineComponent } from 'vue';

export default defineComponent({
  name: 'HistoryView',
  setup() {
    return () => (
      <main class="view">
        <h2>История</h2>
        <p>Заглушка: история сканирований появится позже.</p>
      </main>
    );
  },
});
