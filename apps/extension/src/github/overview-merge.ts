import { createElement, OWN_UI_ATTRIBUTE, svgFromString } from './dom';
import type { MergeActions, MergeMethod } from './merge-actions';
import { subtreeSettled } from './react-hydration';
import { stackGroups } from './status-pill';
import { ICON_CHECK, ICON_INFO, ICON_TRIANGLE_DOWN } from './ui/icons';

/**
 * The way forward the status menu offers, put in the Overview's recommended action: a merge, an admin's past the
 * rules, a place in the merge queue or auto-merge.
 */
export interface OverviewMerge {
  readonly kind: 'merge' | 'bypass' | 'queue' | 'auto';
  /** GitHub's default first; none for the queue and auto-merge, which merge with GitHub's default. */
  readonly methods: readonly MergeMethod[];
}

/**
 * What the Overview's recommended action may offer beside "View merge status": whatever the status menu offers to
 * merge, so the button is there whenever the pill's menu could merge. GitHub's own control there merges a pull request
 * in no stack and leaves a stacked one with "View merge status" alone, whatever its state (its `isStacked` check, read
 * from its bundle in Nov 2026), even once every pull request below it has merged (geld#678). A stack of two or more open
 * is offered what its menu merges through this pull request, it and every one below it, only when each of those could;
 * a stack of one, as the flat menu, anything it would offer a pull request in no stack.
 */
export function overviewMergeOf(actions: MergeActions | null): OverviewMerge | null {
  if (actions === null) return null;
  const { box, offer } = actions;
  const groups = actions.stack === null ? null : stackGroups(actions.stack, box.methods[0] ?? 'SQUASH');
  if (groups !== null) {
    const through = groups.find((group) => (group.action === 'merge' || group.action === 'queue') && group.choices.some((choice) => choice.via.current));
    if (through?.action === 'queue') return { kind: 'queue', methods: [] };
    return through === undefined || box.methods.length === 0 ? null : { kind: 'merge', methods: box.methods };
  }
  // Its merge would go through `enqueue_stack`, which takes every pull request below it, and only the stack names them.
  if (box.stacked && actions.stack === null) return null;
  if (offer === 'merge') return box.methods.length === 0 ? null : { kind: 'merge', methods: box.methods };
  if (offer === 'bypass') {
    const methods = actions.bypassMethods.length > 0 ? actions.bypassMethods : box.methods;
    return methods.length === 0 ? null : { kind: 'bypass', methods };
  }
  if (offer === 'queue' || offer === 'auto') return { kind: offer, methods: [] };
  return null;
}

const KIND_BUTTON: { readonly [K in Exclude<OverviewMerge['kind'], 'merge'>]: string } = { bypass: 'Bypass rules and merge', queue: 'Merge when ready', auto: 'Enable auto-merge' };

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
/** On a merge button of GitHub's own that Geld turned green: the variant GitHub gave it, put back on teardown. */
const ATTR_VARIANT = 'data-geld-merge-variant';

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

/** GitHub's own merge controls in the section (the merge and its method caret), which a pull request in no stack gets there. */
function githubMergeButtons(scope: Element): HTMLButtonElement[] {
  return [...scope.querySelectorAll<HTMLButtonElement>('button')].filter((button) => {
    if (button.closest(`[${OWN_UI_ATTRIBUTE}]`) !== null || button.hasAttribute(ATTR_INFO)) return false;
    const label = button.getAttribute('aria-labelledby');
    const words = `${button.textContent ?? ''} ${label === null ? '' : (document.getElementById(label)?.textContent ?? '')}`;
    return /\bmerge\b/i.test(words) && button.textContent?.trim() !== VIEW_STATUS;
  });
}

/**
 * GitHub draws its merge grey (Primer's default variant) where it wants a second thought (non-required checks failing,
 * checks running) and green where all is clear: readers look for the green one, so it is always green. React set the
 * variant and changes it only when its own prop does, so the attribute holds; what GitHub gave it is put back on teardown.
 */
function greenMerges(scope: Element): void {
  for (const button of githubMergeButtons(scope)) {
    const original = button.getAttribute(ATTR_VARIANT);
    // A merge GitHub disables (a required check still running) stays grey, as GitHub draws it: green would offer it.
    if (isDisabled(button)) {
      if (original !== null) {
        button.setAttribute('data-variant', original);
        button.removeAttribute(ATTR_VARIANT);
      }
      continue;
    }
    const variant = button.getAttribute('data-variant');
    if (variant === null || variant === 'primary') continue;
    if (original === null) button.setAttribute(ATTR_VARIANT, variant);
    button.setAttribute('data-variant', 'primary');
  }
}

/**
 * GitHub disables or enables its merge in place, by an attribute the controller's observer does not hear: the section
 * is watched for those itself, so the colour follows at once. Only `data-variant` is written back, which it does not watch.
 */
let disabledWatch: { readonly section: Element; readonly observer: MutationObserver } | null = null;

function watchDisabled(section: Element): void {
  if (disabledWatch?.section === section) return;
  disabledWatch?.observer.disconnect();
  const observer = new MutationObserver(() => greenMerges(section));
  observer.observe(section, { subtree: true, attributes: true, attributeFilter: ['disabled', 'aria-disabled', 'data-inactive'] });
  disabledWatch = { section, observer };
}

