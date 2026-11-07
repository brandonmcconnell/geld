import { createElement, OWN_UI_ATTRIBUTE, svgFromString } from './dom';
import type { MergeActions, MergeMethod } from './merge-actions';
import { stackGroups } from './status-pill';
import { ICON_CHECK, ICON_INFO, ICON_TRIANGLE_DOWN } from './ui/icons';

/** The merge GitHub would take now, offered in the Overview's recommended action: a plain merge, or an admin's past the rules. */
export interface OverviewMerge {
  readonly kind: 'merge' | 'bypass';
  /** GitHub's default first. */
  readonly methods: readonly MergeMethod[];
}

/**
 * What the Overview's recommended action may offer beside "View merge status": GitHub's own control there merges a pull
 * request in no stack and leaves a stacked one with "View merge status" alone, whatever its state (its `isStacked`
 * check, read from its bundle in Nov 2026), so a stacked pull request ready to merge showed no merge at all. A stacked
 * one is offered what GitHub's sidebar merges, it and every pull request below it, only when each of those could merge;
 * the bypass is left to a pull request in no stack, as the status menu leaves it.
 */
export function overviewMergeOf(actions: MergeActions | null): OverviewMerge | null {
  if (actions === null) return null;
  const { box, offer } = actions;
  if (offer === 'merge') {
    if (box.methods.length === 0) return null;
    if (box.stacked) {
      if (actions.stack === null) return null;
      const merge = stackGroups(actions.stack, box.methods[0] ?? 'SQUASH')?.find((group) => group.action === 'merge');
      if (merge?.choices.some((choice) => choice.via.current) !== true) return null;
    }
    return { kind: 'merge', methods: box.methods };
  }
  if (offer === 'bypass' && !box.stacked) {
    const methods = actions.bypassMethods.length > 0 ? actions.bypassMethods : box.methods;
    return methods.length === 0 ? null : { kind: 'bypass', methods };
  }
  return null;
}

/** The button's words for each method: GitHub's merge button calls a merge commit's "Merge pull request". */
export const METHOD_BUTTON: { readonly [M in MergeMethod]: string } = { MERGE: 'Merge pull request', SQUASH: 'Squash and merge', REBASE: 'Rebase and merge' };

const METHOD_ITEM: { readonly [M in MergeMethod]: { readonly name: string; readonly note: string } } = {
  MERGE: { name: 'Create a merge commit', note: 'All commits from this branch will be added to the base branch via a merge commit.' },
  SQUASH: { name: 'Squash and merge', note: 'The commits from this branch will be combined into one commit in the base branch.' },
  REBASE: { name: 'Rebase and merge', note: 'The commits from this branch will be rebased and added to the base branch.' },
};

const SECTION = 'section[aria-label="Recommended action"]';
const VIEW_STATUS = 'View merge status';
const ATTR_INFO = 'data-geld-merge-info';
const ATTR_MERGE = 'data-geld-overview-merge';
const INFO_CLASS = 'geld-overview-merge__info';

export interface OverviewMergeHandlers {
  readonly onMerge: (method: MergeMethod, anchor: HTMLElement) => void;
  readonly onMethod: (method: MergeMethod) => void;
}

function viewStatusButtons(section: Element): HTMLButtonElement[] {
  return [...section.querySelectorAll<HTMLButtonElement>('button')].filter((button) => !button.closest(`[${ATTR_MERGE}]`) && (button.getAttribute(ATTR_INFO) !== null || button.textContent?.trim() === VIEW_STATUS));
}

/**
 * GitHub's "View merge status" as an icon: its label is hidden by the stylesheet and the info mark put before it, its
 * words its name and tooltip. The button stays GitHub's, so its click still opens the merge status sidebar.
 */
