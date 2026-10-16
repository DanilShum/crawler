// Локализуемые лейблы IssueKind — общий для CrawlView и PageDetails.
import type { IssueKind } from '@seo-crawler/shared';

export const ISSUE_LABELS: Record<IssueKind, string> = {
  'broken-link': 'issues.brokenLink',
  'duplicate-title': 'issues.duplicateTitle',
  'duplicate-description': 'issues.duplicateDescription',
  'duplicate-h1': 'issues.duplicateH1',
  'missing-h1': 'issues.missingH1',
  'missing-alt': 'issues.missingAlt',
  noindex: 'issues.noindex',
  'missing-og': 'issues.missingOg',
  'missing-favicon': 'issues.missingFavicon',
  'missing-lang': 'issues.missingLang',
  'heading-order': 'issues.headingOrder',
};
