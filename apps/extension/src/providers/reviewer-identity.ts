import { normalizeReviewAccountId } from '@geld/core';
import type { RepositoryIdentity } from '@geld/core';
import type { ProviderReviewComment } from '@geld/review';
import './reviewer-identity.css';

let nextControlId = 0;

export interface ReviewerIdentityChoice {
  readonly id: string;
  readonly label: string;
}

export interface ReviewerIdentityControl {
  destroy(): void;
}

function commentLink(comment: ProviderReviewComment, repository: RepositoryIdentity): string | null {
  try {
    const origin = new URL(repository.origin);
    const url = new URL(comment.url);
    if (origin.protocol !== 'https:' || origin.origin !== repository.origin || url.origin !== origin.origin || url.username !== '' || url.password !== '') return null;
    const parts = repository.path.split('/');
    if (parts.length < 2 || parts.some((part) => part === '' || part === '.' || part === '..' || /[/?#\\\x00-\x1f]/.test(part))) return null;
    const path = `/${parts.map(encodeURIComponent).join('/')}/${repository.provider === 'gitlab' ? '-/merge_requests/' : 'pull-requests/'}`;
    if (!url.pathname.startsWith(path)) return null;
    const tail = url.pathname.slice(path.length);
    if (!/^[1-9]\d*(?:\/[^?#]*)?$/.test(tail)) return null;
    const fragment = decodeURIComponent(url.hash.slice(1));
    if (repository.provider === 'gitlab' ? fragment !== `note_${comment.id}` : fragment !== `comment-${comment.id}` && fragment !== `comment_${comment.id}`) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** The caller selects eligible accounts and supported services. Only an explicit
 * confirmation can save an account binding; names and comment bodies never do. */
export function renderReviewerIdentity(
  host: HTMLElement,
  comment: ProviderReviewComment,
  repository: RepositoryIdentity,
  choices: readonly ReviewerIdentityChoice[],
  save: (botId: string) => Promise<void>,
): ReviewerIdentityControl {
  const url = commentLink(comment, repository);
  const accountId = normalizeReviewAccountId(repository.provider, comment.author.id);
  const seen = new Set<string>();
  const services = choices.map(({ id, label }) => ({ id, label })).filter((choice) => {
    if (!/^[a-z][a-z0-9-]*$/.test(choice.id) || choice.label.trim() === '' || seen.has(choice.id)) return false;
    seen.add(choice.id);
    return true;
  });
  if (url === null || accountId === null || services.length === 0) return { destroy() {} };

  const doc = host.ownerDocument;
  const scope = `${new URL(repository.origin).host}/${repository.path}`;
  const login = comment.author.login;
  let destroyed = false;
  let pending = false;
  let selected: ReviewerIdentityChoice | null = null;
  let selectedButton: HTMLButtonElement | null = null;
  const element = doc.createElement('details');
  element.className = 'geld-provider-reviewer-identity';
  const summary = doc.createElement('summary');
  summary.textContent = 'Identify reviewer';
  const content = doc.createElement('div');
  content.className = 'geld-provider-reviewer-identity__content';
  const explanation = doc.createElement('p');
  explanation.textContent = 'Choose the service that owns this account. Your choice applies to this repository.';
  const metadata = doc.createElement('dl');
  function detail(label: string, text: string): void {
    const term = doc.createElement('dt'); term.textContent = label;
    const value = doc.createElement('dd'); value.textContent = text;
    metadata.append(term, value);
  }
  detail('Repository', scope);
  detail('Account', login);
  detail('Native account ID', comment.author.id);
  const original = doc.createElement('a');
  original.href = url;
  original.textContent = 'View original comment';
  original.target = '_blank';
  original.rel = 'noopener noreferrer';
  const serviceList = doc.createElement('div');
  serviceList.className = 'geld-provider-review__source-actions geld-provider-reviewer-identity__choices';
  serviceList.setAttribute('role', 'group');
  serviceList.setAttribute('aria-label', 'Reviewer service');
  const confirmation = doc.createElement('div');
  confirmation.className = 'geld-provider-reviewer-identity__confirmation';
  confirmation.hidden = true;
  const question = doc.createElement('p');
  do { nextControlId += 1; question.id = `geld-reviewer-identity-question-${nextControlId}`; } while (doc.getElementById(question.id) !== null);
  const confirmationButtons = doc.createElement('div');
  confirmationButtons.className = 'geld-provider-review__source-actions';
  const status = doc.createElement('p');
  status.className = 'geld-provider-reviewer-identity__status';
  status.setAttribute('role', 'status');
  status.hidden = true;
  const error = doc.createElement('p');
  error.className = 'geld-provider-reviewer-identity__error';
  error.setAttribute('role', 'alert');
  error.hidden = true;

  function button(label: string): HTMLButtonElement {
    const value = doc.createElement('button');
    value.type = 'button';
    value.textContent = label;
    return value;
  }
  const trust = button('Trust');
  trust.setAttribute('aria-describedby', question.id);
  const cancel = button('Cancel');
  for (const service of services) {
    const choice = button(service.label);
    choice.addEventListener('click', () => {
      if (destroyed || pending) return;
      selected = service;
      selectedButton = choice;
      question.textContent = `Trust ${login} as ${service.label} for this repository?`;
      serviceList.hidden = true;
      confirmation.hidden = false;
      error.hidden = true;
      status.hidden = true;
      trust.focus();
    });
    serviceList.append(choice);
  }
  cancel.addEventListener('click', () => {
    if (destroyed || pending) return;
    selected = null;
    confirmation.hidden = true;
    serviceList.hidden = false;
    error.hidden = true;
    selectedButton?.focus();
  });
  trust.addEventListener('click', () => { void confirm(); });
  async function confirm(): Promise<void> {
    if (destroyed || pending || selected === null) return;
    const service = selected;
    pending = true;
    content.setAttribute('aria-busy', 'true');
    for (const control of content.querySelectorAll('button')) control.disabled = true;
    error.hidden = true;
    status.textContent = 'Saving reviewer identity…';
    status.hidden = false;
    try {
      await save(service.id);
      if (destroyed) return;
      selected = null;
      confirmation.hidden = true;
      serviceList.hidden = true;
      status.textContent = `Identified ${login} as ${service.label} for ${scope}.`;
      summary.textContent = 'Reviewer identified';
    } catch (reason: unknown) {
      if (destroyed) return;
      const detail = reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : '';
      const message = detail.trim() === '' ? 'The settings could not be saved.' : detail;
      error.textContent = `Could not save reviewer identity: ${message}`;
      error.hidden = false;
      status.hidden = true;
    } finally {
      if (!destroyed) {
        pending = false;
        content.removeAttribute('aria-busy');
        for (const control of content.querySelectorAll('button')) control.disabled = false;
      }
    }
  }
  confirmationButtons.append(trust, cancel);
  confirmation.append(question, confirmationButtons);
  content.append(explanation, metadata, original, serviceList, confirmation, status, error);
  element.append(summary, content);
  host.append(element);
  return {
    destroy() {
      destroyed = true;
      element.remove();
    },
  };
}
