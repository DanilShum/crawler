// apps/web/src/components/PageDetails.tsx
import { computed, defineComponent, type PropType } from 'vue';
import { useI18n } from 'vue-i18n';
import { statusClass, formatBytes } from '../helpers';
import { type HeadingLevel, type IssueKind, type LinkInfo, type PageResult } from '@seo-crawler/shared';

import { ISSUE_LABELS } from '../constants';

type BrokenLink = { url: string; status: number | null };

const HEADING_LEVELS: HeadingLevel[] = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];

function renderLinks(links: LinkInfo[], broken: BrokenLink[], t: (k: string) => string) {
  if (links.length === 0) return <p class="pd-muted">—</p>;
  const brokenBy = (url: string): BrokenLink | undefined => broken.find((b) => b.url === url);
  return (
    <ul class="pd-list">
      {links.map((l, i) => {
        const b = brokenBy(l.url);
        return (
          <li key={i} data-test="link-item">
            <span class="mono pd-url-sm">{l.url}</span>
            {l.anchor !== null ? <span class="pd-muted"> ({l.anchor})</span> : null}
            {l.rel !== null ? <span class="pd-muted"> [{l.rel}]</span> : null}
            {b !== undefined ? (
              <span class="badge badge-error pd-alt" data-test="link-broken">
                {b.status !== null ? b.status : t('table.error')}
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export default defineComponent({
  name: 'PageDetails',
  props: {
    page: {
      type: Object as PropType<PageResult>,
      required: true,
    },
    issues: {
      type: Array as PropType<IssueKind[]>,
      required: false,
      default: () => [],
    },
    brokenLinks: {
      type: Array as PropType<BrokenLink[]>,
      required: false,
      default: () => [],
    },
    onClose: {
      type: Function as PropType<() => void>,
      required: false,
    },
  },
  setup(props) {
    const { t } = useI18n();

    const statusText = computed(() =>
      props.page.status !== null ? String(props.page.status) : (props.page.error ?? t('details.error')),
    );

    const has = (kind: IssueKind): boolean => props.issues.includes(kind);

    return () => (
      <aside class="page-details" data-test="page-details">
        <div class="pd-header">
          <div>
            <div class="caption">{t('details.url')}</div>
            <div class="pd-url" data-test="details-url">
              {props.page.url}
            </div>
          </div>
          <button
            type="button"
            class="pd-close"
            data-test="close-details"
            onClick={() => props.onClose?.()}
          >
            {t('details.close')}
          </button>
        </div>

        <div class="pd-body">
          <div class="pd-section pd-badges">
            <span class={`badge ${statusClass(props.page)}`} data-test="status-badge">
              {statusText.value}
            </span>
            {props.page.noindex ? (
              <span class="badge badge-error" data-test="badge-noindex">
                {t('details.noindex')}
              </span>
            ) : null}
            {props.page.nofollow ? (
              <span class="badge badge-warn" data-test="badge-nofollow">
                {t('details.nofollow')}
              </span>
            ) : null}
          </div>

          {props.issues.length > 0 ? (
            <div class="pd-section pd-issues" data-test="page-issues">
              {props.issues.map((kind) => (
                <span key={kind} class="badge badge-warn" data-test="page-issue">
                  {t(ISSUE_LABELS[kind])}
                </span>
              ))}
            </div>
          ) : null}

          {props.page.error !== null ? (
            <div class="pd-section">
              <div class="caption">{t('details.error')}</div>
              <div class="pd-error" data-test="page-error">
                {props.page.error}
              </div>
            </div>
          ) : null}

          <div class="pd-section">
            <h4>{t('details.metadata')}</h4>
            <dl class="pd-kv">
              <dt>{t('details.title')}</dt>
              <dd data-test="meta-title">{props.page.title ?? '—'}</dd>
              <dt>{t('details.description')}</dt>
              <dd data-test="meta-description">{props.page.description ?? '—'}</dd>
              <dt>{t('details.metaRobots')}</dt>
              <dd data-test="meta-robots">{props.page.metaRobots ?? '—'}</dd>
              <dt>{t('details.canonical')}</dt>
              <dd data-test="meta-canonical">{props.page.canonical ?? '—'}</dd>
              <dt>{t('details.contentType')}</dt>
              <dd data-test="meta-content-type">{props.page.contentType ?? '—'}</dd>
              <dt>{t('details.size')}</dt>
              <dd data-test="meta-size">{formatBytes(props.page.sizeBytes)}</dd>
              <dt>{t('details.responseTime')}</dt>
              <dd data-test="meta-response-time">{`${props.page.responseTimeMs} ms`}</dd>
              <dt>{t('details.depth')}</dt>
              <dd data-test="meta-depth">{props.page.depth}</dd>
              <dt>{t('details.fetchedAt')}</dt>
              <dd data-test="meta-fetched-at">{new Date(props.page.fetchedAt).toLocaleString()}</dd>
              <dt>{t('details.rendered')}</dt>
              <dd data-test="meta-rendered">
                {props.page.rendered ? t('details.yes') : t('details.no')}
              </dd>
              <dt>{t('details.wordCount')}</dt>
              <dd data-test="details-wordcount">{props.page.wordCount}</dd>
              <dt>{t('details.lang')}</dt>
              <dd data-test="details-lang">
                {props.page.lang ?? '—'}
                {has('missing-lang') ? (
                  <span class="badge badge-error pd-alt" data-test="field-issue-missing-lang">
                    {t(ISSUE_LABELS['missing-lang'])}
                  </span>
                ) : null}
              </dd>
            </dl>
          </div>

          <div class="pd-section">
            <h4>{t('details.redirectChain')}</h4>
            {props.page.redirectChain.length === 0 ? (
              <p class="pd-muted" data-test="redirect-chain">—</p>
            ) : (
              <ul class="pd-list" data-test="redirect-chain">
                {props.page.redirectChain.map((u, i) => (
                  <li key={i} class="mono pd-url-sm">
                    {u}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div class="pd-section">
            <h4>
              {t('details.headings')}
              {has('missing-h1') ? (
                <span class="badge badge-error pd-alt" data-test="section-issue-missing-h1">
                  {t(ISSUE_LABELS['missing-h1'])}
                </span>
              ) : null}
              {has('heading-order') ? (
                <span class="badge badge-warn pd-alt" data-test="section-issue-heading-order">
                  {t(ISSUE_LABELS['heading-order'])}
                </span>
              ) : null}
            </h4>
            {HEADING_LEVELS.map((level) =>
              props.page.headings[level].length > 0 ? (
                <div class="pd-heading" key={level} data-test={`heading-${level}`}>
                  <span class="pd-tag">{level.toUpperCase()}</span>
                  <ul class="pd-list">
                    {props.page.headings[level].map((h, i) => (
                      <li key={i}>{h}</li>
                    ))}
                  </ul>
                </div>
              ) : null,
            )}
          </div>

          <div class="pd-section">
            <h4>{t('details.images')}</h4>
            {props.page.images.length === 0 ? (
              <p class="pd-muted">—</p>
            ) : (
              <ul class="pd-list">
                {props.page.images.map((img, i) => (
                  <li key={i} data-test="image">
                    <span class="mono pd-url-sm">{img.url}</span>
                    {img.alt === null ? (
                      <span class="badge badge-error pd-alt" data-test="missing-alt">
                        {t('details.noAlt')}
                      </span>
                    ) : (
                      <span class="pd-alt" data-test="has-alt">
                        {img.alt}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div class="pd-section">
            <h4>{t('details.internalLinks')}</h4>
            {renderLinks(props.page.internalLinks, props.brokenLinks, t)}
          </div>

          <div class="pd-section">
            <h4>{t('details.externalLinks')}</h4>
            {renderLinks(props.page.externalLinks, props.brokenLinks, t)}
          </div>

          <div class="pd-section">
            <h4>{t('details.schema')}</h4>
            <pre class="pd-pre" data-test="schema-pre">
              {JSON.stringify(props.page.schemaOrg, null, 2)}
            </pre>
          </div>

          <div class="pd-section">
            <h4>
              {t('details.og')}
              {has('missing-og') ? (
                <span class="badge badge-error pd-alt" data-test="section-issue-missing-og">
                  {t(ISSUE_LABELS['missing-og'])}
                </span>
              ) : null}
            </h4>
            {props.page.openGraph === null ? (
              <p class="pd-muted" data-test="details-og-empty">—</p>
            ) : (
              <dl class="pd-kv">
                <dt>title</dt>
                <dd>{props.page.openGraph.title ?? '—'}</dd>
                <dt>description</dt>
                <dd>{props.page.openGraph.description ?? '—'}</dd>
                <dt>image</dt>
                <dd class="mono pd-url-sm">{props.page.openGraph.image ?? '—'}</dd>
                <dt>url</dt>
                <dd class="mono pd-url-sm">{props.page.openGraph.url ?? '—'}</dd>
              </dl>
            )}
          </div>

          <div class="pd-section">
            <h4>{t('details.twitter')}</h4>
            {props.page.twitter === null ? (
              <p class="pd-muted" data-test="details-og-empty">{t('details.ogNone')}</p>
            ) : (
              <dl class="pd-kv">
                <dt>card</dt>
                <dd>{props.page.twitter.card ?? '—'}</dd>
                <dt>title</dt>
                <dd>{props.page.twitter.title ?? '—'}</dd>
                <dt>description</dt>
                <dd>{props.page.twitter.description ?? '—'}</dd>
                <dt>image</dt>
                <dd class="mono pd-url-sm">{props.page.twitter.image ?? '—'}</dd>
              </dl>
            )}
          </div>

          <div class="pd-section">
            <h4>{t('details.hreflang')}</h4>
            {props.page.hreflang.length === 0 ? (
              <p class="pd-muted">—</p>
            ) : (
              <ul class="pd-list">
                {props.page.hreflang.map((h, i) => (
                  <li key={i} class="mono pd-url-sm">
                    {`${h.lang}=${h.href}`}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div class="pd-section">
            <h4>
              {t('details.favicon')}
              {has('missing-favicon') ? (
                <span class="badge badge-error pd-alt" data-test="section-issue-missing-favicon">
                  {t(ISSUE_LABELS['missing-favicon'])}
                </span>
              ) : null}
            </h4>
            {props.page.favicon === null ? (
              <p class="pd-muted">—</p>
            ) : (
              <img
                data-test="details-favicon"
                class="pd-favicon"
                src={props.page.favicon}
                alt=""
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            )}
          </div>
        </div>
      </aside>
    );
  },
});
