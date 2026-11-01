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
  return [...doc.querySelectorAll<HTMLButtonElement>('button[data-testid="review-drawer-toggle"]')].find(nativeControl) ?? null;
}

function nativeControl(control: HTMLElement): boolean {
  return control.isConnected && control.closest('[data-geld-ui], [hidden], [aria-hidden="true"], [inert]') === null;
}

function enabled(control: HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement): boolean {
  return nativeControl(control) && !control.disabled && control.closest('fieldset[disabled]') === null;
}

function editable(field: HTMLInputElement | HTMLTextAreaElement): boolean {
  return enabled(field) && !field.readOnly;
}

function mainComposer(doc: Document): HTMLTextAreaElement | null {
  return [...doc.querySelectorAll<HTMLTextAreaElement>('textarea#note-body')]
    .find((field) => editable(field) && field.closest('form[data-testid="submit-gl-form"]') === null) ?? null;
}

function reviewComposer(form: HTMLFormElement): HTMLTextAreaElement | null {
  return [...form.querySelectorAll<HTMLTextAreaElement>('textarea[data-testid="comment-textarea"]')]
    .find((field) => editable(field) && field.closest('form') === form) ?? null;
}

function outcome(doc: Document, kind: GitLabReviewAction): HTMLInputElement | null {
  const candidates = [...doc.querySelectorAll<HTMLInputElement>(`form[data-testid="submit-gl-form"] [data-testid="reviewer_states"] input[type="radio"][value="${OUTCOMES[kind]}"]`)].filter(nativeControl);
  return candidates.length === 1 ? candidates[0] ?? null : null;
}

function permitted(kind: GitLabReviewAction, permissions: GitLabReviewCapabilities, doc: Document): boolean {
  if (!permissions.signedIn) return false;
  if (kind === 'approve' && !permissions.canApprove) return false;
  if (kind === 'request-changes' && permissions.requestChanges === 'unavailable') return false;
  const radio = outcome(doc, kind);
  if (radio !== null) return permissions.canReview && enabled(radio);
  if (kind === 'comment' && permissions.canComment && mainComposer(doc) !== null) return true;
  const button = drawerButton(doc);
  return permissions.canReview && button !== null && enabled(button);
}

function waitForNative<T extends HTMLElement>(doc: Document, find: () => T | null, current: () => boolean): Promise<T | null> {
  if (!current()) return Promise.resolve(null);
  const present = find();
  if (present !== null) return Promise.resolve(present);
  const view = doc.defaultView;
  if (view === null) return Promise.resolve(null);
  return new Promise((resolve) => {
    const observer = new view.MutationObserver(() => {
      if (!current()) { finish(null); return; }
      const control = find();
      if (control !== null) finish(control);
    });
    const timer = view.setTimeout(() => finish(null), 3000);
    const navigation = (): void => { if (!current()) finish(null); };
    const finish = (control: T | null): void => {
      observer.disconnect();
      view.clearTimeout(timer);
      for (const event of ['popstate', 'hashchange', 'wxt:locationchange']) view.removeEventListener(event, navigation);
      resolve(control);
    };
    observer.observe(doc.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'readonly', 'hidden', 'aria-hidden', 'inert'] });
    for (const event of ['popstate', 'hashchange', 'wxt:locationchange']) view.addEventListener(event, navigation);
  });
}

export async function openGitLabReviewAction(kind: GitLabReviewAction, permissions: GitLabReviewCapabilities, doc: Document = document): Promise<boolean> {
  if (!permitted(kind, permissions, doc)) return false;
  const visit = doc.URL.split('#')[0];
  const sameVisit = (): boolean => doc.URL.split('#')[0] === visit;
  if (kind === 'comment' && permissions.canComment && outcome(doc, kind) === null) {
    const field = mainComposer(doc);
    if (field !== null) {
      field.focus();
      return sameVisit() && editable(field) && doc.activeElement === field;
    }
  }
  const existing = outcome(doc, kind);
  if (existing === null) drawerButton(doc)?.click();
  const radio = await waitForNative(doc, () => outcome(doc, kind), sameVisit);
  if (!sameVisit() || radio === null || !enabled(radio) || outcome(doc, kind) !== radio) return false;
  const form = radio.closest<HTMLFormElement>('form[data-testid="submit-gl-form"]');
  if (form === null) return false;
  radio.click();
  const current = (): boolean => sameVisit() && nativeControl(form) && outcome(doc, kind) === radio && enabled(radio) && radio.checked;
  if (!current()) return false;
  let field = reviewComposer(form);
  if (field === null) {
    const placeholder = form.querySelector<HTMLInputElement>('input[data-testid="placeholder-input-field"]');
    if (placeholder === null || !editable(placeholder)) return false;
    placeholder.focus();
    field = await waitForNative(doc, () => reviewComposer(form), current);
  }
  if (!current() || field === null || !editable(field)) return false;
  field.focus();
  return current() && editable(field) && doc.activeElement === field;
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
