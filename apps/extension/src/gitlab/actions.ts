import { gitLabReviewIdentity } from './review';
import type { GitLabReviewCapabilities } from './review';
import { describeGitLabPage } from './page';

export type GitLabReviewAction = 'approve' | 'request-changes' | 'comment';

export interface GitLabActionDescriptor {
  readonly kind: GitLabReviewAction;
  readonly available: boolean;
  readonly reason?: string;
  activate(): Promise<boolean>;
}

export interface GitLabActionVisit {
  readonly url: string;
  readonly user: string | null;
  readonly headSha?: string;
  readonly reviewUrl?: string;
}

export function gitLabActionVisit(doc: Document, headSha?: string): GitLabActionVisit {
  return { url: doc.URL.split('#')[0] ?? doc.URL, user: gitLabReviewIdentity(doc), ...(headSha === undefined ? {} : { headSha }) };
}

function sameVisit(doc: Document, visit: GitLabActionVisit): boolean {
  if (visit.user === null || doc.URL.split('#')[0] !== visit.url || gitLabReviewIdentity(doc) !== visit.user) return false;
  try {
    const page = describeGitLabPage(new URL(doc.URL), doc);
    return page !== null && 'number' in page && (visit.reviewUrl === undefined || page.url === visit.reviewUrl)
      && (visit.headSha === undefined || page.headSha === null || page.headSha === visit.headSha);
  } catch { return false; }
}

const OUTCOMES: Readonly<Record<GitLabReviewAction, string>> = {
  approve: 'approved',
  'request-changes': 'requested_changes',
  comment: 'reviewed',
};

function drawerButton(doc: Document): HTMLButtonElement | null {
  const controls = [...doc.querySelectorAll<HTMLButtonElement>('button[data-testid="review-drawer-toggle"]')].filter(nativeControl);
  return controls.length === 1 ? controls[0] ?? null : null;
}

function nativeControl(control: HTMLElement): boolean {
  if (!control.isConnected || control.closest('[data-geld-ui], .note-body, [data-testid="description-content"], [hidden], [aria-hidden="true"], [inert]') !== null) return false;
  for (let node: HTMLElement | null = control; node !== null; node = node.parentElement) {
    const style = control.ownerDocument.defaultView?.getComputedStyle(node);
    if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse' || style?.contentVisibility === 'hidden') return false;
  }
  return true;
}

function enabled(control: HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement): boolean {
  return nativeControl(control) && !control.disabled && !control.hasAttribute('readonly') && control.closest('[aria-disabled="true"], [aria-readonly="true"], fieldset[disabled]') === null;
}

function editable(field: HTMLInputElement | HTMLTextAreaElement): boolean {
  return enabled(field) && !field.readOnly && field.closest('[aria-readonly="true"]') === null;
}

function mainComposer(doc: Document): HTMLTextAreaElement | null {
  const fields = [...doc.querySelectorAll<HTMLTextAreaElement>('textarea#note-body')]
    .filter((field) => editable(field) && field.closest('form[data-testid="submit-gl-form"]') === null);
  return fields.length === 1 ? fields[0] ?? null : null;
}

function reviewComposer(form: HTMLFormElement): HTMLTextAreaElement | null {
  const fields = [...form.querySelectorAll<HTMLTextAreaElement>('textarea[data-testid="comment-textarea"]')]
    .filter((field) => editable(field) && field.closest('form') === form);
  return fields.length === 1 ? fields[0] ?? null : null;
}

function forms(doc: Document): readonly HTMLFormElement[] {
  return [...doc.querySelectorAll<HTMLFormElement>('form[data-testid="submit-gl-form"]')].filter(nativeControl);
}

function placeholder(form: HTMLFormElement): HTMLInputElement | null {
  const fields = [...form.querySelectorAll<HTMLInputElement>('input[data-testid="placeholder-input-field"]')].filter((field) => editable(field) && field.closest('form') === form);
  return fields.length === 1 ? fields[0] ?? null : null;
}

function outcome(doc: Document, kind: GitLabReviewAction): HTMLInputElement | null {
  const sources = forms(doc);
  if (sources.length !== 1) return null;
  const form = sources[0];
  if (form === undefined) return null;
  const candidates = [...form.querySelectorAll<HTMLInputElement>(`[data-testid="reviewer_states"] input[type="radio"][value="${OUTCOMES[kind]}"]`)].filter((field) => nativeControl(field) && field.closest('form') === form);
  return candidates.length === 1 ? candidates[0] ?? null : null;
}

function livePermissions(doc: Document, ceiling: GitLabReviewCapabilities, visit: GitLabActionVisit): GitLabReviewCapabilities {
  const signedIn = ceiling.signedIn && sameVisit(doc, visit);
  const changes = outcome(doc, 'request-changes');
  return {
    signedIn,
    canApprove: signedIn && ceiling.canApprove,
    canComment: signedIn && mainComposer(doc) !== null,
    canReview: signedIn && (forms(doc).length === 1 || drawerButton(doc) !== null),
    requestChanges: changes === null ? 'unknown' : enabled(changes) ? 'available' : 'unavailable',
  };
}