function iconify(button: HTMLButtonElement): void {
  if (button.hasAttribute(ATTR_INFO)) return;
  button.setAttribute(ATTR_INFO, '');
  button.setAttribute('aria-label', VIEW_STATUS);
  button.id ||= `geld-merge-info-${(infoIds += 1)}`;
  button.prepend(createElement('span', { class: INFO_CLASS, [OWN_UI_ATTRIBUTE]: '', 'aria-hidden': 'true' }, [svgFromString(ICON_INFO)]));
  if (document.querySelector('tool-tip') === null) {
    button.title = VIEW_STATUS;
    return;
  }
  const tip = document.createElement('tool-tip');
  for (const [name, value] of Object.entries({ for: button.id, popover: 'manual', 'data-direction': 's', 'data-type': 'label', class: 'sr-only position-absolute', [OWN_UI_ATTRIBUTE]: '' })) tip.setAttribute(name, value);
  tip.textContent = VIEW_STATUS;
  button.after(tip);
}

function restore(button: HTMLButtonElement): void {
  button.removeAttribute(ATTR_INFO);
  button.removeAttribute('aria-label');
  if (button.id.startsWith('geld-merge-info-')) button.removeAttribute('id');
  if (button.title === VIEW_STATUS) button.removeAttribute('title');
  button.querySelector(`:scope > .${INFO_CLASS}`)?.remove();
  const tip = button.nextElementSibling;
  if (tip?.localName === 'tool-tip' && tip.hasAttribute(OWN_UI_ATTRIBUTE)) tip.remove();
}

let infoIds = 0;
let menu: { readonly element: HTMLElement; readonly keys: AbortController } | null = null;

/** A control of GitHub's own that merges, which a pull request in no stack gets there: Geld's would be a second one. */
function githubMergeIn(row: Element): boolean {
  return [...row.querySelectorAll('button')].some((button) => !button.closest(`[${OWN_UI_ATTRIBUTE}]`) && /\bmerge\b/i.test(button.textContent ?? '') && button.textContent?.trim() !== VIEW_STATUS);
}

/**
 * The Overview's recommended action, each pass and before paint (GitHub re-renders the row): "View merge status" as an
 * info button, and beside it, while GitHub would merge and shows no merge of its own there, a split button merging
 * with `method` (GitHub's default until the reader picks another from its caret).
 */
export function syncOverviewMerge(merge: OverviewMerge | null, method: MergeMethod, handlers: OverviewMergeHandlers): void {
  const section = document.querySelector(SECTION);
  const buttons = section === null ? [] : viewStatusButtons(section);
  for (const button of buttons) iconify(button);
  const anchor = buttons[0] ?? null;
  const row = anchor?.closest('[data-testid="for-you-item-row"]') ?? null;
  const existing = document.querySelector<HTMLElement>(`[${ATTR_MERGE}]`);
  const chosen = merge?.methods.includes(method) === true ? method : (merge?.methods[0] ?? method);
  if (merge === null || anchor === null || row === null || githubMergeIn(row)) {
    existing?.remove();
    if (existing !== null) closeMethodMenu();
    return;
  }
  const signature = `${merge.kind}:${chosen}:${merge.methods.join(',')}`;
  if (existing !== null && existing.getAttribute(ATTR_MERGE) === signature && existing.previousElementSibling === (anchor.nextElementSibling?.localName === 'tool-tip' ? anchor.nextElementSibling : anchor)) return;
  existing?.remove();
  const control = createControl(merge, chosen, handlers, signature);
  (anchor.nextElementSibling?.localName === 'tool-tip' ? anchor.nextElementSibling : anchor).after(control);
}

