import type { MergeBox, MergeOffer, Stack, StackMember, StatusAction } from './merge-actions';
import { METHOD_LABEL } from './merge-actions';
import { createElement, OWN_UI_ATTRIBUTE, svgFromString } from './dom';
import { ICON_GIT_MERGE, ICON_GIT_MERGE_QUEUE, ICON_GIT_PULL_REQUEST, ICON_GIT_PULL_REQUEST_CLOSED, ICON_GIT_PULL_REQUEST_DRAFT, ICON_TRIANGLE_DOWN } from './ui/icons';

/**
 * The pull request's status pill in GitHub's header ("Open", "Draft",
 * "Merged", "Closed") as a menu of the statuses the reader may switch to.
 * GitHub's label is React's (or the classic page's) and is never touched
 * beyond being hidden: a button of Geld's, dressed in the label's own
 * classes and `data-status`/`data-size` (Primer's StateLabel keys its look on
 * them), stands right after it, its caret in its glyph's place while hovered.
 * Both the header's pill and the sticky header's are swapped.
 */

/** `queued` is only ever a choice (GitHub's "Merge when ready"), never what `statusOf` reads. */
export type PullStatus = 'open' | 'draft' | 'queued' | 'merged' | 'closed';

export interface StatusOption {
  readonly status: PullStatus;
  readonly action: StatusAction;
  /** A merge past the rules (GitHub's bypass checkbox), which its merge box opens with the checkbox to tick. */
  readonly bypass?: boolean;
  /** GitHub's words for the action, the menu item's label. */
  readonly note: string;
}

export const STATUS_INFO: { readonly [S in PullStatus]: { readonly label: string; readonly icon: string } } = {
  open: { label: 'Open', icon: ICON_GIT_PULL_REQUEST },
  draft: { label: 'Draft', icon: ICON_GIT_PULL_REQUEST_DRAFT },
  queued: { label: 'Queued', icon: ICON_GIT_MERGE_QUEUE },
  merged: { label: 'Merged', icon: ICON_GIT_MERGE },
  closed: { label: 'Closed', icon: ICON_GIT_PULL_REQUEST_CLOSED },
};

/** Forward first: ready for review or reopened, then merged, then back to a draft, and closed always last. */
const STATUS_ORDER: readonly PullStatus[] = ['open', 'queued', 'merged', 'draft', 'closed'];

export function statusOf(box: MergeBox): PullStatus | null {
  if (box.state === 'MERGED') return 'merged';
  if (box.state === 'CLOSED') return 'closed';
  if (box.state === 'OPEN') return box.draft ? 'draft' : 'open';
  return null;
}

/**
 * The menu: each status the reader may switch the pull request to, in
 * `STATUS_ORDER`. A draft can be marked ready or
 * closed, not merged; an open one turned into a draft, merged (when GitHub
 * would take it, or only past the rules for an admin) or closed; a closed
 * one reopened (GitHub gives no reopen permission of its own: whoever may
 * close may reopen). Pull requests have one way to close: the close reasons
 * ("not planned", "duplicate") are issues'. Empty when there is nothing to
 * switch to, a merged pull request always.
 */
export function statusOptions(box: MergeBox, offer: MergeOffer, bypass = false): readonly StatusOption[] {
  const current = statusOf(box);
  if (current === null || current === 'merged') return [];
  const method = box.methods[0] ?? 'SQUASH';
  const moves: { [S in PullStatus]?: StatusOption } = {};
  // A bypass beside the queue or auto-merge: a second way forward, merging now past the rules, right after it.
  const beside: StatusOption | null = current === 'open' && bypass ? { status: 'merged', action: 'merge', note: 'Bypass rules and merge', bypass: true } : null;
  if (current === 'draft' && box.canMarkReady) moves.open = { status: 'open', action: 'ready', note: 'Ready for review' };
  if (current === 'closed' && box.canClose) moves.open = { status: 'open', action: 'reopen', note: 'Reopen pull request' };
  if (current === 'open' && box.canConvertToDraft) moves.draft = { status: 'draft', action: 'draft', note: 'Convert to draft' };
  if (current === 'open' && offer === 'queue') moves.queued = { status: 'queued', action: 'queue', note: 'Merge when ready' };
  else if (current === 'open' && offer === 'auto') moves.merged = { status: 'merged', action: 'auto', note: 'Enable auto-merge' };
  else if (current === 'open' && offer === 'bypass') moves.merged = { status: 'merged', action: 'merge', note: 'Bypass rules and merge', bypass: true };
  else if (current === 'open' && offer !== null) moves.merged = { status: 'merged', action: 'merge', note: METHOD_LABEL[method] };
  if (current !== 'closed' && box.canClose) moves.closed = { status: 'closed', action: 'close', note: 'Close pull request' };
  return STATUS_ORDER.flatMap((status) => [...(moves[status] === undefined ? [] : [moves[status]]), ...(beside !== null && status === 'merged' ? [beside] : [])]);
}

