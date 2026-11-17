import type { DiffLine, DiffRow } from '@geld/review';
import { createElement, svgFromString } from '../github/dom';
import { ICON_ALERT, ICON_CHECK, ICON_CHECK_CIRCLE_FILL, ICON_CHEVRON_DOWN, ICON_CHEVRON_RIGHT, ICON_COPY, ICON_FILE_DIFF, ICON_SPARKLE_FILL, ICON_TRIANGLE_DOWN, ICON_X } from '../github/ui/icons';
import type { SyntaxPiece } from '../github/review/snippet-syntax';
import { highlightLines, snippetLanguage } from '../github/review/snippet-syntax';
import { shapeMark } from '../github/review/mark-shape';
import { inlineText } from '../github/review/inline-text';
import { fitPathInto } from '../github/review/path-fit';
import { splitOverlapping } from '../github/review/apply-suggestion';
import { helpTip } from '../github/review/help-tip';
import { formatSyncAge } from '../ui/sync-age';
import { NO_KEY_REASON } from '../lib/ai-key';
import type { MissingTool } from '../lib/feedback';
import type { AiStep } from '../lib/local-state';
import type { AiState } from './ai';
import './digest-tokens.css';
import './digest-kit.css';
import './triage.css';

/**
 * The AI triage card under the digest's Geld row, the same on every host: what the open threads need, one row per fix
 * the model proposes with its diff, Apply and Discard, and the hand-off of what is left to a coding agent. The host
 * hands it the card's model, what each control does (`TriageHandlers`) and the classes its own buttons wear
 * (`TriageSkin`); its stylesheet is written against Primer's tokens, which a provider bridges to its own.
 */

const PANEL_CLASS = 'geld-review';
const ATTR_FOCUS = 'data-geld-focus';

/** The classes the host's own controls wear: GitHub's Primer buttons, or a provider's. */
export interface TriageSkin {
  readonly button: string;
  readonly primary: string;
  readonly counter: string;
}

export const GITHUB_TRIAGE_SKIN: TriageSkin = { button: 'btn btn-sm', primary: 'btn btn-sm btn-primary', counter: 'Counter' };

let skin: TriageSkin = GITHUB_TRIAGE_SKIN;

/** What the card reads: where AI stands, the fixes, what is still being written, and the TL;DR. */
export interface TriageCardModel {
  readonly ai: AiState;
  readonly triage: TriageView | null;
  readonly aiPending: ReadonlySet<string>;
  readonly meta: { readonly summary?: { readonly tldr: string } | undefined };
}

/** What the card's controls do; the host decides how a fix is applied and how a finding is handed on. */
export interface TriageHandlers {
  readonly onRunAi: () => void;
  /** Show or hide the triage card (the AI control, once nothing new is left to triage). */
  readonly onToggleTriage: () => void;
  readonly onOpenAiSettings: () => void;
  readonly onToggleSuggestion: (key: string) => void;
  readonly onApplySuggestion: (key: string) => void;
  readonly onApplyAll: (keys: readonly string[]) => void;
  readonly onDiscardAll: (keys: readonly string[]) => void;
  readonly onDiscardSuggestion: (key: string) => void;
  /** Resolves whether the path reached the clipboard. */
  readonly onCopyPath: (path: string) => Promise<boolean>;
  readonly onHandOff: (id: string, how: HandOff, key: string) => void;
  readonly onMissingTool: (tool: MissingTool) => void;
}

function icon(markup: string): SVGElement {
  return svgFromString(markup);
}