/**
 * GitHub's merge in the recommended action turned green, before paint and before Geld's controls have mounted: drawn
 * grey first, it changed colour under the reader a moment later. Only `data-variant` is written, which React's
 * hydration leaves as it finds it, so this need not wait for the section to hydrate as the nodes Geld adds there do.
 */
export function greenOverviewMerges(): Element | null {
  const section = document.querySelector(SECTION);
  if (section === null) return null;
  greenMerges(section);
  watchDisabled(section);
  return section;
}

function isDisabled(button: HTMLButtonElement): boolean {
  return button.disabled || button.getAttribute('aria-disabled') === 'true' || button.getAttribute('data-inactive') === 'true';
}

/**
 * The Overview's recommended action, each pass and before paint (GitHub re-renders the row): "View merge status" as an
 * info button, and beside it, while GitHub would merge and shows no merge of its own there, a split button merging
 * with `method` (GitHub's default until the reader picks another from its caret). While a request is out (`busy`) it
 * stays where it is, inert, so a box its answer opens still has it to hang from and nothing is sent twice.
 */
export function syncOverviewMerge(merge: OverviewMerge | null, method: MergeMethod, handlers: OverviewMergeHandlers, busy = false): void {
  const section = greenOverviewMerges();
  // Its buttons and Geld's beside them are React's nodes, not to be touched before React has hydrated them (`react-hydration.ts`).
  if (section !== null && !subtreeSettled(section)) return;
  const buttons = section === null ? [] : viewStatusButtons(section);
  for (const button of buttons) iconify(button);
  const anchor = buttons[0] ?? null;
  const row = anchor?.closest('[data-testid="for-you-item-row"]') ?? null;
  const existing = document.querySelector<HTMLElement>(`[${ATTR_MERGE}]`);
  const chosen = merge?.methods.includes(method) === true ? method : (merge?.methods[0] ?? method);
  if (merge === null || anchor === null || row === null || githubMergeButtons(row).length > 0) {
    existing?.remove();
    if (existing !== null) closeMethodMenu();
    return;
  }
  const signature = `${merge.kind}:${chosen}:${merge.methods.join(',')}`;
  if (existing !== null && existing.getAttribute(ATTR_MERGE) === signature && existing.previousElementSibling === (anchor.nextElementSibling?.localName === 'tool-tip' ? anchor.nextElementSibling : anchor)) {
    setOverviewMergeBusy(busy);
    return;
  }
  existing?.remove();
  const control = createControl(merge, chosen, handlers, signature);
  (anchor.nextElementSibling?.localName === 'tool-tip' ? anchor.nextElementSibling : anchor).after(control);
  setOverviewMergeBusy(busy);
}

/** The Overview's merge inert while a request is out, in place: `aria-disabled` keeps the focus a `disabled` would drop. */
export function setOverviewMergeBusy(busy: boolean): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>(`[${ATTR_MERGE}] button`)) {
    if (busy) button.setAttribute('aria-disabled', 'true');
    else button.removeAttribute('aria-disabled');
  }
  if (busy) closeMethodMenu();
}

/** The Overview's merge control now: the one a box was opened from, or the one a re-render of GitHub's row put in its place. */
export function liveOverviewMerge(control: HTMLElement | null): HTMLElement | null {
  if (control === null || control.isConnected) return control;
  return document.querySelector<HTMLElement>(`[${ATTR_MERGE}]`);
}

const isInert = (button: HTMLElement): boolean => button.getAttribute('aria-disabled') === 'true';

function createControl(merge: OverviewMerge, method: MergeMethod, handlers: OverviewMergeHandlers, signature: string): HTMLElement {
  const variant = merge.kind === 'bypass' ? 'geld-overview-merge__button--danger' : 'btn-primary';
  const label = merge.kind === 'merge' ? METHOD_BUTTON[method] : KIND_BUTTON[merge.kind];
  const main = createElement('button', { type: 'button', class: `btn btn-sm ${variant} BtnGroup-item geld-overview-merge__main` }, [label]);
  main.addEventListener('click', () => {
    if (!isInert(main)) handlers.onMerge(method, control);
  });
  const control = createElement('div', { class: 'BtnGroup geld-overview-merge', [OWN_UI_ATTRIBUTE]: '', [ATTR_MERGE]: signature }, [main]);
  if (merge.methods.length > 1) {
    const caret = createElement('button', { type: 'button', class: `btn btn-sm ${variant} BtnGroup-item geld-overview-merge__caret`, 'aria-label': 'Select merge method', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, [svgFromString(ICON_TRIANGLE_DOWN)]);
    caret.addEventListener('click', () => {
      if (isInert(caret)) return;
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
  disabledWatch?.observer.disconnect();
  disabledWatch = null;
  closeMethodMenu();
  for (const control of document.querySelectorAll(`[${ATTR_MERGE}]`)) control.remove();
  for (const button of document.querySelectorAll<HTMLButtonElement>(`button[${ATTR_INFO}]`)) restore(button);
  for (const button of document.querySelectorAll<HTMLButtonElement>(`button[${ATTR_VARIANT}]`)) {
    button.setAttribute('data-variant', button.getAttribute(ATTR_VARIANT) ?? 'default');
    button.removeAttribute(ATTR_VARIANT);
  }
}
