// apps/web/src/views/CrawlView.tsx
import { computed, defineComponent, onMounted, onUnmounted } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import type { Issue, IssueKind } from '@seo-crawler/shared';

import ProgressDashboard from '../components/ProgressDashboard';
import ResultsTable from '../components/ResultsTable';
import PageDetails from '../components/PageDetails';
import { useCrawlSession, type CrawlTab } from '../stores/crawl';
import { exportUrl, stopCrawl } from '../api/client';

const TABS: Array<{ tab: CrawlTab; labelKey: string }> = [
  { tab: 'internal', labelKey: 'tabs.internal' },
  { tab: 'external', labelKey: 'tabs.external' },
  { tab: 'images', labelKey: 'tabs.images' },
];

const ISSUE_LABELS: Record<IssueKind, string> = {
  'broken-link': 'issues.brokenLink',
  'duplicate-title': 'issues.duplicateTitle',
  'duplicate-description': 'issues.duplicateDescription',
  'duplicate-h1': 'issues.duplicateH1',
  'missing-h1': 'issues.missingH1',
  'missing-alt': 'issues.missingAlt',
  noindex: 'issues.noindex',
};

export default defineComponent({
  name: 'CrawlView',
  setup() {
    const route = useRoute();
    const { t } = useI18n();
    const store = useCrawlSession();

    const selectedPage = computed(() => {
      if (!store.selectedUrl) return null;
      const found = store.pages.find((p) => p.url === store.selectedUrl);
      return found ?? null;
    });

    async function handleStop(): Promise<void> {
      if (!store.id) return;
      await stopCrawl(store.id);
    }

    function toggleIssueFilter(issue: Issue): void {
      store.setIssueFilter(store.issueFilter === issue.kind ? null : issue.kind);
    }

    onMounted(() => {
      const sessionId = route.params.id;
      if (typeof sessionId === 'string' && sessionId) {
        store.open(sessionId);
      }
    });

    onUnmounted(() => {
      store.close();
    });

    return () => (
      <main class="view crawl-view">
        <ProgressDashboard onStop={handleStop} />

        {store.id ? (
          <div class="crawl-toolbar">
            <a
              class="btn-export"
              data-test="export-link"
              href={exportUrl(store.id)}
              download
            >
              {t('crawl.export')}
            </a>
          </div>
        ) : null}

        <div class={['crawl-layout', selectedPage.value ? 'with-details' : ''].join(' ')}>
          <aside class="crawl-sidebar">
            <div class="tabs" role="tablist">
              {TABS.map(({ tab, labelKey }) => (
                <button
                  key={tab}
                  type="button"
                  class={['tab-item', store.tab === tab ? 'active' : ''].join(' ')}
                  data-test={`tab-${tab}`}
                  onClick={() => store.setTab(tab)}
                >
                  {t(labelKey)}
                </button>
              ))}
            </div>

            <section class="issues-panel">
              <h3 class="issues-title">{t('tabs.issues')}</h3>
              {store.issues.length === 0 ? (
                <p class="pd-muted">{t('issues.empty')}</p>
              ) : (
                <ul class="issues-list">
                  {store.issues.map((issue) => (
                    <li key={issue.kind}>
                      <button
                        type="button"
                        class={['issue-item', store.issueFilter === issue.kind ? 'active' : ''].join(
                          ' ',
                        )}
                        data-test={`issue-${issue.kind}`}
                        onClick={() => toggleIssueFilter(issue)}
                      >
                        <span>{t(ISSUE_LABELS[issue.kind])}</span>
                        <span class="issue-count">{issue.count}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </aside>

          <section class="results-wrap">
            <ResultsTable />
          </section>

          {selectedPage.value ? (
            <PageDetails
              page={selectedPage.value}
              onClose={() => {
                store.selectedUrl = null;
              }}
            />
          ) : null}
        </div>
      </main>
    );
  },
});
