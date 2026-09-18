/**
 * The review panel grows out of the bottom of the pull request description:
 * same border, the description's bottom corners squared off, the panel's
 * top ones too. Inside, it borrows the merge box's checks list — a heading
 * per group ("2 open items ⌄"), then one line per item: status icon,
 * poster avatar, bold title, muted detail, and on the right view / reply /
 * a ⋯ menu. Rows are an accordion (one open at a time); the open row's
 * slot shows the slim quick view (quick-view.ts). The Geld summary comment
 * itself is hidden — its content is this.
 */

import type { BotVerdictRecord, GeldPrMeta, ReviewItem, ReviewerRecord } from '@geld/review';
import { doneItemCount, isOpenStatus } from '@geld/review';
import { createElement, OWN_UI_ATTRIBUTE, svgFromString } from '../dom';
import {
  ICON_CHECK,
  ICON_CHECK_CIRCLE_FILL,
  ICON_CHEVRON_DOWN,
  ICON_CIRCLE,
  ICON_COMMENT_DISCUSSION,
  ICON_COPY,
  ICON_DOT_FILL,
  ICON_KEBAB_HORIZONTAL,
  ICON_LINK,
  ICON_REPLY,
  ICON_SYNC,
  ICON_X,
} from '../ui/icons';
import { authorLabels, isCurrent, splitItems, statusBadge, verdictLabel, verdictTone } from './panel-model';
import type { SuggestedFix } from '@geld/review';
import { restoreAll } from './teleport';

export const PANEL_CLASS = 'geld-review';
export const ATTR_PANEL = 'data-geld-review-panel';
/** On the description card the panel is attached to (squares its bottom corners). */
export const ATTR_ATTACHED = 'data-geld-attached';
const ATTR_SIG = 'data-geld-review-sig';
const ATTR_SLOT = 'data-geld-slot';

export type GroupId = 'open' | 'done' | 'hidden';

export interface FoldRow {
  readonly key: string;
  readonly label: string;
  readonly count: number;
  readonly avatarSrc: string | null;
  readonly firstAnchor: string | null;
}

export interface RequestableBot {
  readonly id: string;
  readonly label: string;
  readonly trigger: string;
}

export interface Avatar {
  readonly src: string;
  readonly bot: boolean;
}

export interface PanelModel {
  readonly meta: GeldPrMeta;
  readonly freshness: 'fresh' | 'stale' | 'partial' | 'local';
  readonly truncated: boolean;
  /** `item:<id>` or `fold:<key>`; at most one row is open. */
  readonly openKey: string | null;
  readonly collapsedGroups: ReadonlySet<GroupId>;
  readonly fullTimeline: boolean;
  readonly compacting: boolean;
  readonly nudge: boolean;
  readonly viewingAnchor: string | null;
  readonly folds: readonly FoldRow[];
  readonly requestable: readonly RequestableBot[];
  /** Avatars (up to two) for a row, read from the source comments on the page. */
  readonly avatarsFor: (item: ReviewItem) => readonly Avatar[];
  /** Timeline nodes hidden by compaction (for the "show full timeline" row). */
  readonly hiddenCount: number;
  /** Item ids (and `tldr`) the model is working on: those rows shimmer. */
  readonly aiPending: ReadonlySet<string>;
  /** The suggested fix to show for an item under the user's preference, if any. */
  readonly fixFor: (item: ReviewItem) => SuggestedFix | null;
  /** Whether GitHub offers Resolve for this item's thread (else the ⋯ menu says "Mark done"). */
  readonly resolvable: (item: ReviewItem) => boolean;
}

export interface PanelHandlers {
  readonly onToggle: (key: string) => void;
  readonly onToggleGroup: (group: GroupId) => void;
  readonly onStatus: (itemId: string, done: boolean) => void;
  readonly onReply: (itemId: string) => void;
  readonly onCopy: () => void;
  readonly onCopyLink: (anchor: string) => void;
  readonly onCopyItem: (itemId: string) => void;
  readonly onCopyFix: (itemId: string) => void;
  readonly onFullTimeline: () => void;
  readonly onRequest: (botId: string) => void;
  readonly onDismissNudge: () => void;
}

