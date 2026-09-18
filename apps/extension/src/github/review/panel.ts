/**
 * The review panel: one compact block above the first timeline item. A
 * header line (progress, bot verdicts, reviewers, tools), then one row per
 * review item and one row per fold of hidden activity. Rows are accordions:
 * at most one is open, and the open one shows the real timeline nodes in a
 * slot right under it (teleport.ts) rather than sending the reader down the
 * page. The Geld summary comment itself is hidden — its content is this.
 */

import type { BotVerdictRecord, GeldPrMeta, ReviewItem, ReviewerRecord } from '@geld/review';
import { doneItemCount, isOpenStatus, openItemCount } from '@geld/review';
import { createElement, OWN_UI_ATTRIBUTE, svgFromString } from '../dom';
import {
  ICON_CHECK,
  ICON_CHECK_CIRCLE_FILL,
  ICON_CHEVRON_DOWN,
  ICON_CIRCLE,
  ICON_COMMENT_DISCUSSION,
  ICON_COPY,
  ICON_EYE,
  ICON_LINK,
  ICON_REPLY,
  ICON_ROWS,
  ICON_SYNC,
  ICON_X,
} from '../ui/icons';
import { authorLabels, isCurrent, splitItems, statusBadge, verdictLabel, verdictTone } from './panel-model';
import { restoreAll } from './teleport';

export const PANEL_CLASS = 'geld-review';
export const ATTR_PANEL = 'data-geld-review-panel';
const ATTR_SIG = 'data-geld-review-sig';
const ATTR_SLOT = 'data-geld-slot';

export interface FoldRow {
  readonly key: string;
  readonly label: string;
  readonly count: number;
  readonly avatarSrc: string | null;
}

export interface RequestableBot {
  readonly id: string;
  readonly label: string;
  readonly trigger: string;
}

export interface PanelModel {
  readonly meta: GeldPrMeta;
  readonly freshness: 'fresh' | 'stale' | 'partial' | 'local';
  readonly truncated: boolean;
  /** `item:<id>` or `fold:<key>`; at most one row is open. */
  readonly openKey: string | null;
  readonly showDone: boolean;
  readonly fullTimeline: boolean;
  readonly compacting: boolean;
  readonly nudge: boolean;
  readonly viewingAnchor: string | null;
  readonly folds: readonly FoldRow[];
  readonly requestable: readonly RequestableBot[];
  /** Avatar URLs (up to two) for a row, read from the source comments on the page. */
  readonly avatarsFor: (item: ReviewItem) => readonly string[];
}

export interface PanelHandlers {
  readonly onToggle: (key: string) => void;
  readonly onStatus: (itemId: string, done: boolean) => void;
  readonly onReply: (itemId: string) => void;
  readonly onCopy: () => void;
  readonly onFullTimeline: () => void;
  readonly onToggleDone: () => void;
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
  const button = createElement('button', { type: 'button', class: `${PANEL_CLASS}__icon`, 'aria-label': label, title: label, ...extra }, [icon(markup)]);
  return button;
}

function avatarStack(sources: readonly string[], fallback: string): HTMLElement {
  const stack = createElement('span', { class: `${PANEL_CLASS}__avatars`, 'aria-hidden': 'true' });
  if (sources.length === 0) {
    stack.append(createElement('span', { class: `${PANEL_CLASS}__avatar ${PANEL_CLASS}__avatar--letter` }, [fallback.charAt(0).toUpperCase() || '?']));
    return stack;
  }
  for (const src of sources.slice(0, 2)) {
    stack.append(createElement('img', { class: `${PANEL_CLASS}__avatar`, src, alt: '', width: '20', height: '20', loading: 'lazy' }));
  }
  return stack;
}

