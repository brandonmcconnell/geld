import type { ProviderReviewSubject } from '@geld/review';
import type { ProviderReviewSourceAction } from '../providers/review-panel';
import type { GitLabActionVisit } from './actions';
import { describeGitLabPage } from './page';
import { gitLabReviewIdentity } from './review';

export interface GitLabReviewerScope {
  readonly subject: ProviderReviewSubject;
  readonly projectId: string;
  readonly noteableId: string;
}

const EXCLUDED = '[data-geld-ui], .note-body, [data-testid="description-content"], [contenteditable]:not([contenteditable="false"])';
const OVERLAYS = '[role="dialog"], [role="menu"], [role="listbox"], [aria-modal="true"], .dropdown-menu, .gl-new-dropdown-panel, .gl-drawer, .gl-popover, .popover, [popover]';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function id(value: unknown): string | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? String(value)
    : typeof value === 'string' && /^[1-9]\d*$/.test(value) ? value : null;
}

function native(node: HTMLElement): boolean {
  return node.isConnected && node.closest(EXCLUDED) === null;
}

function presented(node: HTMLElement): boolean {
  if (!native(node) || node.closest('[hidden], [inert], [aria-hidden="true"]') !== null) return false;
  for (let current: HTMLElement | null = node; current !== null; current = current.parentElement) {
    const style = node.ownerDocument.defaultView?.getComputedStyle(current);
    if (style === undefined || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.contentVisibility === 'hidden' || style.opacity === '0') return false;
  }
  const rect = node.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function openOverlay(node: HTMLElement): boolean {
  if (!native(node)) return false;
  if (node.closest('.dropdown.show') !== null || node.classList.contains('!gl-block')) return true;
  if (node.closest('[hidden], [inert], [aria-hidden="true"]') !== null) return false;
  for (let current: HTMLElement | null = node; current !== null; current = current.parentElement) {
    const style = node.ownerDocument.defaultView?.getComputedStyle(current);
    if (style === undefined) return true;
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.contentVisibility === 'hidden') return false;
  }
  return true;
}

function scopeRoot(doc: Document, scope: GitLabReviewerScope, visit: GitLabActionVisit): HTMLElement | null {
  const subject = scope.subject;
  if (!/^user:[1-9]\d*$/.test(visit.user ?? '') || gitLabReviewIdentity(doc) !== visit.user || doc.URL.split('#')[0] !== visit.url
    || subject.provider !== 'gitlab' || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(subject.headSha)
    || id(scope.projectId) !== scope.projectId || id(scope.noteableId) !== scope.noteableId) return null;
  const page = describeGitLabPage(new URL(doc.URL), doc);
  if (page === null || !('number' in page) || page.number !== subject.id || page.repository.origin !== subject.origin || page.repository.path !== subject.repository
    || page.url !== `${subject.origin}/${subject.repository}/-/merge_requests/${subject.id}` || page.headSha !== subject.headSha) return null;
  const roots = [...doc.querySelectorAll<HTMLElement>('#js-vue-mr-discussions[data-noteable-type="MergeRequest"][data-noteable-data]')].filter(native);
  const root = roots.length === 1 ? roots[0] : undefined;
  if (root === undefined) return null;
  try {
    const value: unknown = JSON.parse(root.getAttribute('data-noteable-data') ?? 'null');
    if (!record(value) || id(value.id) !== scope.noteableId || id(value.iid) !== subject.id || id(value.project_id) !== scope.projectId
      || value.diff_head_sha !== subject.headSha || !record(value.current_user) || value.current_user.can_update !== true) return null;
    return root;
  } catch { return null; }
}

function hiddenMenu(menu: HTMLElement): boolean {
  // Native picker hidden handlers save reviewer assignments, so unknown is never treated as closed.
  const style = menu.ownerDocument.defaultView?.getComputedStyle(menu);
  return native(menu) && style?.display === 'none' && menu.closest('.show, [aria-expanded="true"]') === null;
}