export function itemKey(id: string): string {
  return `item:${id}`;
}

export function foldKey(key: string): string {
  return `fold:${key}`;
}

function icon(markup: string): SVGElement {
  return svgFromString(markup);
}

function iconButton(markup: string, label: string, extra: Readonly<Record<string, string>> = {}): HTMLButtonElement {
  return createElement('button', { type: 'button', class: `${PANEL_CLASS}__icon`, 'aria-label': label, title: label, ...extra }, [icon(markup)]);
}

function avatarImg(entry: Avatar): HTMLElement {
  return createElement('img', { class: `${PANEL_CLASS}__avatar`, 'data-kind': entry.bot ? 'bot' : 'user', src: entry.src, alt: '', width: '20', height: '20', loading: 'lazy' });
}

/** Bots and Apps are rounded squares on GitHub, people are circles; the same pictures the page shows. */
function avatarStack(avatars: readonly Avatar[], fallback: string, bot: boolean): HTMLElement {
  const stack = createElement('span', { class: `${PANEL_CLASS}__avatars`, 'aria-hidden': 'true' });
  if (avatars.length === 0) {
    stack.append(createElement('span', { class: `${PANEL_CLASS}__avatar ${PANEL_CLASS}__avatar--letter`, 'data-kind': bot ? 'bot' : 'user' }, [fallback.charAt(0).toUpperCase() || '?']));
    return stack;
  }
  for (const entry of avatars.slice(0, 2)) stack.append(avatarImg(entry));
  return stack;
}

function chevron(open: boolean): HTMLElement {
  return createElement('span', { class: `${PANEL_CLASS}__chevron`, 'aria-hidden': 'true', 'data-open': String(open) }, [icon(ICON_CHEVRON_DOWN)]);
}

function statusIcon(item: ReviewItem): SVGElement {
  if (!isOpenStatus(item.status)) return icon(ICON_CHECK_CIRCLE_FILL);
  if (item.status === 'needs-reply') return icon(ICON_DOT_FILL);
  return icon(ICON_CIRCLE);
}

interface MenuEntry {
  readonly label: string;
  readonly href?: string;
  readonly onSelect?: () => void;
}

function menu(entries: readonly MenuEntry[]): HTMLElement {
  const details = createElement('details', { class: `${PANEL_CLASS}__menu` });
  const summary = createElement('summary', { class: `${PANEL_CLASS}__icon`, 'aria-label': 'More actions', title: 'More actions', role: 'button' }, [icon(ICON_KEBAB_HORIZONTAL)]);
  summary.addEventListener('click', (event) => event.stopPropagation());
  const list = createElement('div', { class: `${PANEL_CLASS}__menu-list`, role: 'menu' });
  for (const entry of entries) {
    const node =
      entry.href !== undefined
        ? createElement('a', { class: `${PANEL_CLASS}__menu-item`, role: 'menuitem', href: entry.href }, [entry.label])
        : createElement('button', { type: 'button', class: `${PANEL_CLASS}__menu-item`, role: 'menuitem' }, [entry.label]);
    node.addEventListener('click', (event) => {
      event.stopPropagation();
      details.removeAttribute('open');
      entry.onSelect?.();
    });
    list.append(node);
  }
  details.append(summary, list);
  return details;
}