function createControl(merge: OverviewMerge, method: MergeMethod, handlers: OverviewMergeHandlers, signature: string): HTMLElement {
  const variant = merge.kind === 'bypass' ? 'geld-overview-merge__button--danger' : 'btn-primary';
  const label = merge.kind === 'bypass' ? 'Bypass rules and merge' : METHOD_BUTTON[method];
  const main = createElement('button', { type: 'button', class: `btn btn-sm ${variant} BtnGroup-item geld-overview-merge__main` }, [label]);
  main.addEventListener('click', () => handlers.onMerge(method, control));
  const control = createElement('div', { class: 'BtnGroup geld-overview-merge', [OWN_UI_ATTRIBUTE]: '', [ATTR_MERGE]: signature }, [main]);
  if (merge.methods.length > 1) {
    const caret = createElement('button', { type: 'button', class: `btn btn-sm ${variant} BtnGroup-item geld-overview-merge__caret`, 'aria-label': 'Select merge method', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, [svgFromString(ICON_TRIANGLE_DOWN)]);
    caret.addEventListener('click', () => {
      if (menu !== null) closeMethodMenu();
      else openMethodMenu(caret, merge.methods, method, handlers.onMethod);
    });
    control.append(caret);
  }
  return control;
}

function openMethodMenu(caret: HTMLButtonElement, methods: readonly MergeMethod[], current: MergeMethod, onMethod: (method: MergeMethod) => void): void {
  const element = createElement('div', { class: 'geld-quick-review__menu geld-overview-merge__menu', [OWN_UI_ATTRIBUTE]: '', role: 'menu', 'aria-label': 'Merge method', tabindex: '-1' });
  const items = methods.map((name) => {
    const item = createElement('button', { type: 'button', class: 'geld-quick-review__menu-item', role: 'menuitemradio', 'aria-checked': String(name === current) }, [
      createElement('span', { class: 'geld-quick-review__menu-check', 'aria-hidden': 'true' }, [svgFromString(ICON_CHECK)]),
      createElement('span', { class: 'geld-quick-review__menu-text' }, [
        createElement('span', { class: 'geld-quick-review__menu-label' }, [METHOD_ITEM[name].name]),
        createElement('span', { class: 'geld-quick-review__menu-note' }, [METHOD_ITEM[name].note]),
      ]),
    ]);
    item.addEventListener('click', () => {
      closeMethodMenu();
      onMethod(name);
      document.querySelector<HTMLButtonElement>(`[${ATTR_MERGE}] .geld-overview-merge__main`)?.focus({ preventScroll: true });
    });
    return item;
  });
  element.append(...items);
  const keys = new AbortController();
  menu = { element, keys };
  caret.setAttribute('aria-expanded', 'true');
  document.body.append(element);
  const place = (): void => {
    if (!caret.isConnected) {
      closeMethodMenu();
      return;
    }
    const rect = caret.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.right - element.offsetWidth, document.documentElement.clientWidth - element.offsetWidth - 8));
    element.style.left = `${Math.round(left)}px`;
    element.style.top = `${Math.round(rect.bottom + 4)}px`;
  };
  place();
  (items.find((item) => item.getAttribute('aria-checked') === 'true') ?? items[0])?.focus({ preventScroll: true });
  element.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMethodMenu();
        caret.focus({ preventScroll: true });
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const at = items.findIndex((item) => item === document.activeElement);
        items[(at + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus({ preventScroll: true });
      }
    },
    { signal: keys.signal },
  );
  document.addEventListener(
    'pointerdown',
    (event) => {
      const target = event.target;
      if (target instanceof Node && (element.contains(target) || caret.contains(target))) return;
      closeMethodMenu();
    },
    { capture: true, signal: keys.signal },
  );
  element.addEventListener(
    'focusout',
    (event) => {
      const next = event.relatedTarget;
      if (next instanceof Node && (element.contains(next) || caret.contains(next))) return;
      closeMethodMenu();
    },
    { signal: keys.signal },
  );
  window.addEventListener('scroll', place, { passive: true, signal: keys.signal });
  window.addEventListener('resize', place, { signal: keys.signal });
}

function closeMethodMenu(): void {
  if (menu === null) return;
  menu.keys.abort();
  menu.element.remove();
  menu = null;
  for (const caret of document.querySelectorAll('.geld-overview-merge__caret')) caret.setAttribute('aria-expanded', 'false');
}

export function removeOverviewMerge(): void {
  closeMethodMenu();
  for (const control of document.querySelectorAll(`[${ATTR_MERGE}]`)) control.remove();
  for (const button of document.querySelectorAll<HTMLButtonElement>(`button[${ATTR_INFO}]`)) restore(button);
}
