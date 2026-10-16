import { defineComponent } from 'vue';
import { RouterView } from 'vue-router';
import AppHeader from './components/app-header';

export default defineComponent({
  name: 'App',
  setup() {
    return () => (
      <div class="app">
        <AppHeader />
        <RouterView />
      </div>
    );
  },
});