function itemRow(item: ReviewItem, model: PanelModel, handlers: PanelHandlers): HTMLElement {
  const key = itemKey(item.id);
  const open = model.openKey === key;
  const done = !isOpenStatus(item.status);
  const first = item.sources[0];
  const bot = first?.bot !== undefined || /\[bot\]$/i.test(first?.author ?? '');

  const status = createElement('button', { type: 'button', class: `${PANEL_CLASS}__status`, 'aria-label': done ? 'Reopen' : 'Mark done', title: done ? 'Reopen' : 'Mark done', 'aria-pressed': String(done) }, [
    statusIcon(item),
  ]);
  status.addEventListener('click', (event) => {
    event.stopPropagation();
    handlers.onStatus(item.id, !done);
  });

  const detailBits: string[] = [];
  if (item.path !== undefined) detailBits.push(item.line === undefined ? item.path : `${item.path}:${item.line}`);
  detailBits.push(authorLabels(item).join(', '));
  if (item.sources.length > 1) detailBits.push(`${item.sources.length} comments`);
  const pending = model.aiPending.has(item.id);
  const main = createElement('button', { type: 'button', class: `${PANEL_CLASS}__main`, 'aria-expanded': String(open) }, [
    createElement('span', { class: `${PANEL_CLASS}__title`, ...(pending ? { 'data-pending': '', title: 'Geld is consolidating this item' } : {}) }, [item.title]),
    createElement('span', { class: `${PANEL_CLASS}__detail` }, [detailBits.join(' — ')]),
  ]);
  main.addEventListener('click', () => handlers.onToggle(key));

  const right = createElement('span', { class: `${PANEL_CLASS}__right` });
  if (item.rewritten) right.append(createElement('span', { class: `${PANEL_CLASS}__ai`, title: 'Title written by Geld from the sources' }, ['AI']));
  const badge = statusBadge(item.status);
  if (badge !== null) right.append(createElement('span', { class: `${PANEL_CLASS}__pill`, 'data-badge': item.status }, [badge]));
  const reply = iconButton(ICON_REPLY, 'Reply');
  reply.addEventListener('click', (event) => {
    event.stopPropagation();
    handlers.onReply(item.id);
  });
  const entries: MenuEntry[] = [];
  const resolvable = model.resolvable(item);
  entries.push({
    label: resolvable ? (done ? 'Unresolve conversation' : 'Resolve conversation') : done ? 'Reopen' : 'Mark done',
    onSelect: () => handlers.onStatus(item.id, !done),
  });
  entries.push({ label: 'Copy as Markdown', onSelect: () => handlers.onCopyItem(item.id) });
  if (model.fixFor(item) !== null) entries.push({ label: 'Copy suggested fix', onSelect: () => handlers.onCopyFix(item.id) });
  if (first !== undefined) {
    entries.push({ label: 'Show in timeline', href: `#${first.anchor}` });
    entries.push({ label: 'Copy link', onSelect: () => handlers.onCopyLink(first.anchor) });
  }
  right.append(reply, menu(entries), chevron(open));

  const row = createElement(
    'li',
    { class: `${PANEL_CLASS}__row`, 'data-geld-item': item.id, 'data-state': done ? 'done' : item.status, 'data-severity': item.severity },
    [status, avatarStack(model.avatarsFor(item), first?.author ?? '', bot), main, right],
  );
  if (open) row.setAttribute('data-open', '');
  if (model.viewingAnchor !== null && item.sources.some((source) => source.anchor === model.viewingAnchor)) row.setAttribute('data-viewing', '');
  return row;
}

function foldRowEl(fold: FoldRow, model: PanelModel, handlers: PanelHandlers): HTMLElement {
  const key = foldKey(fold.key);
  const open = model.openKey === key;
  const main = createElement('button', { type: 'button', class: `${PANEL_CLASS}__main`, 'aria-expanded': String(open) }, [
    createElement('span', { class: `${PANEL_CLASS}__title ${PANEL_CLASS}__title--plain` }, [fold.label]),
  ]);
  main.addEventListener('click', () => handlers.onToggle(key));
  const right = createElement('span', { class: `${PANEL_CLASS}__right` });
  if (fold.firstAnchor !== null) {
    const anchor = fold.firstAnchor;
    right.append(menu([{ label: 'Show in timeline', href: `#${anchor}` }, { label: 'Copy link', onSelect: () => handlers.onCopyLink(anchor) }]));
  }
  right.append(chevron(open));
  const glyph = createElement('span', { class: `${PANEL_CLASS}__status ${PANEL_CLASS}__status--muted`, 'aria-hidden': 'true' }, [icon(ICON_COMMENT_DISCUSSION)]);
  const row = createElement('li', { class: `${PANEL_CLASS}__row ${PANEL_CLASS}__row--fold`, 'data-geld-fold': fold.key }, [
    glyph,
    ...(fold.avatarSrc === null ? [] : [avatarStack([{ src: fold.avatarSrc, bot: true }], fold.label, true)]),
    main,
    right,
  ]);
  if (open) row.setAttribute('data-open', '');
  return row;
}