function itemRow(item: ReviewItem, model: PanelModel, handlers: PanelHandlers): HTMLElement {
  const key = itemKey(item.id);
  const open = model.openKey === key;
  const done = !isOpenStatus(item.status);
  const status = iconButton(done ? ICON_CHECK_CIRCLE_FILL : ICON_CIRCLE, done ? 'Reopen' : 'Mark done', {
    class: `${PANEL_CLASS}__icon ${PANEL_CLASS}__status`,
    'aria-pressed': String(done),
  });
  status.addEventListener('click', (event) => {
    event.stopPropagation();
    handlers.onStatus(item.id, !done);
  });

  const title = createElement('span', { class: `${PANEL_CLASS}__title` }, [item.title]);
  const metaBits: Node[] = [];
  if (item.path !== undefined) {
    metaBits.push(createElement('code', { class: `${PANEL_CLASS}__loc` }, [item.line === undefined ? item.path : `${item.path}:${item.line}`]));
  }
  metaBits.push(createElement('span', { class: `${PANEL_CLASS}__who` }, [authorLabels(item).join(', ')]));
  const badge = statusBadge(item.status);
  if (badge !== null) metaBits.push(createElement('span', { class: `${PANEL_CLASS}__badge`, 'data-badge': item.status }, [badge]));
  if (item.sources.length > 1) metaBits.push(createElement('span', { class: `${PANEL_CLASS}__count` }, [`${item.sources.length} sources`]));
  const main = createElement('button', { type: 'button', class: `${PANEL_CLASS}__main`, 'aria-expanded': String(open) }, [
    title,
    createElement('span', { class: `${PANEL_CLASS}__meta` }, metaBits),
  ]);
  main.addEventListener('click', () => handlers.onToggle(key));

  const first = item.sources[0];
  const actions = createElement('span', { class: `${PANEL_CLASS}__actions` });
  if (first !== undefined) {
    actions.append(createElement('a', { class: `${PANEL_CLASS}__icon`, href: `#${first.anchor}`, 'aria-label': 'Show in timeline', title: 'Show in timeline' }, [icon(ICON_LINK)]));
  }
  const reply = iconButton(ICON_REPLY, 'Reply');
  reply.addEventListener('click', (event) => {
    event.stopPropagation();
    handlers.onReply(item.id);
  });
  const view = iconButton(ICON_EYE, open ? 'Close quick view' : 'Quick view', { 'aria-expanded': String(open) });
  view.addEventListener('click', (event) => {
    event.stopPropagation();
    handlers.onToggle(key);
  });
  actions.append(reply, view);

  const row = createElement(
    'li',
    { class: `${PANEL_CLASS}__row`, 'data-geld-item': item.id, 'data-state': done ? 'done' : item.status, 'data-severity': item.severity },
    [status, avatarStack(model.avatarsFor(item), first?.author ?? ''), main, actions],
  );
  if (open) row.setAttribute('data-open', '');
  if (model.viewingAnchor !== null && item.sources.some((source) => source.anchor === model.viewingAnchor)) row.setAttribute('data-viewing', '');
  return row;
}

function foldRowEl(fold: FoldRow, model: PanelModel, handlers: PanelHandlers): HTMLElement {
  const key = foldKey(fold.key);
  const open = model.openKey === key;
  const glyph = createElement('span', { class: `${PANEL_CLASS}__icon ${PANEL_CLASS}__glyph`, 'aria-hidden': 'true' }, [icon(ICON_COMMENT_DISCUSSION)]);
  const main = createElement('button', { type: 'button', class: `${PANEL_CLASS}__main`, 'aria-expanded': String(open) }, [
    createElement('span', { class: `${PANEL_CLASS}__title ${PANEL_CLASS}__title--muted` }, [fold.label]),
  ]);
  main.addEventListener('click', () => handlers.onToggle(key));
  const view = iconButton(ICON_EYE, open ? 'Close quick view' : 'Quick view', { 'aria-expanded': String(open) });
  view.addEventListener('click', (event) => {
    event.stopPropagation();
    handlers.onToggle(key);
  });
  const row = createElement('li', { class: `${PANEL_CLASS}__row ${PANEL_CLASS}__row--fold`, 'data-geld-fold': fold.key }, [
    glyph,
    avatarStack(fold.avatarSrc === null ? [] : [fold.avatarSrc], fold.label),
    main,
    createElement('span', { class: `${PANEL_CLASS}__actions` }, [view]),
  ]);
  if (open) row.setAttribute('data-open', '');
  return row;
}

function slotRow(key: string): HTMLElement {
  return createElement('li', { class: `${PANEL_CLASS}__slot`, [ATTR_SLOT]: key }, [createElement('div', { class: `${PANEL_CLASS}__slot-body` })]);
}