/** What a stack's menu does: a merge or a place in the queue through GitHub's stack request, or one change per pull request. */
export type StackAction = 'merge' | 'queue' | 'ready' | 'draft' | 'close' | 'reopen';

/** This pull request alone, it and every one below it (what GitHub's own stack merge takes), or the whole stack. */
export type StackScope = 'this' | 'below' | 'stack';

export interface StackChoice {
  readonly scope: StackScope;
  readonly label: string;
  /** Top first: every pull request the choice changes. */
  readonly targets: readonly StackMember[];
  /** Whose `enqueue_stack` a merge or a place in the queue goes through: the top of `targets`, which takes the rest. */
  readonly via: StackMember;
}

export interface StackGroup {
  readonly status: PullStatus;
  readonly action: StackAction;
  /** GitHub's words for the action, the parent item's label. */
  readonly note: string;
  readonly choices: readonly StackChoice[];
}

const STACK_CAN: { readonly [A in StackAction]: (box: MergeBox) => boolean } = {
  merge: (box) => box.open && !box.draft && box.methods.length > 0 && box.mergeable,
  queue: (box) => box.canQueue,
  ready: (box) => box.open && box.draft && box.canMarkReady,
  draft: (box) => box.open && !box.draft && box.canConvertToDraft,
  close: (box) => box.open && box.canClose,
  reopen: (box) => box.state === 'CLOSED' && box.canClose,
};

const STACK_STATUS: { readonly [A in StackAction]: PullStatus } = { ready: 'open', reopen: 'open', queue: 'queued', merge: 'merged', draft: 'draft', close: 'closed' };

/**
 * A stack's menu, by type, each with the choices every pull request they take allows: this pull request (a merge only
 * at the foot of the stack, since GitHub merges a stacked pull request with every one below it), this and every one
 * below, and the entire stack (whoever is reading it, merging through its top), each only when it differs from the one
 * before. A merge goes as GitHub's merge box would: through the queue where the repository has one, else directly;
 * auto-merge and the bypass are left to a stack of one. Null for a stack of one, whose menu is `statusOptions`'.
 */
export function stackGroups(stack: Stack, method: MergeBox['methods'][number]): readonly StackGroup[] | null {
  const { members, boxes } = stack;
  const at = members.findIndex((member) => member.current);
  const current = members[at];
  const top = members[0];
  if (members.length < 2 || current === undefined || top === undefined) return null;
  const all = (action: StackAction, of: readonly StackMember[]): boolean =>
    of.every((member) => {
      const box = boxes.get(member.number);
      return box !== undefined && STACK_CAN[action](box);
    });
  const below = members.slice(at);
  const scopes: readonly { readonly scope: StackScope; readonly targets: readonly StackMember[] }[] = [
    { scope: 'this', targets: [current] },
    // From the top, this and every one below is the entire stack, and says so.
    ...(at > 0 && below.length > 1 ? [{ scope: 'below' as const, targets: below }] : []),
    { scope: 'stack', targets: members },
  ];
  const label = (scope: StackScope): string => (scope === 'this' ? 'This pull request' : scope === 'below' ? `This and ${below.length - 1} below` : `Entire stack (${members.length})`);
  const merging: StackAction = boxes.get(current.number)?.canQueue === true ? 'queue' : 'merge';
  const actions: readonly StackAction[] = ['ready', 'reopen', merging, 'draft', 'close'];
  const notes: { readonly [A in StackAction]: string } = { ready: 'Ready for review', reopen: 'Reopen', queue: 'Merge when ready', merge: METHOD_LABEL[method], draft: 'Convert to draft', close: 'Close' };
  const groups = actions.flatMap((action): StackGroup[] => {
    const choices = scopes
      // GitHub merges a stacked pull request with every one below it: alone only at the foot.
      .filter(({ scope }) => !((action === 'merge' || action === 'queue') && scope === 'this' && below.length > 1))
      .filter(({ targets }) => all(action, targets))
      .map(({ scope, targets }) => ({ scope, label: label(scope), targets, via: targets[0] ?? current }));
    return choices.length === 0 ? [] : [{ status: STACK_STATUS[action], action, note: notes[action], choices }];
  });
  return STATUS_ORDER.flatMap((status) => groups.filter((group) => group.status === status));
}