/** Geld's own notes for an open item — merged context and the fix — above the moved comments. */
function notesFor(item: ReviewItem, model: PanelModel, handlers: PanelHandlers): HTMLElement | null {
  const fix = model.fixFor(item);
  if (item.context === undefined && fix === null) return null;
  const notes = createElement('div', { class: `${PANEL_CLASS}__notes` });
  if (item.context !== undefined) notes.append(createElement('p', { class: `${PANEL_CLASS}__context` }, [item.context]));
  if (fix !== null) {
    const head = createElement('div', { class: `${PANEL_CLASS}__fix-head` }, [
      createElement('span', {}, [fix.source === 'ai' ? 'Suggested fix (Geld)' : fix.source === 'bot' ? 'Suggested fix (bot)' : 'Suggested fix']),
    ]);
    const copy = iconButton(ICON_COPY, 'Copy fix');
    copy.addEventListener('click', () => handlers.onCopyFix(item.id));
    head.append(copy);
    notes.append(head, createElement('pre', { class: `${PANEL_CLASS}__fix` }, [createElement('code', {}, [fix.text])]));
  }
  return notes;
}

function slotRow(key: string, notes: HTMLElement | null = null): HTMLElement {
  const body = createElement('div', { class: `${PANEL_CLASS}__slot-body` });
  return createElement('li', { class: `${PANEL_CLASS}__slot`, [ATTR_SLOT]: key }, notes === null ? [body] : [notes, body]);
}

function groupHeading(id: GroupId, label: string, model: PanelModel, handlers: PanelHandlers): HTMLElement {
  const collapsed = model.collapsedGroups.has(id);
  const button = createElement('button', { type: 'button', class: `${PANEL_CLASS}__group-btn`, 'aria-expanded': String(!collapsed) }, [
    createElement('span', {}, [label]),
    icon(ICON_CHEVRON_DOWN),
  ]);
  button.addEventListener('click', () => handlers.onToggleGroup(id));
  return createElement('li', { class: `${PANEL_CLASS}__group`, 'data-group': id }, [button]);
}

function plural(count: number, noun: string, nounPlural = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : nounPlural}`;
}

function verdictChip(bot: BotVerdictRecord, model: PanelModel, handlers: PanelHandlers): HTMLElement {
  const current = isCurrent(bot, model.meta.headSha);
  const chip = createElement(
    'span',
    { class: `${PANEL_CLASS}__chip`, 'data-tone': verdictTone(bot), 'data-current': String(current), title: current ? 'Reviewed the current commit' : 'Reviewed an earlier commit' },
    [createElement('span', {}, [verdictLabel(bot)])],
  );
  if (!current) chip.append(createElement('span', { class: `${PANEL_CLASS}__chip-note` }, ['behind']));
  if (bot.sourceId !== undefined) {
    chip.append(createElement('a', { class: `${PANEL_CLASS}__chip-link`, href: `#${bot.sourceId}`, 'aria-label': 'Show the review', title: 'Show the review' }, [icon(ICON_LINK)]));
  }
  const request = model.requestable.find((entry) => entry.id === bot.id);
  if (request !== undefined) {
    const rerun = createElement('button', { type: 'button', class: `${PANEL_CLASS}__chip-link`, 'aria-label': `Re-run ${request.label}`, title: `Re-run: posts “${request.trigger}”` }, [icon(ICON_SYNC)]);
    rerun.addEventListener('click', () => handlers.onRequest(bot.id));
    chip.append(rerun);
  }
  return chip;
}

function reviewerChip(reviewer: ReviewerRecord): HTMLElement {
  const tone = reviewer.state === 'approved' ? 'success' : reviewer.state === 'changes_requested' ? 'danger' : 'neutral';
  const label =
    reviewer.state === 'approved' ? 'approved' : reviewer.state === 'changes_requested' ? 'requested changes' : reviewer.state === 'pending' ? 'pending' : 'commented';
  return createElement('span', { class: `${PANEL_CLASS}__chip`, 'data-tone': tone, title: `@${reviewer.login} ${label}` }, [
    ...(reviewer.state === 'approved' ? [icon(ICON_CHECK)] : []),
    createElement('span', {}, [`@${reviewer.login}`]),
    createElement('span', { class: `${PANEL_CLASS}__chip-note` }, [label]),
  ]);
}

