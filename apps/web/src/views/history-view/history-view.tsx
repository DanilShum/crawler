// apps/web/src/views/history-view.tsx
import { defineComponent, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';

import { fetchCrawls, type SessionMeta } from '../../api/client';

const STATE_BADGE: Record<string, string> = {
  done: 'badge-ok',
  stopped: 'badge-warn',
  running: 'badge-error',
};

const STATE_LABEL: Record<string, string> = {
  done: 'history.stateDone',
  stopped: 'history.stateStopped',
  running: 'history.stateRunning',
};

function badgeClass(state: string): string {
  return STATE_BADGE[state] ?? STATE_BADGE.running;
}

function labelKey(state: string): string {
  return STATE_LABEL[state] ?? STATE_LABEL.running;
}

export default defineComponent({
  name: 'HistoryView',
  setup() {
    const router = useRouter();
    const { t } = useI18n();
    const sessions = ref<SessionMeta[]>([]);
    const loaded = ref(false);

    onMounted(() => {
      fetchCrawls()
        .then((list) => {
          sessions.value = list;
        })
        .catch(() => {
          // не удалось загрузить — показываем пустой список
        })
        .finally(() => {
          loaded.value = true;
        });
    });

    function open(session: SessionMeta): void {
      void router.push(`/crawl/${session.id}`);
    }

    return () => (
      <main class="view history-view">
        <h2>{t('history.title')}</h2>

        {loaded.value && sessions.value.length === 0 ? (
          <p class="history-empty" data-test="history-empty">
            {t('history.empty')}
          </p>
        ) : null}

        {sessions.value.length > 0 ? (
          <div class="history-panel">
            <table class="history-table">
              <thead>
                <tr>
                  <th>{t('history.colUrl')}</th>
                  <th>{t('history.colMode')}</th>
                  <th>{t('history.colState')}</th>
                  <th>{t('history.colCrawled')}</th>
                  <th>{t('history.colStartedAt')}</th>
                </tr>
              </thead>
              <tbody>
                {sessions.value.map((s) => (
                  <tr
                    key={s.id}
                    class="history-row"
                    data-test="history-row"
                    onClick={() => open(s)}
                  >
                    <td class="url-cell">{s.startUrl}</td>
                    <td>{s.mode}</td>
                    <td>
                      <span class={`badge ${badgeClass(s.state)}`}>
                        {t(labelKey(s.state))}
                      </span>
                    </td>
                    <td class="mono">{s.crawled}</td>
                    <td class="history-date">{new Date(s.startedAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </main>
    );
  },
});