/** The browser's confirmation before a choice that changes more than one pull request, naming every one. */
export function stackConfirmWords(action: StackAction, choice: StackChoice): string {
  const numbers = choice.targets.map((member) => `#${member.number}`);
  const list = numbers.length > 1 ? `${numbers.slice(0, -1).join(', ')} and ${numbers[numbers.length - 1] ?? ''}` : (numbers[0] ?? '');
  const count = choice.scope === 'stack' ? `the entire stack of ${choice.targets.length} pull requests` : `${choice.targets.length} pull requests`;
  const verb: { readonly [A in StackAction]: string } = {
    merge: `Merge ${count}`,
    queue: `Add ${count} to the merge queue`,
    ready: `Mark ${count} ready for review`,
    draft: `Convert ${count} to drafts`,
    close: `Close ${count}`,
    reopen: `Reopen ${count}`,
  };
  return `${verb[action]} (${list})?`;
}

const GITHUB_PILLS = '[data-component="PageHeader"] [data-component="StateLabel"], .gh-header-meta .State, .gh-header-sticky .State';
const ATTR_HIDDEN = 'data-geld-status-hidden';
const ATTR_PILL = 'data-geld-status-pill';

/** The words a pill was last dressed from, so a pass rewrites it only when GitHub's label changed. */
const dressedFrom = new WeakMap<HTMLElement, string>();

function labelKey(label: Element): string {
  return [label.className, label.getAttribute('data-status'), label.getAttribute('data-size'), label.getAttribute('title'), label.textContent].join('|');
}

function dress(pill: HTMLButtonElement, label: Element): void {
  const key = labelKey(label);
  if (dressedFrom.get(pill) === key) return;
  dressedFrom.set(pill, key);
  pill.className = `${label.className} geld-status-pill`;
  for (const name of ['data-status', 'data-size', 'title']) {
    const value = label.getAttribute(name);
    if (value === null) pill.removeAttribute(name);
    else pill.setAttribute(name, value);
  }
  const glyph = label.querySelector('svg');
  pill.replaceChildren(
    // The caret takes the status glyph's place while the pill is hovered, focused or open, so the pill never widens.
    createElement('span', { class: 'geld-status-pill__lead' }, [
      ...(glyph === null ? [] : [glyph.cloneNode(true)]),
      createElement('span', { class: 'geld-status-pill__caret', 'aria-hidden': 'true' }, [svgFromString(ICON_TRIANGLE_DOWN)]),
    ]),
    createElement('span', { class: 'geld-status-pill__label' }, [(label.textContent ?? '').trim()]),
    // The 1-click merge's face, laid over the pill while the instant key is held, so the pill keeps its width.
    createElement('span', { class: 'geld-status-pill__merge', 'aria-hidden': 'true' }, [svgFromString(ICON_GIT_MERGE), 'Merge']),
  );
}

export const ATTR_INSTANT_MERGE = 'data-geld-instant-merge';

/**
 * The pills as GitHub draws a merged pull request's, the moment a merge went
 * through (the page reloads to GitHub's own after): each dressed from a copy
 * of GitHub's label turned merged, so it is built exactly as the pill dressed
 * from GitHub's own merged label will be and the reload moves nothing.
 * Primer's StateLabel keys its look on `data-status`, the classic label on its
 * `State--merged` class. The pill stays keyed to GitHub's label as it stands,
 * so a pass before the reload does not dress it back.
 */
export function showMergedPills(pills: readonly HTMLButtonElement[]): void {
  for (const pill of pills) {
    pill.removeAttribute(ATTR_INSTANT_MERGE);
    // The held key's "Merge now: …", which would otherwise outlast the merge as the pill's name.
    pill.removeAttribute('aria-label');
    pill.removeAttribute('aria-haspopup');
    pill.removeAttribute('aria-expanded');
    const label = pill.previousElementSibling;
    if (label === null) continue;
    dress(pill, mergedCopy(label));
    dressedFrom.set(pill, labelKey(label));
  }
}