function closed(button: HTMLButtonElement, block: HTMLElement, scope: GitLabReviewerScope): boolean {
  if (button.matches('button.js-reviewer-search[data-toggle="dropdown"]')) {
    if (button.dataset.projectId !== scope.projectId || button.dataset.iid !== scope.subject.id || button.dataset.issuableType !== 'merge_request'
      || button.dataset.fieldName !== 'merge_request[reviewer_ids][]' || button.dataset.abilityName !== 'merge_request'
      || button.dataset.issueUpdate !== `/${scope.subject.repository}/-/merge_requests/${scope.subject.id}.json`) return false;
    const wrapper = button.parentElement;
    if (wrapper === null || !wrapper.matches('.dropdown') || wrapper.closest('[data-testid="reviewers-block-container"]') !== block
      || wrapper.classList.contains('show') || button.getAttribute('aria-expanded') === 'true') return false;
    const menus = [...wrapper.children].filter((node): node is HTMLElement => node instanceof HTMLElement && node.matches('.dropdown-menu'));
    return menus.length === 1 && menus[0] !== undefined && hiddenMenu(menus[0]);
  }
  if (button.matches('button[data-testid="sidebar-reviewers-assign-button"]')) return button.getAttribute('aria-expanded') !== 'true';
  const wrapper = button.closest<HTMLElement>('.reviewers-dropdown.gl-new-dropdown');
  const toggle = button.closest('[data-testid="base-dropdown-toggle"]');
  if (wrapper === null || toggle === null || !wrapper.contains(toggle) || wrapper.closest('[data-testid="reviewers-block-container"]') !== block) return false;
  const menus = [...wrapper.querySelectorAll<HTMLElement>('[data-testid="base-dropdown-menu"]')].filter((menu) => menu.closest('.gl-new-dropdown') === wrapper);
  return menus.length === 1 && menus[0] !== undefined && hiddenMenu(menus[0]) && toggle.getAttribute('aria-expanded') !== 'true' && button.getAttribute('aria-expanded') !== 'true';
}

function control(doc: Document, scope: GitLabReviewerScope): HTMLButtonElement | null {
  if ([...doc.querySelectorAll<HTMLElement>(OVERLAYS)].some(openOverlay)) return null;
  const blocks = [...doc.querySelectorAll<HTMLElement>('aside[data-testid="issuable-sidebar"][data-issuable-type="merge_request"] [data-testid="reviewers-block-container"]')].filter(native);
  const block = blocks.length === 1 ? blocks[0] : undefined;
  if (block === undefined) return null;
  const pickers = [...block.querySelectorAll<HTMLButtonElement>('button[data-testid="reviewers-edit-button"], button.js-reviewer-search[data-toggle="dropdown"]')].filter(presented);
  const controls = pickers.length === 0 ? [...block.querySelectorAll<HTMLButtonElement>('button[data-testid="sidebar-reviewers-assign-button"]')].filter(presented) : pickers;
  const button = controls.length === 1 ? controls[0] : undefined;
  return button !== undefined && button.type === 'button' && !button.disabled && button.tabIndex >= 0 && !button.hasAttribute('readonly')
    && button.closest('[aria-disabled="true"], [aria-readonly="true"], fieldset[disabled]') === null && closed(button, block, scope) ? button : null;
}

export function readGitLabReviewerControls(doc: Document, scope: GitLabReviewerScope | null, visit: GitLabActionVisit, complete: boolean): ProviderReviewSourceAction {
  const root = complete && scope !== null ? scopeRoot(doc, scope, visit) : null;
  const button = root !== null && scope !== null ? control(doc, scope) : null;
  const parent = button?.parentElement;
  const block = button?.closest('[data-testid="reviewers-block-container"]');
  const sidebar = button?.closest('aside[data-testid="issuable-sidebar"]');
  const current = (): boolean => scope !== null && root !== null && button !== null && scopeRoot(doc, scope, visit) === root && control(doc, scope) === button
    && button.parentElement === parent && button.closest('[data-testid="reviewers-block-container"]') === block && button.closest('aside[data-testid="issuable-sidebar"]') === sidebar;
  return {
    kind: 'reviewer-controls', label: 'Reviewer controls', available: button !== null,
    ...(button === null ? { reason: 'GitLab’s native reviewer controls are unavailable.' } : {}),
    async activate(context) {
      if (context?.current?.() === false || !current() || button === null) return false;
      button.scrollIntoView({ block: 'center', behavior: 'auto' });
      if (context?.current?.() === false || !current()) return false;
      const rect = button.getBoundingClientRect();
      const hit = doc.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      if (hit === null || hit !== button && !button.contains(hit)) return false;
      button.focus({ preventScroll: true });
      return context?.current?.() !== false && current() && doc.activeElement === button;
    },
  };
}
