import type { ProviderReviewAction } from '../providers/types';
import type { GitLabActionVisit } from './actions';
import type { GitLabReviewerScope } from './reviewer-controls';
import { describeGitLabPage } from './page';
import { gitLabReviewIdentity } from './review';

interface Candidate {
  readonly root: HTMLElement;
  readonly noteable: string;
  readonly viewer: string;
  readonly button: HTMLButtonElement;
}
interface Scope extends Candidate {
  readonly key: string;
  readonly generation: object;
  readonly visit: string;
  readonly subject: string;
  readonly rootParent: Node | null;
  readonly buttonParent: Node | null;
}
interface DraftField {
  readonly node: HTMLInputElement | HTMLTextAreaElement;
  readonly value: string;
  readonly checked: boolean | null;
  readonly start: number | null;
  readonly end: number | null;
  readonly direction: string | null;
}
const scopes = new WeakMap<Document, Scope>();
let sequence = 0;
const EXCLUDED = '[data-geld-ui], .note-body, [data-testid="description-content"], pre, code, [contenteditable]:not([contenteditable="false"])';
const AUTHORED_BUTTON = '.note, .note-text, .md, [data-testid="noteable-note-container"]';
const OVERLAYS = 'dialog, [role="dialog"], [role="menu"], [role="listbox"], [aria-modal="true"], .dropdown-menu, .gl-new-dropdown-panel, .gl-drawer, .merge-request-review-drawer, [data-testid="review-drawer-toggle"]:not(button), .gl-popover, .popover, [popover]';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function id(value: unknown): string | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? String(value)
    : typeof value === 'string' && /^[1-9]\d*$/.test(value) ? value : null;
}

function native(node: HTMLElement): boolean {
  return node.ownerDocument.documentElement.contains(node) && node.closest(EXCLUDED) === null;
}

function hidden(node: HTMLElement): boolean {
  if (node.closest('[hidden], [inert], [aria-hidden="true"]') !== null) return true;
  for (let current: HTMLElement | null = node; current !== null; current = current.parentElement) {
    const style = node.ownerDocument.defaultView?.getComputedStyle(current);
    if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse' || style?.contentVisibility === 'hidden') return true;
  }
  return false;
}