function groupHeading(label: string, count: number, extra: Node[] = []): HTMLElement {
  return createElement('li', { class: `${PANEL_CLASS}__group`, role: 'presentation' }, [
    createElement('span', {}, [label]),
    createElement('span', { class: `${PANEL_CLASS}__group-count` }, [String(count)]),
    ...extra,
  ]);
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
    const ask = createElement('button', { type: 'button', class: `${PANEL_CLASS}__pill`, title: `Posts “${bot.trigger}” as a comment` }, [bot.label]);
    const confirm = createElement('span', { class: `${PANEL_CLASS}__confirm`, hidden: '' }, [
      createElement('span', {}, [`Post “${bot.trigger}”?`]),
    ]);
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
    showDone: model.showDone,
    fullTimeline: model.fullTimeline,
    compacting: model.compacting,
    nudge: model.nudge,
    viewingAnchor: model.viewingAnchor,
    generatedAt: model.meta.generatedAt,
    headSha: model.meta.headSha,
    items: model.meta.items.map((item) => `${item.id}:${item.status}:${item.title}:${model.avatarsFor(item).join(',')}`),
    bots: model.meta.bots.map((bot) => `${bot.id}:${bot.verdict}:${bot.count ?? ''}:${bot.score ?? ''}:${bot.reviewedSha}`),
    reviewers: model.meta.reviewers.map((reviewer) => `${reviewer.login}:${reviewer.state}`),
    folds: model.folds.map((fold) => `${fold.key}:${fold.count}:${fold.avatarSrc ?? ''}`),
    requestable: model.requestable.map((bot) => bot.id),
  });
}