function mergedCopy(label: Element): Element {
  const copy = label.cloneNode(true);
  if (!(copy instanceof Element)) return label;
  if (copy.hasAttribute('data-status')) copy.setAttribute('data-status', 'pullMerged');
  for (const token of [...copy.classList]) if (/^State--(?:open|draft|closed)$/.test(token)) copy.classList.replace(token, 'State--merged');
  if (copy.hasAttribute('title')) copy.setAttribute('title', 'Status: Merged');
  const glyph = copy.querySelector('svg');
  if (glyph !== null) {
    // GitHub's own glyph element, sized and classed as it is, drawing the merge octicon.
    glyph.replaceChildren(...svgFromString(ICON_GIT_MERGE).childNodes);
    glyph.setAttribute('class', (glyph.getAttribute('class') ?? 'octicon').replace(/\bocticon-[\w-]+/, 'octicon-git-merge'));
  }
  for (const node of [...copy.childNodes]) if (node.nodeType === Node.TEXT_NODE) node.remove();
  const words = [...copy.querySelectorAll('*')].find((element) => element.children.length === 0 && !(element instanceof SVGElement) && (element.textContent ?? '').trim() !== '');
  if (words === undefined) copy.append('Merged');
  else words.textContent = 'Merged';
  return copy;
}

/**
 * Put Geld's pill in place of each of GitHub's header pills (or put GitHub's
 * back, with `on` false), and return Geld's. `onOpen` runs on a click with
 * the pill clicked.
 */
export function syncStatusPills(on: boolean, onOpen: (pill: HTMLButtonElement, click: MouseEvent) => void): readonly HTMLButtonElement[] {
  const pills: HTMLButtonElement[] = [];
  for (const label of document.querySelectorAll<HTMLElement>(GITHUB_PILLS)) {
    if (label.closest(`[${OWN_UI_ATTRIBUTE}]`) !== null) continue;
    const next = label.nextElementSibling;
    const existing = next instanceof HTMLButtonElement && next.hasAttribute(ATTR_PILL) ? next : null;
    if (!on) {
      existing?.remove();
      label.removeAttribute(ATTR_HIDDEN);
      continue;
    }
    const pill = existing ?? createPill(onOpen);
    dress(pill, label);
    if (existing === null) label.after(pill);
    if (!label.hasAttribute(ATTR_HIDDEN)) label.setAttribute(ATTR_HIDDEN, '');
    pills.push(pill);
  }
  return pills;
}

function createPill(onOpen: (pill: HTMLButtonElement, click: MouseEvent) => void): HTMLButtonElement {
  const pill = createElement('button', { type: 'button', [ATTR_PILL]: '', [OWN_UI_ATTRIBUTE]: '', 'aria-haspopup': 'menu', 'aria-expanded': 'false' });
  pill.addEventListener('click', (click) => onOpen(pill, click));
  return pill;
}

export function removeStatusPills(): void {
  syncStatusPills(false, () => undefined);
}

/**
 * Whether the reader could change the status the last time a pull request of
 * this repository was read, so the pill is swapped from the first paint
 * (swapping only once the merge box answered showed GitHub's label first).
 * In the page's own storage, as the whitespace redirect's
 * guard is: it must be read synchronously, before paint.
 */
const HINT_KEY = 'geld:status-menu';
const HINT_CAP = 200;

let hintMemo: Record<string, boolean> | null = null;

function readHints(): Record<string, boolean> {
  if (hintMemo !== null) return hintMemo;
  hintMemo = readStoredHints();
  return hintMemo;
}

function readStoredHints(): Record<string, boolean> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(HINT_KEY) ?? '{}');
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, boolean> = {};
    for (const [repo, value] of Object.entries(parsed)) if (typeof value === 'boolean') out[repo] = value;
    return out;
  } catch {
    return {};
  }
}

/** Forget the hints read into memory (tests, and nothing else, need to). */
export function resetStatusHints(): void {
  hintMemo = null;
}

export function statusHint(repo: string): boolean | null {
  return readHints()[repo] ?? null;
}

export function rememberStatusHint(repo: string, can: boolean): void {
  if (readHints()[repo] === can) return;
  // Read afresh: another tab may have written since this page first read the hints.
  const hints = readStoredHints();
  delete hints[repo];
  hints[repo] = can;
  hintMemo = hints;
  const entries = Object.entries(hints);
  try {
    window.localStorage.setItem(HINT_KEY, JSON.stringify(Object.fromEntries(entries.slice(Math.max(0, entries.length - HINT_CAP)))));
  } catch {
    // Storage full or blocked: the pill then waits for the merge box, as on a first visit.
  }
}