function permitted(kind: GitLabReviewAction, permissions: GitLabReviewCapabilities, doc: Document): boolean {
  if (!permissions.signedIn) return false;
  if (kind === 'approve' && !permissions.canApprove) return false;
  if (kind === 'request-changes' && permissions.requestChanges !== 'available') return false;
  const radio = outcome(doc, kind);
  if (radio !== null) {
    const form = radio.closest<HTMLFormElement>('form[data-testid="submit-gl-form"]');
    return permissions.canReview && enabled(radio) && form !== null && (reviewComposer(form) !== null || placeholder(form) !== null);
  }
  if (kind === 'comment' && permissions.canComment && mainComposer(doc) !== null) return true;
  if (forms(doc).length > 0) return false;
  const button = drawerButton(doc);
  return permissions.canReview && button !== null && enabled(button);
}

function actionControl(doc: Document, kind: GitLabReviewAction): HTMLElement | null {
  return outcome(doc, kind) ?? (kind === 'comment' ? mainComposer(doc) : null) ?? drawerButton(doc);
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
    observer.observe(doc.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'readonly', 'hidden', 'aria-hidden', 'aria-disabled', 'aria-readonly', 'inert', 'data-current-user-data', 'data-is-signed-in', 'data-noteable-data'] });
    for (const event of ['popstate', 'hashchange', 'wxt:locationchange']) view.addEventListener(event, navigation);
  });
}

async function activate(kind: GitLabReviewAction, ceiling: GitLabReviewCapabilities, doc: Document, visit: GitLabActionVisit, expected?: HTMLElement): Promise<boolean> {
  const permissions = livePermissions(doc, ceiling, visit);
  if (!permitted(kind, permissions, doc) || expected !== undefined && actionControl(doc, kind) !== expected) return false;
  const currentVisit = (): boolean => ceiling.signedIn && sameVisit(doc, visit);
  if (kind === 'comment' && permissions.canComment && outcome(doc, kind) === null) {
    const field = mainComposer(doc);
    if (field !== null) {
      field.focus();
      return currentVisit() && editable(field) && mainComposer(doc) === field && doc.activeElement === field;
    }
  }
  const existing = outcome(doc, kind);
  if (existing === null) drawerButton(doc)?.click();
  const radio = await waitForNative(doc, () => outcome(doc, kind), currentVisit);
  if (!currentVisit() || radio === null || !enabled(radio) || outcome(doc, kind) !== radio || !permitted(kind, livePermissions(doc, ceiling, visit), doc)) return false;
  const form = radio.closest<HTMLFormElement>('form[data-testid="submit-gl-form"]');
  if (form === null) return false;
  radio.click();
  const current = (): boolean => currentVisit() && nativeControl(form) && outcome(doc, kind) === radio && enabled(radio) && radio.checked;
  if (!current()) return false;
  let field = reviewComposer(form);
  if (field === null) {
    const fieldPlaceholder = placeholder(form);
    if (fieldPlaceholder === null) return false;
    fieldPlaceholder.focus();
    field = await waitForNative(doc, () => reviewComposer(form), current);
  }
  if (!current() || field === null || !editable(field)) return false;
  field.focus();
  return current() && editable(field) && reviewComposer(form) === field && doc.activeElement === field;
}

export function openGitLabReviewAction(kind: GitLabReviewAction, permissions: GitLabReviewCapabilities, doc: Document = document): Promise<boolean> {
  return permissions.requestChanges === 'unavailable' && kind === 'request-changes' ? Promise.resolve(false) : activate(kind, permissions, doc, gitLabActionVisit(doc));
}

export function readGitLabActions(doc: Document, ceiling: GitLabReviewCapabilities, visit: GitLabActionVisit = gitLabActionVisit(doc)): readonly GitLabActionDescriptor[] {
  const permissions = livePermissions(doc, ceiling, visit);
  const kinds: readonly GitLabReviewAction[] = ['approve', 'request-changes', 'comment'];
  return kinds.map((kind) => {
    const available = permitted(kind, permissions, doc);
    const control = available ? actionControl(doc, kind) : null;
    return {
      kind,
      available,
      ...(!permissions.signedIn ? { reason: 'Sign in to GitLab to review.' } : !available ? { reason: 'This action is unavailable in GitLab on this page.' } : {}),
      activate: () => !available || control === null ? Promise.resolve(false) : activate(kind, ceiling, doc, visit, control),
    };
  });
}

/** Bot commands belong in the existing main writer, never a review summary or thread. */
export function readGitLabMainCommentAction(doc: Document, signedIn: boolean, visit: GitLabActionVisit): GitLabActionDescriptor {
  const candidate = signedIn && visit.user?.startsWith('user:') === true && sameVisit(doc, visit) ? mainComposer(doc) : null;
  const field = candidate?.closest('[contenteditable]:not([contenteditable="false"])') === null ? candidate : null;
  const current = (): boolean => signedIn && sameVisit(doc, visit) && field !== null && mainComposer(doc) === field && field.closest('[contenteditable]:not([contenteditable="false"])') === null;
  return {
    kind: 'comment', available: field !== null,
    ...(field === null ? { reason: !signedIn ? 'Sign in to GitLab to open the native comment writer.' : 'An existing native top-level comment writer is unavailable.' } : {}),
    async activate() {
      if (!current() || field === null) return false;
      const value = field.value;
      const selection = [field.selectionStart, field.selectionEnd, field.selectionDirection] as const;
      field.focus();
      if (!current() || field.value !== value || doc.activeElement !== field) return false;
      field.setSelectionRange(...selection);
      return current() && field.value === value && doc.activeElement === field;
    },
  };
}