function requestRow(model: PanelModel, handlers: PanelHandlers): HTMLElement | null {
  if (model.requestable.length === 0) return null;
  const row = createElement('div', { class: `${PANEL_CLASS}__request` }, [createElement('span', { class: `${PANEL_CLASS}__request-label` }, ['Request a review'])]);
  for (const bot of model.requestable) {
    const holder = createElement('span', { class: `${PANEL_CLASS}__request-bot` });
    const ask = createElement('button', { type: 'button', class: `${PANEL_CLASS}__button`, title: `Posts “${bot.trigger}” as a comment` }, [bot.label]);
    const confirm = createElement('span', { class: `${PANEL_CLASS}__confirm`, hidden: '' }, [createElement('span', {}, [`Post “${bot.trigger}”?`])]);
    const yes = iconButton(ICON_CHECK, 'Post it');
    const no = iconButton(ICON_X, 'Cancel');
    confirm.append(yes, no);
    ask.addEventListener('click', () => {
      ask.hidden = true;
      confirm.hidden = false;
      yes.focus({ preventScroll: true });
    });
    no.addEventListener('click', () => {
      confirm.hidden = true;
      ask.hidden = false;
    });
    yes.addEventListener('click', () => {
      confirm.hidden = true;
      ask.hidden = false;
      handlers.onRequest(bot.id);
    });
    holder.append(ask, confirm);
    row.append(holder);
  }
  return row;
}

function signatureOf(model: PanelModel): string {
  return JSON.stringify({
    freshness: model.freshness,
    truncated: model.truncated,
    openKey: model.openKey,
    collapsed: [...model.collapsedGroups].sort(),
    fullTimeline: model.fullTimeline,
    compacting: model.compacting,
    nudge: model.nudge,
    viewingAnchor: model.viewingAnchor,
    generatedAt: model.meta.generatedAt,
    headSha: model.meta.headSha,
    items: model.meta.items.map(
      (item) =>
        `${item.id}:${item.status}:${item.title}:${item.context ?? ''}:${model.fixFor(item)?.text ?? ''}:${model.avatarsFor(item).map((entry) => entry.src).join(',')}:${model.resolvable(item) ? 'r' : ''}:${item.rewritten ? 'ai' : ''}`,
    ),
    hiddenCount: model.hiddenCount,
    pending: [...model.aiPending].sort(),
    tldr: model.meta.summary?.tldr ?? '',
    bots: model.meta.bots.map((bot) => `${bot.id}:${bot.verdict}:${bot.count ?? ''}:${bot.score ?? ''}:${bot.reviewedSha}`),
    reviewers: model.meta.reviewers.map((reviewer) => `${reviewer.login}:${reviewer.state}`),
    folds: model.folds.map((fold) => `${fold.key}:${fold.count}:${fold.avatarSrc ?? ''}`),
    requestable: model.requestable.map((bot) => bot.id),
  });
}

/**
 * The description's bordered card. The panel is inserted right after it,
 * inside the same column, so the two read as one box.
 */
function descriptionCard(): HTMLElement | null {
  const classic =
    document.querySelector<HTMLElement>('.js-discussion > .js-timeline-item .timeline-comment') ??
    document.querySelector<HTMLElement>('#discussion_bucket .js-comment-container .timeline-comment');
  if (classic !== null) return classic;
  const react = document.querySelector<HTMLElement>('[data-testid="issue-body"]');
  if (react !== null) return react.closest<HTMLElement>('[data-testid="issue-body-viewer"], [class*="IssueBody"]') ?? react;
  return document.querySelector<HTMLElement>('.timeline-comment');
}

export interface MountedPanel {
  readonly root: HTMLElement;
  /** Body of the open row's slot, or null when nothing is open. */
  readonly slot: HTMLElement | null;
}

