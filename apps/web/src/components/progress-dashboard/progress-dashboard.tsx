// apps/web/src/components/progress-dashboard.tsx
import { computed, defineComponent, type PropType } from 'vue';
import { useI18n } from 'vue-i18n';
import type { IssueKind } from '@seo-crawler/shared';

import { useCrawlSession } from '../../stores/crawl';

type StopHandler = () => Promise<void>;

const SUMMARY_KINDS: Array<{ kind: IssueKind; labelKey: string }> = [
  { kind: 'broken-link', labelKey: 'brokenLink' },
  { kind: 'duplicate-title', labelKey: 'duplicateTitle' },
  { kind: 'noindex', labelKey: 'noindex' },
];

export default defineComponent({
  name: 'ProgressDashboard',
  props: {
    onStop: {
      type: Function as PropType<StopHandler>,
      required: false,
    },
  },
  setup(props) {
    const { t } = useI18n();
    const store = useCrawlSession();

    const percent = computed(() => {
      const total = store.progress.crawled + store.progress.queued;
      if (total === 0) return 0;
      return Math.round((store.progress.crawled / total) * 100);
    });

    const summaries = computed(
      () =>
        SUMMARY_KINDS.flatMap(({ kind, labelKey }) => {
          const issue = store.issues.find((i) => i.kind === kind);
          return issue ? [{ kind, label: t(`issues.${labelKey}`), count: issue.count }] : [];
        }),
    );

    const stateBadge = computed(() => {
      switch (store.progress.state) {
        case 'done':
          return { cls: 'badge-ok', text: t('dashboard.done') };
        case 'stopped':
          return { cls: 'badge-warn', text: t('dashboard.stopped') };
        default:
          return { cls: 'badge-accent', text: t('dashboard.running') };
      }
    });

    const showStop = computed(
      () => store.progress.state === 'running' && typeof props.onStop === 'function',
    );

    return () => (
      <div class="progress-dashboard">
        <div class="progress">
          <div class="progress-fill" data-test="progress-bar" style={{ width: `${percent.value}%` }} />
        </div>

        <div class="counter">
          <span class="caption">{t('dashboard.crawled')}</span>
          <span class="counter-value" data-test="crawled-count">
            {store.progress.crawled}
          </span>
        </div>
        <div class="counter">
          <span class="caption">{t('dashboard.queued')}</span>
          <span class="counter-value" data-test="queued-count">
            {store.progress.queued}
          </span>
        </div>
        <div class="counter counter-errors">
          <span class="caption">{t('dashboard.errors')}</span>
          <span class="counter-value" data-test="errors-count">
            {store.progress.errors}
          </span>
        </div>

        {summaries.value.map((s) => (
          <span class="issue-summary" key={s.kind} data-test={`summary-${s.kind}`}>
            {s.label}: {s.count}
          </span>
        ))}

        <span class={`badge ${stateBadge.value.cls}`} data-test="state-badge">
          {stateBadge.value.text}
        </span>

        {showStop.value ? (
          <button
            type="button"
            class="btn-stop"
            data-test="stop-button"
            onClick={() => {
              const stop = props.onStop;
              if (stop) void stop();
            }}
          >
            {t('dashboard.stop')}
          </button>
        ) : null}
      </div>
    );
  },
});
