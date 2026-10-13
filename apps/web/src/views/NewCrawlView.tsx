// apps/web/src/views/NewCrawlView.tsx
import { defineComponent, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import type { CrawlOptions } from '@seo-crawler/shared';
import CrawlForm from '../components/CrawlForm';
import { startCrawl } from '../api/client';

export default defineComponent({
  name: 'NewCrawlView',
  setup() {
    const router = useRouter();
    const { t } = useI18n();
    const apiError = ref('');

    async function handleSubmit(options: CrawlOptions) {
      apiError.value = '';
      try {
        const { id } = await startCrawl(options);
        router.push(`/crawl/${id}`);
      } catch (err) {
        apiError.value = t('form.apiError', {
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return () => (
      <main class="view">
        {apiError.value ? (
          <div class="api-error" data-test="api-error">
            {apiError.value}
          </div>
        ) : null}
        <CrawlForm onSubmit={handleSubmit} />
      </main>
    );
  },
});