export function mountPanel(model: PanelModel, handlers: PanelHandlers): MountedPanel | null {
  const existing = document.querySelector<HTMLElement>(`.${PANEL_CLASS}[${ATTR_PANEL}]`);
  const signature = signatureOf(model);
  if (existing !== null && existing.getAttribute(ATTR_SIG) === signature && existing.isConnected) {
    return { root: existing, slot: existing.querySelector<HTMLElement>(`[${ATTR_SLOT}] > .${PANEL_CLASS}__slot-body`) };
  }
  const card = descriptionCard();
  if (card === null) return null;
  // Quick-viewed nodes live inside the old panel; send them home before it goes.
  restoreAll();
  existing?.remove();
  for (const stale of document.querySelectorAll(`[${ATTR_ATTACHED}]`)) {
    if (stale !== card) stale.removeAttribute(ATTR_ATTACHED);
  }
  card.setAttribute(ATTR_ATTACHED, '');

  const { open, done } = splitItems(model.meta.items);
  const total = model.meta.items.length;
  const doneCount = doneItemCount(model.meta.items);
  const percent = total === 0 ? 0 : Math.round((doneCount / total) * 100);
  const waiting = model.meta.items.filter((item) => item.status === 'needs-reply').length;

  /* Summary strip */
  const summary = createElement('div', { class: `${PANEL_CLASS}__summary` }, [
    createElement('span', { class: `${PANEL_CLASS}__brand` }, ['Geld']),
    createElement('span', { class: `${PANEL_CLASS}__progress`, title: `${doneCount} of ${total} review items done` }, [
      createElement('span', { class: `${PANEL_CLASS}__meter`, 'aria-hidden': 'true' }, [createElement('i', { style: `width:${percent}%` })]),
      createElement('span', {}, [total === 0 ? 'No review items' : `${doneCount} of ${total} done`]),
    ]),
  ]);
  if (waiting > 0) summary.append(createElement('span', { class: `${PANEL_CLASS}__chip`, 'data-tone': 'attention' }, [`${waiting} need${waiting === 1 ? 's' : ''} a reply`]));
  if (model.freshness === 'stale' || model.freshness === 'partial') summary.append(createElement('span', { class: `${PANEL_CLASS}__fresh` }, ['Updating…']));
  else if (model.freshness === 'local') summary.append(createElement('span', { class: `${PANEL_CLASS}__fresh`, title: 'No Geld summary comment on this pull request yet; built from the page.' }, ['from this page']));
  const chips = createElement('div', { class: `${PANEL_CLASS}__chips` });
  for (const bot of model.meta.bots) chips.append(verdictChip(bot, model, handlers));
  for (const reviewer of model.meta.reviewers) chips.append(reviewerChip(reviewer));
  const tools = createElement('div', { class: `${PANEL_CLASS}__tools` });
  const copy = iconButton(ICON_COPY, 'Copy digest');
  copy.addEventListener('click', () => handlers.onCopy());
  tools.append(copy);
  const head = createElement('div', { class: `${PANEL_CLASS}__head` }, [summary, chips, tools]);
  const tldrPending = model.aiPending.has('tldr');
  const tldr =
    model.meta.summary !== undefined
      ? createElement('p', { class: `${PANEL_CLASS}__tldr`, ...(tldrPending ? { 'data-pending': '' } : {}) }, [model.meta.summary.tldr])
      : tldrPending
        ? createElement('p', { class: `${PANEL_CLASS}__tldr`, 'data-pending': '', 'aria-label': 'Writing the summary' }, [
            createElement('span', { class: `${PANEL_CLASS}__skeleton`, style: 'width: 78%' }),
            createElement('span', { class: `${PANEL_CLASS}__skeleton`, style: 'width: 52%' }),
          ])
        : null;

  /* Groups */
  const rows = createElement('ul', { class: `${PANEL_CLASS}__rows`, role: 'list' });
  const appendRows = (items: readonly ReviewItem[]): void => {
    for (const item of items) {
      rows.append(itemRow(item, model, handlers));
      if (model.openKey === itemKey(item.id)) rows.append(slotRow(model.openKey, notesFor(item, model, handlers)));
    }
  };
  if (open.length > 0) {
    rows.append(groupHeading('open', plural(open.length, 'open item'), model, handlers));
    if (!model.collapsedGroups.has('open')) appendRows(open);
  }
  if (done.length > 0) {
    rows.append(groupHeading('done', plural(done.length, 'done item'), model, handlers));
    if (!model.collapsedGroups.has('done')) appendRows(done);
  }
  if (model.folds.length > 0 && !model.fullTimeline) {
    // One fold is its own row; a heading over a single row would just repeat it.
    if (model.folds.length > 1) {
      const hiddenCount = model.folds.reduce((sum, fold) => sum + fold.count, 0);
      rows.append(groupHeading('hidden', plural(hiddenCount, 'hidden item'), model, handlers));
    }
    if (model.folds.length === 1 || !model.collapsedGroups.has('hidden')) {
      for (const fold of model.folds) {
        rows.append(foldRowEl(fold, model, handlers));
        if (model.openKey === foldKey(fold.key)) rows.append(slotRow(model.openKey));
      }
    }
  }
  if (total === 0 && model.folds.length === 0) rows.append(createElement('li', { class: `${PANEL_CLASS}__empty` }, ['No review comments yet.']));

  const panel = createElement('section', { class: PANEL_CLASS, [OWN_UI_ATTRIBUTE]: '', [ATTR_PANEL]: '', [ATTR_SIG]: signature, 'aria-label': 'Geld review digest' }, [
    head,
    ...(tldr === null ? [] : [tldr]),
    rows,
  ]);

  /* Footer */
  const footerBits: Node[] = [];
  const request = requestRow(model, handlers);
  if (request !== null) footerBits.push(request);
  if (model.truncated) footerBits.push(createElement('p', { class: `${PANEL_CLASS}__note` }, ['The summary was truncated; the rest of the discussion is still in the timeline.']));
  if (model.nudge) {
    const nudge = createElement('p', { class: `${PANEL_CLASS}__note` }, ['Add the Geld Action to this repository and this digest is ready before the page opens. ']);
    nudge.append(createElement('a', { href: 'https://www.geld.sh/how-it-works#summary', target: '_blank', rel: 'noreferrer' }, ['How']), document.createTextNode(' · '));
    const dismiss = createElement('button', { type: 'button', class: `${PANEL_CLASS}__link` }, ['Dismiss']);
    dismiss.addEventListener('click', () => handlers.onDismissNudge());
    nudge.append(dismiss);
    footerBits.push(nudge);
  }
  if (footerBits.length > 0) panel.append(createElement('div', { class: `${PANEL_CLASS}__foot` }, footerBits));
  if (model.compacting && (model.hiddenCount > 0 || model.fullTimeline)) {
    // The one control for the timeline itself, shaped like GitHub's own "N hidden items · Load more" bar.
    const toggle = createElement('button', { type: 'button', class: `${PANEL_CLASS}__timeline-btn`, 'aria-pressed': String(model.fullTimeline) }, [
      model.fullTimeline ? 'Compact timeline' : `Show ${plural(model.hiddenCount, 'hidden item')} in the timeline`,
    ]);
    toggle.addEventListener('click', () => handlers.onFullTimeline());
    panel.append(createElement('div', { class: `${PANEL_CLASS}__timeline` }, [toggle]));
  }

  // The description card may hang past the timeline rail (`ml-n3`); share its horizontal geometry.
  const cardStyle = getComputedStyle(card);
  panel.style.marginLeft = cardStyle.marginLeft;
  panel.style.marginRight = cardStyle.marginRight;
  card.insertAdjacentElement('afterend', panel);
  return { root: panel, slot: panel.querySelector<HTMLElement>(`[${ATTR_SLOT}] > .${PANEL_CLASS}__slot-body`) };
}

export function unmountPanel(): void {
  restoreAll();
  document.querySelector(`.${PANEL_CLASS}[${ATTR_PANEL}]`)?.remove();
  for (const card of document.querySelectorAll(`[${ATTR_ATTACHED}]`)) card.removeAttribute(ATTR_ATTACHED);
}

