import { normalizeReviewAccountId, withTrustedSummaryPublisher } from '@geld/core';
import type { RepositoryIdentity } from '@geld/core';
import { sourceLink } from '@geld/review';
import type { ProviderReviewComment } from '@geld/review';
import './reviewer-identity.css';

export interface PublisherIdentityControl { destroy(): void }

function commentLink(comment: ProviderReviewComment, repository: RepositoryIdentity): string | null {
  try {
    withTrustedSummaryPublisher([], repository, comment.author.id);
    if (!/^[1-9]\d*$/.test(comment.id) || normalizeReviewAccountId(repository.provider, comment.author.id) === null) return null;
    if (repository.provider === 'gitlab' ? comment.anchor !== `note_${comment.id}` : comment.anchor !== `comment-${comment.id}` && comment.anchor !== `comment_${comment.id}`) return null;
    const url = new URL(comment.url);
    const route = `/${repository.path.split('/').map(encodeURIComponent).join('/')}/${repository.provider === 'gitlab' ? '-/merge_requests' : 'pull-requests'}/`;
    if (!url.pathname.startsWith(route)) return null;
    const id = url.pathname.slice(route.length).split('/')[0];
    if (id === undefined || !/^[1-9]\d*$/.test(id)) return null;
    return sourceLink({ anchor: comment.anchor, url: comment.url, kind: 'comment', author: comment.author.login }, { provider: repository.provider, origin: repository.origin, repository: repository.path, id, headSha: '0'.repeat(40) });
  } catch { return null; }
}

/** The caller offers this only for a strict scoped native publication candidate. */
export function renderPublisherIdentity(host: HTMLElement, comment: ProviderReviewComment, repository: RepositoryIdentity, save: () => Promise<void>): PublisherIdentityControl {
  const url = commentLink(comment, repository);
  if (url === null) return { destroy() {} };
  const doc = host.ownerDocument;
  const scope = `${new URL(repository.origin).host}/${repository.path}`;
  let destroyed = false;
  let pending = false;
  let saved = false;
  const element = doc.createElement('details');
  element.className = 'geld-provider-reviewer-identity geld-provider-publisher-identity';
  const summary = doc.createElement('summary');
  summary.textContent = 'Trust this account’s Geld summaries in this repository';
  const content = doc.createElement('div');
  content.className = 'geld-provider-reviewer-identity__content';
  const explanation = doc.createElement('p');
  explanation.textContent = 'This account may publish Geld summaries here. This choice does not identify a review bot or verify that a CI job ran.';
  const metadata = doc.createElement('dl');
  for (const [label, text] of [['Repository', scope], ['Account', comment.author.login], ['Native account ID', comment.author.id]]) {
    const term = doc.createElement('dt');term.textContent = label ?? '';
    const value = doc.createElement('dd');value.textContent = text ?? '';
    metadata.append(term, value);
  }
  const original = doc.createElement('a');
  original.href = url;original.target = '_blank';original.rel = 'noopener noreferrer';original.textContent = 'View original Geld summary';
  const confirmation = doc.createElement('p');
  confirmation.textContent = `Trust ${comment.author.login} to publish Geld summaries for ${scope}?`;
  const controls = doc.createElement('div');
  controls.className = 'geld-provider-review__source-actions';
  const trust = doc.createElement('button');trust.type = 'button';trust.textContent = 'Trust summaries';
  const cancel = doc.createElement('button');cancel.type = 'button';cancel.textContent = 'Cancel';
  const status = doc.createElement('p');status.setAttribute('role', 'status');status.hidden = true;
  const error = doc.createElement('p');error.className = 'geld-provider-reviewer-identity__error';error.setAttribute('role', 'alert');error.hidden = true;
  trust.addEventListener('click', () => { void confirm(); });
  cancel.addEventListener('click', () => { if (!destroyed && !pending) { element.open = false;summary.focus(); } });
  async function confirm(): Promise<void> {
    if (destroyed || pending || saved) return;
    pending = true;trust.disabled = true;cancel.disabled = true;content.setAttribute('aria-busy', 'true');error.hidden = true;
    status.textContent = 'Saving summary publisher…';status.hidden = false;
    try {
      await save();
      if (destroyed) return;
      saved = true;status.textContent = `Trusted ${comment.author.login} to publish Geld summaries for ${scope}.`;
      summary.textContent = 'Summary publisher trusted';controls.hidden = true;
    } catch (reason: unknown) {
      if (destroyed) return;
      const detail = reason instanceof Error ? reason.message : 'The settings could not be saved.';
      error.textContent = `Could not trust summary publisher: ${detail}`;error.hidden = false;status.hidden = true;
    } finally {
      if (!destroyed) { pending = false;trust.disabled = false;cancel.disabled = false;content.removeAttribute('aria-busy'); }
    }
  }
  controls.append(trust, cancel);content.append(explanation, metadata, original, confirmation, controls, status, error);element.append(summary, content);host.append(element);
  return { destroy() { destroyed = true;element.remove(); } };
}