function unobscuredState(node: HTMLElement): boolean {
  if (!native(node) || hidden(node)) return false;
  for (let current: HTMLElement | null = node; current !== null; current = current.parentElement) {
    const style = node.ownerDocument.defaultView?.getComputedStyle(current);
    if (style === undefined || style.opacity === '0') return false;
  }
  const rect = node.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function openSurface(doc: Document): boolean {
  if ([...doc.querySelectorAll<HTMLElement>(OVERLAYS)].some((node) => native(node)
    && (node.closest('.dropdown.show') !== null || node.classList.contains('!gl-block') || !hidden(node)))) return true;
  const active = doc.activeElement;
  return active !== null && active.closest('[data-geld-ui]') === null
    && active.matches('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
}

function candidate(doc: Document, scope: GitLabReviewerScope, visit: GitLabActionVisit): Candidate | null {
  const subject = scope.subject;
  if (doc.hidden || !/^user:[1-9]\d*$/.test(visit.user ?? '') || gitLabReviewIdentity(doc) !== visit.user || doc.URL.split('#')[0] !== visit.url
    || subject.provider !== 'gitlab' || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(subject.headSha)
    || id(scope.projectId) !== scope.projectId || id(scope.noteableId) !== scope.noteableId || openSurface(doc)) return null;
  const page = describeGitLabPage(new URL(doc.URL), doc);
  if (page === null || !('number' in page) || page.number !== subject.id || page.repository.origin !== subject.origin || page.repository.path !== subject.repository
    || page.url !== `${subject.origin}/${subject.repository}/-/merge_requests/${subject.id}` || page.headSha !== subject.headSha) return null;
  const roots = [...doc.querySelectorAll<HTMLElement>('#js-vue-mr-discussions[data-noteable-type="MergeRequest"][data-noteable-data][data-current-user-data]')].filter(native);
  const root = roots.length === 1 ? roots[0] : undefined;
  if (root === undefined) return null;
  const noteable = root.getAttribute('data-noteable-data') ?? '';
  const viewer = root.getAttribute('data-current-user-data') ?? '';
  try {
    const value: unknown = JSON.parse(noteable);
    if (!record(value) || id(value.id) !== scope.noteableId || id(value.iid) !== subject.id || id(value.project_id) !== scope.projectId || value.diff_head_sha !== subject.headSha) return null;
  } catch { return null; }
  const buttons = [...doc.querySelectorAll<HTMLButtonElement>('button[data-testid="review-drawer-toggle"]')]
    .filter((button) => native(button) && button.closest(AUTHORED_BUTTON) === null && button.closest('form, dialog, [role="dialog"], [role="tooltip"], [popover]') === null && !hidden(button));
  const button = buttons.length === 1 ? buttons[0] : undefined;
  return button !== undefined && unobscuredState(button) && button.type === 'button' && button.tabIndex >= 0 && !button.disabled && !button.hasAttribute('readonly')
    && button.getAttribute('aria-expanded') !== 'true'
    && button.closest('[aria-disabled="true"], [aria-readonly="true"], [aria-busy="true"], fieldset[disabled]') === null
    ? { root, noteable, viewer, button } : null;
}

function draftFields(doc: Document): readonly DraftField[] {
  return [...doc.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('form[data-testid="submit-gl-form"] [data-testid="reviewer_states"] input[type="radio"], form[data-testid="submit-gl-form"] textarea[data-testid="comment-textarea"], textarea#note-body')]
    .filter(native).map((node) => ({ node, value: node.value, checked: node instanceof HTMLInputElement ? node.checked : null,
      start: node.selectionStart, end: node.selectionEnd, direction: node.selectionDirection }));
}

function sameDrafts(before: readonly DraftField[], after: readonly DraftField[]): boolean {
  return before.length === after.length && before.every((field, index) => {
    const current = after[index];
    return current !== undefined && current.node === field.node && current.value === field.value && current.checked === field.checked
      && current.start === field.start && current.end === field.end && current.direction === field.direction;
  });
}

function hitButton(button: HTMLButtonElement): boolean {
  const rect = button.getBoundingClientRect();
  const hit = button.ownerDocument.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  return hit !== null && (hit === button || button.contains(hit));
}

export function readGitLabOpenReview(doc: Document, review: GitLabReviewerScope | null, visit: GitLabActionVisit, complete: boolean, generation: object): ProviderReviewAction | null {
  const value = complete && review !== null ? candidate(doc, review, visit) : null;
  if (value === null || review === null) { scopes.delete(doc);return null; }
  const subject = JSON.stringify([review.subject, review.projectId, review.noteableId]);
  let scope = scopes.get(doc);
  if (scope === undefined || scope.generation !== generation || scope.visit !== visit.url || scope.subject !== subject || scope.root !== value.root || scope.rootParent !== value.root.parentNode
    || scope.button !== value.button || scope.buttonParent !== value.button.parentNode || scope.noteable !== value.noteable || scope.viewer !== value.viewer) {
    scope = { ...value, key: `gitlab-open-review-${++sequence}`, generation, visit: visit.url, subject, rootParent: value.root.parentNode, buttonParent: value.button.parentNode };
    scopes.set(doc, scope);
  }
  const original = scope;
  const current = (): boolean => {
    if (scopes.get(doc) !== original || JSON.stringify([review.subject, review.projectId, review.noteableId]) !== original.subject) return false;
    const latest = candidate(doc, review, visit);
    return latest !== null && latest.root === original.root && latest.root.parentNode === original.rootParent && latest.button === original.button
      && latest.button.parentNode === original.buttonParent && latest.noteable === original.noteable && latest.viewer === original.viewer;
  };
  return {
    kind: 'open-review', scopeKey: original.key, available: true,
    async activate(context) {
      if (context?.current() !== true || !current()) return false;
      const drafts = draftFields(doc);
      original.button.scrollIntoView({ block: 'center', behavior: 'auto' });
      if (!context.current() || !current() || !sameDrafts(drafts, draftFields(doc))) return false;
      if (!hitButton(original.button)) return false;
      original.button.focus({ preventScroll: true });
      if (!context.current() || !current() || doc.activeElement !== original.button || !sameDrafts(drafts, draftFields(doc)) || !hitButton(original.button)) return false;
      original.button.click();
      return true; // A native open intent, not hydrated state or a submitted review.
    },
  };
}