function plural(count: number, noun: string, nounPlural = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : nounPlural}`;
}

export type HandOff = 'comment' | 'open' | 'copy';

/** A fix the triage proposed, as its row shows it. */
export interface TriageSuggestionView {
  /** The first comment's anchor of the thread the fix is for. */
  readonly key: string;
  readonly title: string;
  readonly path: string;
  readonly start: number;
  readonly end: number;
  readonly summary: string;
  /** `fix`: a change to its thread's lines that can be applied. `agent`: no fix fits there, so it is for an agent. */
  readonly kind: 'fix' | 'agent';
  readonly diff: readonly DiffRow[];
  /** Who reported it, every thread the fix answers counted. */
  readonly reporters: readonly string[];
  readonly threads: number;
  readonly state: 'open' | 'applied';
  /** Written for the head commit: a fix for an earlier one may no longer fit its lines. */
  readonly current: boolean;
  /** Why it is not current: a commit since, or a comment in its threads it has not read. */
  readonly behind: 'commit' | 'comments' | null;
  /** `fix`: being applied. `writing`: being written afresh from a chat, so it cannot be applied until that lands. */
  readonly busy: 'fix' | 'writing' | null;
  readonly error: string | null;
  /** Who wrote the comment a finding outside its threads came from, when it is one (`StoredSuggestion.origin`). */
  readonly from: string | null;
  /** Sent to an agent by the check before drafting, which judged the fix needs more than its thread's lines. */
  readonly routed: boolean;
}

export interface TriageAgent {
  readonly id: string;
  readonly name: string;
  /** What starts it in a comment on the pull request; null for an agent started from its own app only (T3 Code). */
  readonly command: string | null;
  readonly iconSrc: string | null;
  readonly note: string | null;
  /** For an agent no comment starts (T3 Code): the open target its one action follows. */
  readonly opens: string | null;
  /** The pull request's links show its author used it. */
  readonly used: boolean;
  /** Likely to answer here (`agentLikely`): the menus list it before the rest, which wait behind "Other agents". */
  readonly likely: boolean;
}

/** One way to open a finding as a draft: a service's web app or its app, a line of its own in the menu. */
export interface TriageOpenTarget {
  readonly id: string;
  readonly service: string;
  readonly variant: 'web' | 'app';
  readonly iconSrc: string | null;
  readonly likely: boolean;
  /** Its link cannot carry the task, so the task is copied to paste there (Cursor on the web). */
  readonly copiesTask: boolean;
}

export interface TriageView {
  readonly suggestions: readonly TriageSuggestionView[];
  /** Every web app and app a finding opens in, in the registry's order. */
  readonly openTargets: readonly TriageOpenTarget[];
  /** Every agent, the recommended one first. */
  readonly agents: readonly TriageAgent[];
  readonly recommended: { readonly id: string; readonly reason: 'preferred' | 'used' } | null;
  readonly openKey: string | null;
  readonly collapsed: boolean;
  /** The fixes are still being written. */
  readonly writing: boolean;
  /** What the last hand-off did, said once under the card ("Posted @cursor"), and the finding to offer copying again after a failed copy. */
  readonly handedOff: { readonly text: string; readonly copyAgain: string | null } | null;
  /** Apply resolves the threads it answers: the `resolveOnFix` setting, and no `review.resolveOnFix: false` from the repository. */
  readonly resolves: boolean;
  /** The repository's config is still being read, so whether Apply resolves is not known yet: Apply waits. */
  readonly policyPending: boolean;
  /** Why this host cannot apply a fix from here, when it cannot: Apply stays, greyed out, and says so. */
  readonly applyBlocked?: string;
}


/** Why a fix waits on another triage, in the words its controls and notes use. */
export function behindWords(fix: TriageSuggestionView): string {
  return fix.behind === 'commit' ? 'Written for an earlier commit. Triage again to check it against the new code.' : 'New comments in its thread since it was written. Triage again to read them.';
}

let tipIds = 0;

/**
 * An icon button named by GitHub's own tooltip (the page's `tool-tip`, which upgrades one made here), else by its
 * `title` on a page that has rendered no `tool-tip`: the content script's world cannot ask `customElements`.
 */
export function withTip(button: HTMLElement, words: string): HTMLElement {
  if (document.querySelector('tool-tip') === null) {
    button.setAttribute('aria-label', words);
    button.title = words;
    return button;
  }
  tipIds += 1;
  const id = `geld-tip-${tipIds}`;
  button.id = id;
  button.setAttribute('aria-labelledby', `${id}-tip`);
  const tip = document.createElement('tool-tip');
  for (const [name, value] of Object.entries({ id: `${id}-tip`, for: id, popover: 'manual', 'data-direction': 's', 'data-type': 'label', class: 'sr-only position-absolute', role: 'tooltip' })) tip.setAttribute(name, value);
  tip.textContent = words;
  return createElement('span', { class: `${PANEL_CLASS}__tipped` }, [button, tip]);
}

/** A flashed tooltip's own words and the timer putting them back, so a second flash neither keeps nor restores its own. */
const flashes = new WeakMap<Element, { readonly words: string; readonly timer: number }>();

/** Say something in place of a tooltip's words for a moment ("Copied"), then put them back. */
export function flashTip(tipped: HTMLElement, words: string): void {
  const tip = tipped.querySelector('tool-tip');
  const target = tip ?? tipped;
  const read = (): string => (tip === null ? tipped.title : (tip.textContent ?? ''));
  const write = (text: string): void => {
    if (tip === null) tipped.title = text;
    else tip.textContent = text;
  };
  const earlier = flashes.get(target);
  if (earlier !== undefined) window.clearTimeout(earlier.timer);
  const own = earlier?.words ?? read();
  write(words);
  const timer = window.setTimeout(() => {
    flashes.delete(target);
    if (target.isConnected) write(own);
  }, 1500);
  flashes.set(target, { words: own, timer });
}


let menusInstalled = false;

/** A click anywhere outside an open ⋯ / ⟳ menu closes it, like GitHub's own menus. */
export function installMenuDismissal(): void {
  if (menusInstalled) return;
  menusInstalled = true;
  document.addEventListener(
    'mousedown',
    (event) => {
      for (const open of document.querySelectorAll<HTMLDetailsElement>(`.${PANEL_CLASS}__menu[open]`)) {
        if (!(event.target instanceof Node) || !open.contains(event.target)) open.removeAttribute('open');
      }
    },
    true,
  );
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    for (const open of document.querySelectorAll<HTMLDetailsElement>(`.${PANEL_CLASS}__menu[open]`)) open.removeAttribute('open');
  });
}


/** "2 hours ago", from the sync-age wording, for when the model last ran here. */
export function ranAgo(iso: string): string {
  const age = formatSyncAge(Date.parse(iso));
  return age.compact === 'now' ? 'just now' : `${age.compact} ago`;
}


/** A full-width row about AI with the one button that acts on it: the panel's notices and the triage's failed or stale run. */
export function aiNoticeRow(text: string, action: string, onAction: () => void, tone: 'attention' | 'danger' | 'accent', focusKey?: string): HTMLElement {
  const button = createElement('button', { type: 'button', class: `${PANEL_CLASS}__ai-notice-btn`, ...(focusKey === undefined ? {} : { [ATTR_FOCUS]: focusKey }) }, [action]);
  button.addEventListener('click', onAction);
  return createElement('div', { class: `${PANEL_CLASS}__ai-notice`, 'data-tone': tone, role: 'status' }, [
    createElement('span', { class: `${PANEL_CLASS}__ai-notice-glyph`, 'aria-hidden': 'true' }, [icon(tone === 'danger' ? ICON_ALERT : ICON_SPARKLE_FILL)]),
    createElement('span', { class: `${PANEL_CLASS}__ai-notice-text` }, [text]),
    button,
  ]);
}

const FAILED_STEP: Readonly<Record<AiStep, string>> = {
  findings: 'title the findings',
  tldr: 'write the summary',
  fixes: 'propose fixes',
};

/** "Geld AI could not propose fixes just now. Completion failed (400): …" */
export function aiFailureText(state: Extract<AiState, { readonly kind: 'failed' }>): string {
  return `Geld AI could not ${state.step === undefined ? 'get an answer' : FAILED_STEP[state.step]} ${ranAgo(state.ranAt)}. ${state.error}`;
}


/**
 * The AI triage, right under the Geld row it was asked for from: what the open threads need (the TL;DR), a line when
 * something new arrived since, then one row per fix it proposes, each opening to its diff with Discard and Apply, then
 * Discard all and Apply all under two or more, and the hand-off of what is left to a coding agent.
 */
export function triageCard(model: TriageCardModel, handlers: TriageHandlers, hostSkin: TriageSkin = GITHUB_TRIAGE_SKIN): HTMLElement | null {
  skin = hostSkin;
  const state = model.ai;
  const triage = model.triage;
  const tldrPending = model.aiPending.has('tldr');
  const summary = model.meta.summary?.tldr ?? null;
  if (state.kind === 'off' || state.kind === 'ready' || state.kind === 'nothing') return null;
  if (state.kind === 'app') {
    if (summary === null) return null;
    return createElement('div', { class: `${PANEL_CLASS}__triage` }, [triageText(summary, false)]);
  }
  if (triage?.collapsed === true && state.kind === 'current') return null;
  const card = createElement('div', { class: `${PANEL_CLASS}__triage`, 'aria-label': 'Geld AI triage', role: 'region' });
  // Above whatever a run left: its fixes apply through GitHub with no key, so they stay.
  if (state.kind === 'needs-key') card.append(aiNoticeRow(NO_KEY_REASON, 'Add an API key', () => handlers.onOpenAiSettings(), 'danger', 'triage-add-key'));
  else if (state.kind === 'failed') card.append(aiNoticeRow(aiFailureText(state), 'Try again', () => handlers.onRunAi(), 'danger', 'triage-rerun'));
  else if (state.kind === 'stale') {
    const ago = ranAgo(state.ranAt);
    const text = state.reason === 'commits' ? `New commits since the triage ${ago}. Its fixes may no longer fit.` : state.reason === 'both' ? `New commits and comments since the triage ${ago}. Its fixes may no longer fit.` : `New comments or threads since the triage ${ago}.`;
    card.append(aiNoticeRow(text, 'Triage what is new', () => handlers.onRunAi(), 'attention', 'triage-rerun'));
  }
  if (summary !== null) card.append(triageText(summary, tldrPending));
  else if (tldrPending || state.kind === 'running')
    card.append(
      createElement('div', { class: `${PANEL_CLASS}__triage-head` }, [
        createElement('span', { class: `${PANEL_CLASS}__triage-glyph`, 'aria-hidden': 'true' }, [icon(ICON_SPARKLE_FILL)]),
        createElement('p', { class: `${PANEL_CLASS}__triage-text`, 'data-pending': '', 'aria-label': 'Writing the triage' }, [
          createElement('span', { class: `${PANEL_CLASS}__skeleton`, style: 'width: 78%' }),
          createElement('span', { class: `${PANEL_CLASS}__skeleton`, style: 'width: 52%' }),
        ]),
      ]),
    );
  if (triage !== null) {
    if (triage.suggestions.length > 0) {
      const list = createElement('ul', { class: `${PANEL_CLASS}__triage-fixes`, role: 'list', 'aria-label': 'Suggested fixes' });
      for (const fix of triage.suggestions) list.append(fixRow(fix, triage, handlers));
      card.append(list);
      const bulk = bulkActions(triage, handlers);
      if (bulk !== null) card.append(bulk);
    } else if (triage.writing) {
      card.append(createElement('p', { class: `${PANEL_CLASS}__triage-writing`, 'data-pending': '' }, ['Writing fixes for the open threads…']));
    }
    if (triage.handedOff !== null) {
      const status = createElement('p', { class: `${PANEL_CLASS}__triage-status`, role: 'status' }, [triage.handedOff.text]);
      const again = triage.handedOff.copyAgain;
      if (again !== null) {
        const button = createElement('button', { type: 'button', class: `${PANEL_CLASS}__triage-fix-link`, [ATTR_FOCUS]: 'triage-copy-again' }, ['Copy the task']);
        button.addEventListener('click', () => handlers.onHandOff('', 'copy', again));
        status.append(' ', button);
      }
      card.append(status);
    }
  }
  return card.children.length === 0 ? null : card;
}

/**
 * Under two or more open findings: Discard all and Apply all at the right, as an opened fix's own buttons stand.
 * Apply all takes every fix written for the head in one commit; Discard all takes every finding still listed.
 */
function bulkActions(triage: TriageView, handlers: TriageHandlers): HTMLElement | null {
  const open = triage.suggestions.filter((fix) => fix.state === 'open');
  if (open.length < 2) return null;
  const busy = open.some((fix) => fix.busy !== null);
  const applying = open.some((fix) => fix.busy === 'fix');
  const eligible = open.filter((fix) => fix.kind === 'fix' && fix.current && fix.busy === null);
  // Every eligible fix goes to the handler, which leaves the overlapping ones out and says why on their rows.
  const { batch, overlapping } = splitOverlapping(eligible);
  const ready = batch.map((fix) => fix.key);
  const discard = createElement('button', { type: 'button', class: skin.button, title: `Discard all ${open.length} findings from the triage`, [ATTR_FOCUS]: 'fix-discard-all', ...(busy ? { disabled: '' } : {}) }, [icon(ICON_X), 'Discard all']);
  discard.addEventListener('click', () => handlers.onDiscardAll(open.map((fix) => fix.key)));
  const what = triage.resolves ? 'Post each fix as a suggestion, commit them together, and resolve their threads' : 'Post each fix as a suggestion and commit them together';
  const left = overlapping.length === 0 ? '' : `. ${overlapping.length === 1 ? 'One fix overlaps' : `${overlapping.length} fixes overlap`} another’s lines and waits for the next triage`;
  const title = triage.applyBlocked !== undefined ? triage.applyBlocked : triage.policyPending ? 'Reading the repository’s Geld config first' : ready.length === 0 ? 'No fix here fits the head commit. Triage again first.' : `${what} (${ready.length} ${ready.length === 1 ? 'fix' : 'fixes'})${left}`;
  const fixAll = createElement('button', { type: 'button', class: `${skin.primary} ${PANEL_CLASS}__triage-apply-all`, title, [ATTR_FOCUS]: 'fix-all', ...(applying || ready.length === 0 || triage.policyPending || triage.applyBlocked !== undefined ? { disabled: '' } : {}), ...(applying ? { 'aria-busy': 'true' } : {}) }, [
    applying ? 'Applying…' : 'Apply all',
    ...(ready.length > 0 && !applying ? [createElement('span', { class: `${skin.counter} ${PANEL_CLASS}__triage-count` }, [String(ready.length)])] : []),
  ]);
  fixAll.addEventListener('click', () => handlers.onApplyAll(eligible.map((fix) => fix.key)));
  return createElement('div', { class: `${PANEL_CLASS}__triage-fix-actions ${PANEL_CLASS}__triage-bulk` }, [discard, fixAll]);
}

function triageText(text: string, pending: boolean): HTMLElement {
  return createElement('div', { class: `${PANEL_CLASS}__triage-head` }, [
    createElement('span', { class: `${PANEL_CLASS}__triage-glyph`, 'aria-hidden': 'true' }, [icon(ICON_SPARKLE_FILL)]),
    createElement('p', { class: `${PANEL_CLASS}__triage-text`, ...(pending ? { 'data-pending': '' } : {}) }, [...inlineText(text)]),
  ]);
}

/**
 * One finding the triage read. A fix: its title, where it applies, how much it changes, then the X (Discard) and
 * "Apply" with its menu (copy the task, or hand the finding to an agent instead). A finding no fix fits: "Fix with"
 * the recommended agent and its menu. The row opens to the diff, or to what the triage says is needed.
 */
/** What an opened triage row says above and under its diff: the model's sentence, then why it is shaped as it is. */
export function fixWords(fix: TriageSuggestionView, resolves: boolean): { readonly summary: string; readonly notes: readonly string[] } {
  const isFix = fix.kind === 'fix';
  // A row the check sent to an agent had its lines read: only an unread thread lacks a sentence for that reason.
  const summary = fix.summary !== '' ? fix.summary : isFix || fix.routed ? '' : 'Geld could not read the lines this thread is on, so it proposed no fix here.';
  const notes: string[] = [];
  if (fix.threads > 1) notes.push(`One change for ${fix.threads} threads reporting the same problem (${fix.reporters.join(', ')}). ${resolves ? 'Apply resolves them all.' : 'It answers them all.'}`);
  if (isFix && !fix.current && fix.state !== 'applied') notes.push(behindWords(fix));
  if (!isFix) notes.push(fix.from !== null ? `${fix.from}’s comment asks for this outside its threads, so there is no thread to suggest a fix in. Hand it to an agent.` : fix.routed ? 'Geld’s check found that a proper fix likely changes more than the lines this thread is on, such as other code, other files or tests. So no suggestion was drafted. Hand it to an agent.' : 'A fix that fits the lines a thread is on can be applied as a suggestion. This one needs more than that, so hand it to an agent.');
  return { summary, notes };
}

function fixRow(fix: TriageSuggestionView, triage: TriageView, handlers: TriageHandlers): HTMLElement {
  const open = triage.openKey === fix.key;
  const applied = fix.state === 'applied';
  const isFix = fix.kind === 'fix';
  const added = fix.diff.filter((line) => line.kind === 'add').length;
  const removed = fix.diff.filter((line) => line.kind === 'del').length;
  const lines = fix.start === 0 ? '' : fix.start === fix.end ? `:${fix.start}` : `:${fix.start}–${fix.end}`;
  const where = createElement('span', { class: `${PANEL_CLASS}__triage-fix-where` });
  const lineText = createElement('span', { class: `${PANEL_CLASS}__triage-fix-lines` }, [lines]);
  const toggle = createElement('button', { type: 'button', class: `${PANEL_CLASS}__triage-fix-toggle`, 'aria-expanded': String(open), [ATTR_FOCUS]: `fix:${fix.key}` }, [
    createElement('span', { class: `${PANEL_CLASS}__triage-fix-glyph`, 'aria-hidden': 'true' }, [icon(applied ? ICON_CHECK_CIRCLE_FILL : isFix ? ICON_FILE_DIFF : ICON_ALERT)]),
    createElement('span', { class: `${PANEL_CLASS}__triage-fix-title` }, [...inlineText(fix.title)]),
  ]);
  toggle.addEventListener('click', () => handlers.onToggleSuggestion(fix.key));
  // The path and its copy button stand under the toggle, not in it: a button cannot hold another.
  const path = createElement('span', { class: `${PANEL_CLASS}__triage-fix-path` }, [where, lineText]);
  const place = createElement('div', { class: `${PANEL_CLASS}__triage-fix-place` }, [path]);
  if (fix.path === '' && fix.from !== null) {
    where.setAttribute('data-from', '');
    where.append(`From ${fix.from}’s comment`);
  }
  if (fix.path !== '') {
    const copy = createElement('button', { type: 'button', class: `${PANEL_CLASS}__icon ${PANEL_CLASS}__triage-fix-copy`, [ATTR_FOCUS]: `fix-copy:${fix.key}` }, [icon(ICON_COPY)]);
    const tipped = withTip(copy, 'Copy path');
    copy.addEventListener('click', () => {
      void handlers.onCopyPath(fix.path).then((copied) => flashTip(tipped, copied ? 'Copied' : 'Copy failed'));
    });
    path.append(tipped);
    fitPathInto(where, fix.path, path);
  }
  const status = applied
    ? createElement('span', { class: `${PANEL_CLASS}__triage-fix-state` }, ['Applied'])
    : isFix
      ? createElement('span', { class: `${PANEL_CLASS}__triage-fix-counts`, 'aria-label': `${added} added, ${removed} removed` }, [createElement('span', { 'data-kind': 'add' }, [`+${added}`]), createElement('span', { 'data-kind': 'del' }, [`−${removed}`])])
      : createElement('span', { class: `${PANEL_CLASS}__triage-fix-state`, 'data-kind': 'agent' }, ['Needs an agent']);
  // A fix that waits on another triage says so beside its counts, while its Apply is greyed out.
  const behind = isFix && !applied && !fix.current ? createElement('span', { class: `${PANEL_CLASS}__triage-fix-state`, 'data-kind': 'behind', title: behindWords(fix) }, ['Out of date']) : null;
  place.append(createElement('span', { class: `${PANEL_CLASS}__triage-fix-facts` }, behind === null ? [status] : [behind, status]));
  const head = createElement('div', { class: `${PANEL_CLASS}__triage-fix-row` }, [toggle]);
  for (const line of [head, place]) {
    line.addEventListener('click', (event) => {
      if (event.target instanceof Element && event.target.closest('button, a, details') !== null) return;
      handlers.onToggleSuggestion(fix.key);
    });
  }
  if (!applied) {
    const busy = fix.busy !== null;
    const dismiss = createElement('button', { type: 'button', class: `${PANEL_CLASS}__icon ${PANEL_CLASS}__triage-fix-discard`, [ATTR_FOCUS]: `fix-trash:${fix.key}`, ...(busy ? { disabled: '' } : {}) }, [icon(ICON_X)]);
    dismiss.addEventListener('click', () => handlers.onDiscardSuggestion(fix.key));
    head.append(withTip(dismiss, isFix ? 'Discard this fix' : 'Dismiss from the triage'), isFix ? applyControl(fix, triage, handlers) : agentControl(fix.key, triage, handlers));
  }
  const chevron = createElement('button', { type: 'button', class: `${PANEL_CLASS}__icon ${PANEL_CLASS}__chevron`, 'aria-label': open ? 'Close' : 'Open', 'aria-expanded': String(open), tabindex: '-1' }, [icon(ICON_CHEVRON_DOWN)]);
  chevron.addEventListener('click', () => handlers.onToggleSuggestion(fix.key));
  head.append(chevron);
  const row = createElement('li', { class: `${PANEL_CLASS}__triage-fix`, 'data-state': fix.state, 'data-kind': fix.kind, ...(open ? { 'data-open': '' } : {}) }, [head, place]);
  if (!open) return row;
  const body = createElement('div', { class: `${PANEL_CLASS}__triage-fix-body` });
  const words = fixWords(fix, triage.resolves);
  if (words.summary !== '') body.append(createElement('p', { class: `${PANEL_CLASS}__triage-fix-summary` }, [...inlineText(words.summary)]));
  if (isFix) body.append(diffTable(fix));
  for (const note of words.notes) body.append(createElement('p', { class: `${PANEL_CLASS}__triage-fix-note` }, [note]));
  if (isFix && !applied) {
    const busy = fix.busy !== null;
    const discard = createElement('button', { type: 'button', class: skin.button, [ATTR_FOCUS]: `fix-discard:${fix.key}`, ...(busy ? { disabled: '' } : {}) }, [icon(ICON_X), 'Discard']);
    discard.addEventListener('click', () => handlers.onDiscardSuggestion(fix.key));
    const commit = createElement('button', { type: 'button', class: skin.primary, title: fixWhy(fix, triage), [ATTR_FOCUS]: `fix-commit:${fix.key}`, ...(busy || !fix.current || triage.policyPending || triage.applyBlocked !== undefined ? { disabled: '' } : {}), ...(fix.busy === 'fix' ? { 'aria-busy': 'true' } : {}) }, [fix.busy === 'fix' ? 'Applying…' : 'Apply']);
    commit.addEventListener('click', () => handlers.onApplySuggestion(fix.key));
    body.append(createElement('div', { class: `${PANEL_CLASS}__triage-fix-actions` }, [discard, commit]));
  }
  if (fix.error !== null) body.append(createElement('p', { class: `${PANEL_CLASS}__triage-fix-error`, role: 'alert' }, [fix.error]));
  row.append(body);
  return row;
}

/**
 * Each shown line's syntax pieces. Each side is read with its unchanged lines, the new file (unchanged and added) and
 * the old (unchanged and removed), so a comment or string an unchanged line opens colours both alike; unchanged lines
 * take the new side's colours, removed ones the old's. A gap row starts afresh: the lines it hides are not there.
 */
function diffSyntax(fix: TriageSuggestionView): ReadonlyMap<DiffLine, readonly SyntaxPiece[]> {
  const language = snippetLanguage(fix.path);
  const pieces = new Map<DiffLine, readonly SyntaxPiece[]>();
  if (language === null) return pieces;
  const blocks: DiffLine[][] = [[]];
  for (const row of fix.diff) {
    if (row.kind === 'gap') blocks.push([]);
    else blocks.at(-1)?.push(row);
  }
  const paint = (side: readonly DiffLine[], keep: (line: DiffLine) => boolean): void => {
    const painted = highlightLines(side.map((line) => line.text), language);
    side.forEach((line, index) => {
      const found = painted?.[index];
      if (found !== undefined && keep(line)) pieces.set(line, found);
    });
  };
  for (const block of blocks) {
    paint(block.filter((line) => line.kind !== 'del'), () => true);
    paint(block.filter((line) => line.kind !== 'add'), (line) => line.kind === 'del');
  }
  return pieces;
}

function diffTable(fix: TriageSuggestionView): HTMLElement {
  const table = createElement('table', { class: `${PANEL_CLASS}__diff`, 'aria-label': `Change to ${fix.path}` });
  const rows = createElement('tbody');
  const syntax = diffSyntax(fix);
  for (const line of fix.diff) {
    if (line.kind === 'gap') {
      rows.append(createElement('tr', { 'data-kind': 'gap' }, [createElement('td', { colspan: '4', class: `${PANEL_CLASS}__diff-gap` }, [`⋯ ${plural(line.hidden, 'unchanged line')}`])]));
      continue;
    }
    rows.append(
      createElement('tr', { 'data-kind': line.kind }, [
        createElement('td', { class: `${PANEL_CLASS}__diff-num` }, [line.before === undefined ? '' : String(line.before)]),
        createElement('td', { class: `${PANEL_CLASS}__diff-num` }, [line.after === undefined ? '' : String(line.after)]),
        createElement('td', { class: `${PANEL_CLASS}__diff-sign`, 'aria-hidden': 'true' }, [line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' ']),
        createElement('td', { class: `${PANEL_CLASS}__diff-code` }, codeCell(line, syntax.get(line))),
      ]),
    );
  }
  table.append(rows);
  return createElement('div', { class: `${PANEL_CLASS}__diff-wrap` }, [table]);
}

function codeCell(line: DiffLine, pieces: readonly SyntaxPiece[] | undefined): readonly (Node | string)[] {
  if (line.text === '') return [' '];
  if (pieces === undefined || pieces.length === 0) return [line.text];
  return pieces.map((piece) => (piece.scope === null ? piece.text : createElement('span', { 'data-syn': piece.scope }, [piece.text])));
}

export function agentMark(agent: TriageAgent): HTMLElement {
  return agent.iconSrc === null ? createElement('span', { class: `${PANEL_CLASS}__bot-icon`, 'aria-hidden': 'true' }) : markImg(agent.iconSrc, false);
}

/** A split button: its main half, and a caret opening `entries` (built when opened, so a closed menu costs nothing). */
function splitButton(main: HTMLButtonElement, label: string, focusKey: string, fill: (list: HTMLElement, close: () => void) => void): HTMLElement {
  installMenuDismissal();
  const details = createElement('details', { class: `${PANEL_CLASS}__menu ${PANEL_CLASS}__split-menu` });
  const caret = createElement('summary', { class: `${skin.button} ${PANEL_CLASS}__split-caret`, role: 'button', 'aria-label': label, title: label, [ATTR_FOCUS]: focusKey }, [icon(ICON_TRIANGLE_DOWN)]);
  caret.addEventListener('click', (event) => event.stopPropagation());
  const list = createElement('div', { class: `${PANEL_CLASS}__menu-list ${PANEL_CLASS}__split-list`, role: 'menu' });
  fill(list, () => details.removeAttribute('open'));
  // "Other agents" folds again when the menu closes, so the menu always opens on the likely agents.
  details.addEventListener('toggle', () => {
    if (!details.open) for (const more of list.querySelectorAll('details[open]')) more.removeAttribute('open');
  });
  details.append(caret, list);
  main.classList.add(`${PANEL_CLASS}__split-main`);
  return createElement('div', { class: `${PANEL_CLASS}__split` }, [main, details]);
}

/** A button that only opens its menu: the label with the dropdown caret inside it, the menu placed as a split button's. */
function menuButton(label: string, title: string, focusKey: string, fill: (list: HTMLElement, close: () => void) => void): HTMLElement {
  installMenuDismissal();
  const details = createElement('details', { class: `${PANEL_CLASS}__menu ${PANEL_CLASS}__split-menu` });
  const summary = createElement('summary', { class: `${skin.button} ${PANEL_CLASS}__menu-button`, role: 'button', 'aria-haspopup': 'menu', title, [ATTR_FOCUS]: focusKey }, [createElement('span', { class: `${PANEL_CLASS}__split-label` }, [label]), icon(ICON_TRIANGLE_DOWN)]);
  summary.addEventListener('click', (event) => event.stopPropagation());
  const list = createElement('div', { class: `${PANEL_CLASS}__menu-list ${PANEL_CLASS}__split-list`, role: 'menu' });
  fill(list, () => details.removeAttribute('open'));
  details.addEventListener('toggle', () => {
    if (!details.open) for (const more of list.querySelectorAll('details[open]')) more.removeAttribute('open');
  });
  details.append(summary, list);
  return createElement('div', { class: `${PANEL_CLASS}__split` }, [details]);
}

function menuItem(content: readonly (Node | string)[], close: () => void, onSelect: () => void): HTMLElement {
  const node = createElement('button', { type: 'button', class: `${PANEL_CLASS}__menu-item ${PANEL_CLASS}__split-item`, role: 'menuitem' }, [...content]);
  node.addEventListener('click', (event) => {
    event.stopPropagation();
    close();
    onSelect();
  });
  return node;
}

const VARIANT_WORD: Readonly<Record<TriageOpenTarget['variant'], string>> = { web: 'Web', app: 'App' };

/**
 * For one finding, two sections under small sticky headings. "Fix in this pull request": "Fix with" each agent a comment on the pull
 * request starts. "Open in agent": "Open in" each service's web app or app, one line per way in, a pill saying which,
 * each with the service's mark. In both, what is likely here comes first (as the review bots' request menu puts the
 * bots it has a sign of first) and the rest wait behind a disclosure; with nothing likely, everything is listed.
 */
function agentItems(list: HTMLElement, key: string, triage: TriageView, handlers: TriageHandlers, close: () => void, skip: string | null): void {
  const section = (heading: string, items: readonly HTMLElement[], folded: readonly HTMLElement[], more: string): void => {
    if (items.length + folded.length === 0) return;
    list.append(createElement('div', { class: `${PANEL_CLASS}__split-heading`, role: 'presentation' }, [heading]));
    list.append(...items);
    if (folded.length === 0) return;
    const disclosure = createElement('details', { class: `${PANEL_CLASS}__request-more ${PANEL_CLASS}__split-more` });
    const summary = createElement('summary', { class: `${PANEL_CLASS}__request-more-summary` }, [icon(ICON_CHEVRON_RIGHT), more]);
    summary.addEventListener('click', (event) => event.stopPropagation());
    disclosure.append(summary, ...folded);
    list.append(disclosure);
  };
  const fixItem = (agent: TriageAgent): HTMLElement => menuItem([agentMark(agent), `Fix with ${agent.name}`], close, () => handlers.onHandOff(agent.id, 'comment', key));
  const openItem = (target: TriageOpenTarget): HTMLElement => {
    const item = menuItem(
      [
        target.iconSrc === null ? createElement('span', { class: `${PANEL_CLASS}__bot-icon`, 'aria-hidden': 'true' }) : markImg(target.iconSrc, false),
        createElement('span', { class: `${PANEL_CLASS}__split-name` }, [`Open in ${target.service}`]),
        createElement('span', { class: `${PANEL_CLASS}__split-pill` }, [VARIANT_WORD[target.variant]]),
      ],
      close,
      () => handlers.onHandOff(target.id, 'open', key),
    );
    if (target.copiesTask) item.title = `Copies the task, then opens ${target.service} to paste it`;
    return item;
  };
  const fixers = likelyFirst(triage.agents.filter((agent) => agent.command !== null));
  const lead = skip === null ? undefined : triage.agents.find((agent) => agent.id === skip);
  const show = (agent: TriageAgent): boolean => agent.id !== skip;
  const shown = fixers.first.filter(show);
  const foldedFixers = fixers.folded.filter(show);
  section('Fix in this pull request', shown.map(fixItem), foldedFixers.map(fixItem), `Other agents (${foldedFixers.length})`);
  const targets = likelyFirst(triage.openTargets);
  const keep = (target: TriageOpenTarget): boolean => target.id !== lead?.opens;
  const shownTargets = targets.first.filter(keep);
  const foldedTargets = targets.folded.filter(keep);
  section('Open in agent', shownTargets.map(openItem), foldedTargets.map(openItem), `Other apps (${foldedTargets.length})`);
  list.append(createElement('div', { class: `${PANEL_CLASS}__menu-sep`, role: 'separator' }), missingToolHelp('coding agent', handlers, close, 'menuitem'));
}

/**
 * What a menu lists first and what waits behind its disclosure: the likely entries first, and everything only when none
 * is likely. Decided by the entries, not by what the menu shows of them: the likely agent may be the row's own button
 * and so absent from its menu, and the rest still stay folded then. Exported for its test.
 */
export function likelyFirst<T extends { readonly likely: boolean }>(entries: readonly T[]): { readonly first: readonly T[]; readonly folded: readonly T[] } {
  const likely = entries.filter((entry) => entry.likely);
  return likely.length === 0 ? { first: entries, folded: [] } : { first: likely, folded: entries.filter((entry) => !entry.likely) };
}

/** "Copy the task" for any other agent, at the top of the menu, then the divider over the agents. */
function copyItem(list: HTMLElement, key: string, handlers: TriageHandlers, close: () => void): void {
  list.append(menuItem([createElement('span', { class: `${PANEL_CLASS}__split-glyph`, 'aria-hidden': 'true' }, [icon(ICON_COPY)]), 'Copy the task'], close, () => handlers.onHandOff('', 'copy', key)));
  list.append(createElement('div', { class: `${PANEL_CLASS}__menu-sep`, role: 'separator' }));
}

const MISSING_TOOL_NOUN: Readonly<Record<MissingTool, string>> = { 'review bot': 'bot', 'coding agent': 'agent' };

/** A help icon whose tip reads "Don't see your preferred bot? Request it", the link opening the feedback page with its draft. */
export function missingToolHelp(tool: MissingTool, handlers: Pick<TriageHandlers, 'onMissingTool'>, close: () => void, role: 'menuitem' | null = null): HTMLElement {
  const noun = MISSING_TOOL_NOUN[tool];
  const link = createElement('button', { type: 'button', class: `${PANEL_CLASS}__help-link` }, ['Request it']);
  link.addEventListener('click', (event) => {
    event.stopPropagation();
    close();
    handlers.onMissingTool(tool);
  });
  return helpTip({
    prefix: PANEL_CLASS,
    label: `Don\u2019t see your preferred ${noun}?`,
    content: [`Don\u2019t see your preferred ${noun}? `, link],
    ...(role === null ? {} : { role }),
  });
}

/** What Apply does, for its tooltip: post the suggestion, commit it, and resolve the threads it answers when that is on. */
function fixWhy(fix: TriageSuggestionView, triage: TriageView): string {
  if (triage.applyBlocked !== undefined) return triage.applyBlocked;
  if (!fix.current) return `Triage again first. ${behindWords(fix)}`;
  if (fix.busy === 'writing') return 'Being written afresh from its chat';
  if (triage.policyPending) return 'Reading the repository’s Geld config first';
  const threads = fix.threads === 1 ? 'its thread' : `all ${fix.threads} threads`;
  return triage.resolves ? `Post this fix as a suggestion in the thread, commit it, and resolve ${threads}` : 'Post this fix as a suggestion in the thread and commit it';
}

function applyControl(fix: TriageSuggestionView, triage: TriageView, handlers: TriageHandlers): HTMLElement {
  const blocked = fix.busy !== null || !fix.current || triage.policyPending || triage.applyBlocked !== undefined;
  const main = createElement('button', { type: 'button', class: skin.button, title: fixWhy(fix, triage), [ATTR_FOCUS]: `fix-head-apply:${fix.key}`, ...(blocked ? { disabled: '' } : {}), ...(fix.busy === 'fix' ? { 'aria-busy': 'true' } : {}) }, [
    icon(ICON_CHECK),
    createElement('span', { class: `${PANEL_CLASS}__split-label` }, [fix.busy === 'fix' ? 'Applying…' : 'Apply']),
  ]);
  main.addEventListener('click', () => handlers.onApplySuggestion(fix.key));
  return splitButton(main, 'More ways to fix this', `fix-head-more:${fix.key}`, (list, close) => {
    copyItem(list, fix.key, handlers, close);
    agentItems(list, fix.key, triage, handlers, close, null);
  });
}

/** For a finding no fix fits: hand it to the recommended agent, the others in the menu. */
function agentControl(key: string, triage: TriageView, handlers: TriageHandlers): HTMLElement {
  const lead = triage.recommended === null ? undefined : triage.agents.find((agent) => agent.id === triage.recommended?.id);
  if (lead === undefined) {
    // With no agent to lead, a split would be two halves opening one menu: one button, its caret inside, opens it.
    return menuButton('Fix with agent', 'Hand this finding to a coding agent', `fix-agent:${key}`, (list, close) => {
      copyItem(list, key, handlers, close);
      agentItems(list, key, triage, handlers, close, null);
    });
  }
  const why = triage.recommended?.reason === 'used' ? `${lead.name} worked on this pull request` : 'Your coding agent in Geld settings';
  const what = lead.command === null ? `Open this finding in ${lead.name} as a draft on this pull request` : `Post ${lead.command} on the pull request with this finding`;
  const main = createElement('button', { type: 'button', class: `${skin.button} ${PANEL_CLASS}__split-agent`, title: `${what}. ${why}.`, [ATTR_FOCUS]: `fix-agent:${key}` }, [
    agentMark(lead),
    // "Fix with" starts an agent from a comment; an agent that only opens a draft in its app says so, as its menu item does.
    createElement('span', { class: `${PANEL_CLASS}__split-label` }, [lead.command === null ? `Open in ${lead.name}` : `Fix with ${lead.name}`]),
  ]);
  main.addEventListener('click', () => (lead.command === null ? lead.opens !== null && handlers.onHandOff(lead.opens, 'open', key) : handlers.onHandOff(lead.id, 'comment', key)));
  return splitButton(main, 'Other coding agents', `fix-agent-more:${key}`, (list, close) => {
    copyItem(list, key, handlers, close);
    agentItems(list, key, triage, handlers, close, lead.id);
  });
}


/**
 * A service's mark, framed in the shape of its picture: GitHub squares every
 * App's avatar, but a disc (Chromatic's) or a glyph on a transparent ground
 * (Codex's) showed that square frame around it, so the picture itself decides
 * (`shapeMark`), the page's own rounding (a person's) taken as read.
 */
export function markImg(src: string, roundOnPage: boolean): HTMLElement {
  const img = createElement('img', { class: `${PANEL_CLASS}__bot-icon`, src, alt: '', width: '16', height: '16' });
  shapeMark(img, src, roundOnPage);
  return img;
}


/**
 * The AI control in the Geld row: the sparkle beside where the model stands
 * for this pull request. "Triage with AI" before a run, "AI · 2 hrs ago" after
 * one (stale or failed runs say so in the notice below), the sparkle alone
 * while it runs and on narrow panels. Nothing when AI is switched off in the
 * settings, and nothing when the repository's Action already writes the digest
 * with AI: there is nothing for this device to add.
 */
export function aiButton(state: AiState, handlers: Pick<TriageHandlers, 'onRunAi' | 'onToggleTriage'>): HTMLElement | null {
  if (state.kind === 'off' || state.kind === 'app') return null;
  const label = state.kind === 'ready' || state.kind === 'needs-key' ? 'Triage with AI' : state.kind === 'nothing' ? 'Nothing to triage' : state.kind === 'running' ? 'AI is reading…' : `AI · ${ranAgo(state.ranAt)}`;
  const title =
    state.kind === 'ready'
      ? 'Ask the model what the open threads and the bots’ other findings need, with fixes to preview and apply. Kept on this device only.'
      : state.kind === 'needs-key'
        ? NO_KEY_REASON
      : state.kind === 'nothing'
        ? 'AI titles open review threads and summarizes what is still open. No review thread is open here and no bot reports findings outside one, so there is nothing to ask it.'
        : state.kind === 'running'
        ? 'The model is reading the open threads'
        : state.kind === 'stale'
          ? state.reason === 'commits'
            ? 'Commits landed since the model proposed its fixes here. Run it again to check them against the new code.'
            : state.reason === 'both'
              ? 'Commits and comments landed since the model last ran here. Run it again to check its fixes against them.'
              : 'Comments or threads arrived since the model last ran here. Run it again for the new ones.'
          : state.kind === 'failed'
            ? aiFailureText(state)
            : 'Nothing new to triage since it ran. Show or hide the triage.';
  // `aria-disabled` rather than `disabled` for nothing-to-triage: a disabled button gets no hover, and the title is the explanation.
  const button = createElement('button', { type: 'button', class: `${PANEL_CLASS}__icon ${PANEL_CLASS}__ai-btn`, 'data-state': state.kind, 'aria-label': `${label}. ${title}`, title, [ATTR_FOCUS]: 'ai', ...(state.kind === 'running' ? { 'aria-busy': 'true', disabled: '' } : state.kind === 'nothing' ? { 'aria-disabled': 'true' } : {}) }, [
    icon(ICON_SPARKLE_FILL),
    createElement('span', { class: `${PANEL_CLASS}__ai-label` }, [label]),
  ]);
  if (state.kind === 'current') button.addEventListener('click', () => handlers.onToggleTriage());
  else if (state.kind !== 'nothing') button.addEventListener('click', () => handlers.onRunAi());
  return button;
}
