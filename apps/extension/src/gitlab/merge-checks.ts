import type { ProviderReviewSubject } from '@geld/review';
import type { ProviderReviewRequirement } from '../providers/review-panel';
import { describeGitLabPage } from './page';
import { isProviderReviewPage } from '../providers/types';

/** Read GitLab's merge widget, excluding selectors copied into an author's Markdown. */
export function readGitLabMergeChecks(doc: Document, subject: ProviderReviewSubject): readonly ProviderReviewRequirement[] | null {
  const page = describeGitLabPage(new URL(doc.URL), doc);
  if (subject.provider !== 'gitlab' || page === null || !isProviderReviewPage(page) || page.kind !== 'overview'
    || page.repository.origin !== subject.origin || page.repository.path !== subject.repository || page.number !== subject.id
    || page.headSha !== null && page.headSha !== subject.headSha) return null;
  const widgets = [...doc.querySelectorAll('.issuable-discussion #widget-state.mr-state-widget')]
    .filter(root => root.closest('[data-geld-ui], .md, .note-text, [data-testid="description-content"]') === null);
  const widget = widgets.length === 1 ? widgets[0] : undefined;
  if (widget === undefined) return null;
  const result: ProviderReviewRequirement[] = [];
  for (const row of widget.querySelectorAll('[data-testid="merge-checks-full"] [data-testid="merge-check"]')) {
    const copy = row.cloneNode(true);
    if (!(copy instanceof Element)) continue;
    for (const control of copy.querySelectorAll('button, a, svg, [role="status"]')) control.remove();
    const label = copy.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    if (label === '') continue;
    const state = row.querySelector('[data-testid="status-failed-icon"]') !== null ? 'failed'
      : row.querySelector('[data-testid="status-success-icon"]') !== null ? 'passed'
      : row.querySelector('[data-testid="checking-icon"]') !== null ? 'pending' : 'unknown';
    result.push({ id: `gitlab:${label}`, label, state });
  }
  return result.length > 0 ? result : null;
}
