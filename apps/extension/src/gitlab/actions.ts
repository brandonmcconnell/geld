import type { GitLabReviewCapabilities } from './review';

export type GitLabReviewAction = 'approve' | 'request-changes' | 'comment';

export interface GitLabActionDescriptor {
  readonly kind: GitLabReviewAction;
  readonly available: boolean;
  readonly reason?: string;
  activate(): Promise<boolean>;
}

const OUTCOMES: Readonly<Record<GitLabReviewAction, string>> = {
  approve: 'approved',
  'request-changes': 'requested_changes',
  comment: 'reviewed',
};

function drawerButton(doc: Document): HTMLButtonElement | null {
  return doc.querySelector<HTMLButtonElement>('button[data-testid="review-drawer-toggle"]');
}

function composer(doc: Document): HTMLTextAreaElement | null {
  const fields = doc.querySelectorAll<HTMLTextAreaElement>('textarea[data-testid="comment-textarea"], textarea#note-body');
  return [...fields].find((field) => !field.disabled && !field.readOnly && field.closest('[hidden], [aria-hidden="true"]') === null) ?? null;
}

function outcome(doc: Document, kind: GitLabReviewAction): HTMLInputElement | null {
  return doc.querySelector<HTMLInputElement>(`[data-testid="reviewer_states"] input[type="radio"][value="${OUTCOMES[kind]}"]`);
}

function permitted(kind: GitLabReviewAction, permissions: GitLabReviewCapabilities, doc: Document): boolean {
  if (!permissions.signedIn) return false;
  if (kind === 'approve' && !permissions.canApprove) return false;
  if (kind === 'request-changes' && permissions.requestChanges === 'unavailable') return false;
  if (kind === 'comment' && permissions.canComment && composer(doc) !== null) return true;
  const button = drawerButton(doc);
  const radio = outcome(doc, kind);
  return permissions.canReview && ((button !== null && !button.disabled) || (radio !== null && !radio.disabled));
}

function waitForOutcome(doc: Document, kind: GitLabReviewAction): Promise<HTMLInputElement | null> {
  const present = outcome(doc, kind);
  if (present !== null) return Promise.resolve(present);
  const view = doc.defaultView;
  if (view === null) return Promise.resolve(null);
  return new Promise((resolve) => {
    const observer = new view.MutationObserver(() => {
      const radio = outcome(doc, kind);
      if (radio !== null) finish(radio);
    });
    const timer = view.setTimeout(() => finish(null), 3000);
    const finish = (radio: HTMLInputElement | null): void => {
      observer.disconnect();
      view.clearTimeout(timer);
      resolve(radio);
    };
    observer.observe(doc.documentElement, { childList: true, subtree: true });
  });
}

export async function openGitLabReviewAction(kind: GitLabReviewAction, permissions: GitLabReviewCapabilities, doc: Document = document): Promise<boolean> {
  if (!permitted(kind, permissions, doc)) return false;
  const visit = doc.URL.split('#')[0];
  if (kind === 'comment' && permissions.canComment && outcome(doc, kind) === null) {
    const field = composer(doc);
    if (field !== null) {
      field.focus();
      return true;
    }
  }
  const existing = outcome(doc, kind);
  if (existing === null) drawerButton(doc)?.click();
  const radio = await waitForOutcome(doc, kind);
  if (doc.URL.split('#')[0] !== visit || radio === null || radio.disabled || !radio.isConnected) return false;
  radio.click();
  const field = composer(doc);
  field?.focus();
  return radio.checked;
}

export function readGitLabActions(doc: Document, permissions: GitLabReviewCapabilities): readonly GitLabActionDescriptor[] {
  const kinds: readonly GitLabReviewAction[] = ['approve', 'request-changes', 'comment'];
  return kinds.map((kind) => {
    const available = permitted(kind, permissions, doc);
    return {
      kind,
      available,
      ...(!permissions.signedIn ? { reason: 'Sign in to GitLab to review.' } : !available ? { reason: 'This action is unavailable in GitLab on this page.' } : {}),
      activate: () => openGitLabReviewAction(kind, permissions, doc),
    };
  });
}