/** Where the panel sits: directly above the first timeline item (the description). */
function panelHost(): HTMLElement | null {
  const first =
    document.querySelector<HTMLElement>('.js-discussion > .js-timeline-item') ??
    document.querySelector<HTMLElement>('.js-discussion .js-comment-container') ??
    document.querySelector<HTMLElement>('#discussion_bucket .js-comment-container') ??
    document.querySelector<HTMLElement>('[data-testid="issue-body"]') ??
    document.querySelector<HTMLElement>('.timeline-comment');
  if (first === null) return null;
  const wrapper = first.closest<HTMLElement>('.js-timeline-item, .TimelineItem, [data-testid="issue-viewer-container"] > *');
  return wrapper ?? first;
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
  const host = panelHost();
  if (host === null) return null;
  // Quick-viewed nodes live inside the old panel; send them home before it goes.
  restoreAll();
  existing?.remove();

  const { open, done } = splitItems(model.meta.items);
  const total = model.meta.items.length;
  const doneCount = doneItemCount(model.meta.items);
  const percent = total === 0 ? 0 : Math.round((doneCount / total) * 100);

  const summary = createElement('div', { class: `${PANEL_CLASS}__summary` }, [
    createElement('span', { class: `${PANEL_CLASS}__brand` }, ['Geld']),
    createElement('span', { class: `${PANEL_CLASS}__progress`, title: `${doneCount} of ${total} review items done` }, [
      createElement('span', { class: `${PANEL_CLASS}__meter`, 'aria-hidden': 'true' }, [createElement('i', { style: `width:${percent}%` })]),
      createElement('span', {}, [total === 0 ? 'No review items' : `${doneCount} of ${total} done`]),
    ]),
  ]);
  if (openItemCount(model.meta.items) > 0) {
    const waiting = model.meta.items.filter((item) => item.status === 'needs-reply').length;
    if (waiting > 0) summary.append(createElement('span', { class: `${PANEL_CLASS}__chip`, 'data-tone': 'attention' }, [`${waiting} need${waiting === 1 ? 's' : ''} a reply`]));
  }
  if (model.freshness === 'stale' || model.freshness === 'partial') {
    summary.append(createElement('span', { class: `${PANEL_CLASS}__fresh` }, ['Updating…']));
  } else if (model.freshness === 'local') {
    summary.append(createElement('span', { class: `${PANEL_CLASS}__fresh`, title: 'No Geld summary comment on this pull request yet; built from the page.' }, ['from this page']));
  }

  const chips = createElement('div', { class: `${PANEL_CLASS}__chips` });
  for (const bot of model.meta.bots) chips.append(verdictChip(bot, model, handlers));
  for (const reviewer of model.meta.reviewers) chips.append(reviewerChip(reviewer));

  const tools = createElement('div', { class: `${PANEL_CLASS}__tools` });
  const copy = iconButton(ICON_COPY, 'Copy digest');
  copy.addEventListener('click', () => handlers.onCopy());
  tools.append(copy);
  if (model.compacting) {
    const timeline = iconButton(ICON_ROWS, model.fullTimeline ? 'Compact the timeline' : 'Show the full timeline', { 'aria-pressed': String(model.fullTimeline) });
    timeline.addEventListener('click', () => handlers.onFullTimeline());
    tools.append(timeline);
  }

  const header = createElement('div', { class: `${PANEL_CLASS}__head` }, [summary, chips, tools]);

  const rows = createElement('ul', { class: `${PANEL_CLASS}__rows`, role: 'list' });
  const appendRows = (items: readonly ReviewItem[]): void => {
    for (const item of items) {
      rows.append(itemRow(item, model, handlers));
      if (model.openKey === itemKey(item.id)) rows.append(slotRow(model.openKey));
    }
  };
  if (open.length > 0) {
    rows.append(groupHeading('Open', open.length));
    appendRows(open);
  }
  if (done.length > 0) {
    const toggle = createElement('button', { type: 'button', class: `${PANEL_CLASS}__group-toggle`, 'aria-expanded': String(model.showDone) }, [
      createElement('span', {}, [model.showDone ? 'Hide' : 'Show']),
      icon(ICON_CHEVRON_DOWN),
    ]);
    toggle.addEventListener('click', () => handlers.onToggleDone());
    rows.append(groupHeading('Done', done.length, [toggle]));
    if (model.showDone) appendRows(done);
  }
  if (model.folds.length > 0 && !model.fullTimeline) {
    rows.append(groupHeading('Hidden from the timeline', model.folds.reduce((sum, fold) => sum + fold.count, 0)));
    for (const fold of model.folds) {
      rows.append(foldRowEl(fold, model, handlers));
      if (model.openKey === foldKey(fold.key)) rows.append(slotRow(model.openKey));
    }
  }
  if (total === 0 && model.folds.length === 0) {
    rows.append(createElement('li', { class: `${PANEL_CLASS}__empty` }, ['No review comments yet.']));
  }

  const panel = createElement('section', { class: PANEL_CLASS, [OWN_UI_ATTRIBUTE]: '', [ATTR_PANEL]: '', [ATTR_SIG]: signature, 'aria-label': 'Geld review digest' }, [
    header,
    rows,
  ]);
  const request = requestRow(model, handlers);
  const footerBits: Node[] = [];
  if (request !== null) footerBits.push(request);
  if (model.truncated) footerBits.push(createElement('p', { class: `${PANEL_CLASS}__note` }, ['The summary was truncated; the rest of the discussion is still in the timeline.']));
  if (model.nudge) {
    const nudge = createElement('p', { class: `${PANEL_CLASS}__note` }, ['Add the Geld Action to this repository and this digest is ready before the page opens. ']);
    nudge.append(
      createElement('a', { href: 'https://www.geld.sh/how-it-works#summary', target: '_blank', rel: 'noreferrer' }, ['How']),
      document.createTextNode(' · '),
    );
    const dismiss = createElement('button', { type: 'button', class: `${PANEL_CLASS}__link` }, ['Dismiss']);
    dismiss.addEventListener('click', () => handlers.onDismissNudge());
    nudge.append(dismiss);
    footerBits.push(nudge);
  }
  if (footerBits.length > 0) panel.append(createElement('div', { class: `${PANEL_CLASS}__foot` }, footerBits));

  host.insertAdjacentElement('beforebegin', panel);
  return { root: panel, slot: panel.querySelector<HTMLElement>(`[${ATTR_SLOT}] > .${PANEL_CLASS}__slot-body`) };
}

export function unmountPanel(): void {
  restoreAll();
  document.querySelector(`.${PANEL_CLASS}[${ATTR_PANEL}]`)?.remove();
}

export function digestText(meta: GeldPrMeta): string {
  const lines = [
    `Geld review: ${doneItemCount(meta.items)} of ${meta.items.length} done.`,
    ...meta.bots.map((bot) => verdictLabel(bot)),
    '',
    ...splitItems(meta.items).open.map((item) => {
      const loc = item.path === undefined ? '' : item.line === undefined ? ` (${item.path})` : ` (${item.path}:${item.line})`;
      return `- [ ] ${item.title}${loc}`;
    }),
    ...splitItems(meta.items).done.map((item) => {
      const loc = item.path === undefined ? '' : item.line === undefined ? ` (${item.path})` : ` (${item.path}:${item.line})`;
      return `- [x] ${item.title}${loc}`;
    }),
  ];
  return lines.join('\n');
}
