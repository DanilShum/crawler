// apps/web/src/components/results-table/results-table.tsx
import { computed, defineComponent, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { PageResult, PageWithIssues } from '@seo-crawler/shared';

import { useCrawlSession } from '../../stores/crawl';
import { statusClass } from '../../helpers';
import { COLUMNS, PAGE_LIMIT, type SortKey } from '../../constants';

type SortDir = 'asc' | 'desc';

function sortValue(page: PageResult, key: SortKey): string | number {
  switch (key) {
    case 'url':
      return page.url;
    case 'status':
      return page.status ?? -1;
    case 'title':
      return page.title ?? '';
    case 'h1':
      return page.headings.h1[0] ?? '';
    case 'noindex':
      return page.noindex ? 1 : 0;
    case 'depth':
      return page.depth;
    case 'contentType':
      return page.contentType ?? '';
    case 'wordCount':
      return page.wordCount;
  }
}

export default defineComponent({
  name: 'ResultsTable',
  setup() {
    const { t } = useI18n();
    const store = useCrawlSession();

    const query = ref('');
    const sortKey = ref<SortKey | null>(null);
    const sortDir = ref<SortDir>('asc');

    const filtered = computed(() => {
      const q = query.value.trim().toLowerCase();
      if (!q) return store.pages;
      return store.pages.filter(
        (p) =>
          p.url.toLowerCase().includes(q) || (p.title ?? '').toLowerCase().includes(q),
      );
    });

    const rows = computed(() => {
      if (!sortKey.value) return [...filtered.value];
      const dir = sortDir.value === 'asc' ? 1 : -1;
      return [...filtered.value].sort((a, b) => {
        const va = sortValue(a, sortKey.value as SortKey);
        const vb = sortValue(b, sortKey.value as SortKey);
        if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
        return String(va).localeCompare(String(vb)) * dir;
      });
    });

    const hasPrev = computed(() => store.pageOffset > 0);
    const hasNext = computed(() => store.pageOffset + store.pages.length < store.total);

    function toggleSort(key: SortKey): void {
      if (sortKey.value === key) {
        sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc';
      } else {
        sortKey.value = key;
        sortDir.value = 'asc';
      }
    }

    function mark(key: SortKey): string {
      if (sortKey.value !== key) return '';
      return sortDir.value === 'asc' ? ' ↑' : ' ↓';
    }

    function goPrev(): void {
      store.pageOffset = Math.max(0, store.pageOffset - PAGE_LIMIT);
      void store.loadPages().catch(() => {});
    }

    function goNext(): void {
      store.pageOffset += PAGE_LIMIT;
      void store.loadPages().catch(() => {});
    }

    // ячейка по конфигу колонки; статус и noindex — бейджи, остальные — текст
    const cell = (page: PageWithIssues, col: (typeof COLUMNS)[number]) => {
      const attrs = {
        key: col.key,
        class: col.cellClass,
        'data-test': col.cellDataTest,
      };
      if (col.key === 'status') {
        return (
          <td {...attrs}>
            <span class={`badge ${statusClass(page)}`} data-test="status-badge">
              {page.status !== null ? String(page.status) : (page.error ?? t('table.error'))}
            </span>
          </td>
        );
      }
      if (col.key === 'noindex') {
        return (
          <td {...attrs}>
            {page.noindex ? (
              <span class="badge badge-error" data-test="badge-noindex">
                {t('table.noindex')}
              </span>
            ) : null}
          </td>
        );
      }
      const text: Record<SortKey, string | number> = {
        url: page.url,
        title: page.title ?? '—',
        h1: page.headings.h1[0] ?? '—',
        depth: page.depth,
        contentType: page.contentType ?? '—',
        wordCount: page.wordCount,
        // служебные ключи выше отрендерились спец-ветками
        status: '',
        noindex: '',
      };
      return <td {...attrs}>{text[col.key]}</td>;
    };

    return () => (
      <div class="results-panel">
        <div class="table-toolbar">
          <input
            data-test="search"
            class="table-search"
            type="search"
            placeholder={t('table.searchPlaceholder')}
            value={query.value}
            onInput={(e) => {
              query.value = (e.target as HTMLInputElement).value;
            }}
          />
          <span class="caption" data-test="total-count">
            {store.total}
          </span>
        </div>

        <div class="table-scroll" data-test="table-scroll">
          <table class="results-table">
            <thead>
              <tr>
                {COLUMNS.map((col) =>
                  col.sortable
                    ? <th key={col.key} data-test={col.dataTest} onClick={() => toggleSort(col.key)}>{t(col.labelKey)}{mark(col.key)}</th>
                    : <th key={col.key} data-test={col.dataTest}>{t(col.labelKey)}</th>,
                )}
              </tr>
            </thead>
            <tbody>
              {rows.value.length === 0 ? (
                <tr>
                  <td class="table-empty" colspan={COLUMNS.length}>
                    {t('table.empty')}
                  </td>
                </tr>
              ) : (
                rows.value.map((page) => (
                  <tr
                    key={page.url}
                    data-test="row"
                    class="table-row"
                    onClick={() => {
                      store.selectedUrl = page.url;
                    }}
                  >
                    {COLUMNS.map((col) => cell(page, col))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div class="table-pagination">
          <button
            type="button"
            class="btn-page"
            data-test="prev-page"
            disabled={!hasPrev.value}
            onClick={goPrev}
          >
            {t('table.prev')}
          </button>
          <span class="caption">
            {store.pages.length === 0
              ? `0 / ${store.total}`
              : `${store.pageOffset + 1}–${store.pageOffset + store.pages.length} / ${store.total}`}
          </span>
          <button
            type="button"
            class="btn-page"
            data-test="next-page"
            disabled={!hasNext.value}
            onClick={goNext}
          >
            {t('table.next')}
          </button>
        </div>
      </div>
    );
  },
});
