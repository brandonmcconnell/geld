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

import type { BotVerdictRecord, GeldPrMeta, ReviewItem } from '@geld/review';
import { botTitle, doneItemCount, isOpenStatus } from '@geld/review';
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
  ICON_REPLY,
  ICON_SYNC,
  ICON_X_CIRCLE_FILL,
} from '../ui/icons';
import { authorLabels, botDetail, botHealth, checksHealth, checksSummary, checksTotal, isCurrent, reviewsHealth, splitItems, statusBadge, verdictLabel } from './panel-model';
import type { CheckCounts, Health, InstalledBot, RequiredReviews } from './panel-model';
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
  readonly requestable: readonly InstalledBot[];
  /** Bot run summaries (verdict comments) an open item can link to, by bot id. */
  readonly summaryAnchorFor: (botId: string) => string | null;
  /** The page's icon for a bot (from its `/apps/` link or comments). */
  readonly botIconFor: (botId: string) => string | null;
  /** CI checks as the merge box reports them; null when the page has no checks section. */
  readonly checks: CheckCounts | null;
  readonly reviews: RequiredReviews | null;
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
  /** Post the trigger comment of each bot, in order. */
  readonly onRequest: (botIds: readonly string[]) => void;
  /** Show the comment at `anchor` where the reader is: inside compact view when it is folded there, else in the timeline. */
  readonly onOpenAnchor: (anchor: string) => void;
}

export function itemKey(id: string): string {
  return `item:${id}`;
}

export function foldKey(key: string): string {
  return `fold:${key}`;
}

/** Row key for the CI checks row; its slot shows GitHub's own checks section. */
export const CHECKS_KEY = 'checks';
const NUDGE_CLASS = 'geld-review-nudge';

function icon(markup: string): SVGElement {
  return svgFromString(markup);
}

function iconButton(markup: string, label: string, extra: Readonly<Record<string, string>> = {}): HTMLButtonElement {
  return createElement('button', { type: 'button', class: `${PANEL_CLASS}__icon`, 'aria-label': label, title: label, ...extra }, [icon(markup)]);
}

/**
 * The panel is rebuilt on every change, so the control the user just used
 * is a new element. Each focusable control carries a stable key; after a
 * rebuild focus returns to the same key (without scrolling). Besides being
 * right for keyboard users, the focused element is the browser's preferred
 * scroll anchor, which keeps the row under the pointer put while the
 * content that opened under it settles.
 */
const ATTR_FOCUS = 'data-geld-focus';

function focusKeyOf(root: Element | null): string | null {
  if (root === null) return null;
  const active = document.activeElement;
  if (!(active instanceof Element) || !root.contains(active)) return null;
  return active.closest(`[${ATTR_FOCUS}]`)?.getAttribute(ATTR_FOCUS) ?? null;
}

function restoreFocus(root: Element, key: string | null): void {
  if (key === null) return;
  const target = root.querySelector<HTMLElement>(`[${ATTR_FOCUS}="${key}"]`);
  target?.focus({ preventScroll: true });
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

function menu(entries: readonly MenuEntry[], focusKey: string): HTMLElement {
  const details = createElement('details', { class: `${PANEL_CLASS}__menu` });
  const summary = createElement('summary', { class: `${PANEL_CLASS}__icon`, 'aria-label': 'More actions', title: 'More actions', role: 'button', [ATTR_FOCUS]: `menu:${focusKey}` }, [icon(ICON_KEBAB_HORIZONTAL)]);
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

  const status = createElement(
    'button',
    { type: 'button', class: `${PANEL_CLASS}__status`, 'aria-label': done ? 'Reopen' : 'Mark done', title: done ? 'Reopen' : 'Mark done', 'aria-pressed': String(done), [ATTR_FOCUS]: `status:${key}` },
    [statusIcon(item)],
  );
  status.addEventListener('click', (event) => {
    event.stopPropagation();
    handlers.onStatus(item.id, !done);
  });

  const detailBits: string[] = [];
  if (item.path !== undefined) detailBits.push(item.line === undefined ? item.path : `${item.path}:${item.line}`);
  detailBits.push(authorLabels(item).join(', '));
  if (item.sources.length > 1) detailBits.push(`${item.sources.length} comments`);
  const pending = model.aiPending.has(item.id);
  const main = createElement('button', { type: 'button', class: `${PANEL_CLASS}__main`, 'aria-expanded': String(open), [ATTR_FOCUS]: `main:${key}` }, [
    createElement('span', { class: `${PANEL_CLASS}__title`, ...(pending ? { 'data-pending': '', title: 'Geld is consolidating this item' } : {}) }, [item.title]),
    createElement('span', { class: `${PANEL_CLASS}__detail` }, [detailBits.join(' — ')]),
  ]);
  main.addEventListener('click', () => handlers.onToggle(key));

  const right = createElement('span', { class: `${PANEL_CLASS}__right` });
  if (item.rewritten) right.append(createElement('span', { class: `${PANEL_CLASS}__ai`, title: 'Title written by Geld from the sources' }, ['AI']));
  const badge = statusBadge(item.status);
  if (badge !== null) right.append(createElement('span', { class: `${PANEL_CLASS}__pill`, 'data-badge': item.status }, [badge]));
  const reply = iconButton(ICON_REPLY, 'Reply', { [ATTR_FOCUS]: `reply:${key}` });
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
  right.append(reply, menu(entries, key), chevron(open));

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
  const main = createElement('button', { type: 'button', class: `${PANEL_CLASS}__main`, 'aria-expanded': String(open), [ATTR_FOCUS]: `main:${key}` }, [
    createElement('span', { class: `${PANEL_CLASS}__title ${PANEL_CLASS}__title--plain` }, [fold.label]),
  ]);
  main.addEventListener('click', () => handlers.onToggle(key));
  const right = createElement('span', { class: `${PANEL_CLASS}__right` });
  if (fold.firstAnchor !== null) {
    const anchor = fold.firstAnchor;
    right.append(menu([{ label: 'Show in timeline', href: `#${anchor}` }, { label: 'Copy link', onSelect: () => handlers.onCopyLink(anchor) }], key));
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
  const hasSummary = item.sources.some((source) => source.bot !== undefined && model.summaryAnchorFor(source.bot) !== null);
  if (item.context === undefined && fix === null && !hasSummary) return null;
  const notes = createElement('div', { class: `${PANEL_CLASS}__notes` });
  if (item.context !== undefined) notes.append(createElement('p', { class: `${PANEL_CLASS}__context` }, [item.context]));
  const summaryLinks: Node[] = [];
  for (const botId of new Set(item.sources.flatMap((source) => (source.bot === undefined ? [] : [source.bot])))) {
    const anchor = model.summaryAnchorFor(botId);
    if (anchor === null) continue;
    const label = botTitle(botId, item.sources.find((source) => source.bot === botId)?.author ?? botId);
    if (summaryLinks.length > 0) summaryLinks.push(document.createTextNode(' · '));
    const link = createElement('a', { class: `${PANEL_CLASS}__link`, href: `#${anchor}` }, [`${label}'s review summary`]);
    link.addEventListener('click', (event) => {
      event.preventDefault();
      handlers.onOpenAnchor(anchor);
    });
    summaryLinks.push(link);
  }
  if (summaryLinks.length > 0) notes.append(createElement('p', { class: `${PANEL_CLASS}__summaries` }, summaryLinks));
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
  const button = createElement('button', { type: 'button', class: `${PANEL_CLASS}__group-btn`, 'aria-expanded': String(!collapsed), [ATTR_FOCUS]: `group:${id}` }, [
    createElement('span', {}, [label]),
    icon(ICON_CHEVRON_DOWN),
  ]);
  button.addEventListener('click', () => handlers.onToggleGroup(id));
  return createElement('li', { class: `${PANEL_CLASS}__group`, 'data-group': id }, [button]);
}

function plural(count: number, noun: string, nounPlural = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : nounPlural}`;
}




/* ---- status rows: review bots · CI checks · required reviews -------------- */

const HEALTH_ICON: Readonly<Record<Health, string>> = {
  good: ICON_CHECK_CIRCLE_FILL,
  warn: ICON_DOT_FILL,
  bad: ICON_X_CIRCLE_FILL,
  pending: ICON_DOT_FILL,
};

function healthGlyph(health: Health, label: string): HTMLElement {
  return createElement('span', { class: `${PANEL_CLASS}__health`, 'data-health': health, role: 'img', 'aria-label': label, title: label }, [icon(HEALTH_ICON[health])]);
}

function anchorLink(anchor: string, label: string, handlers: PanelHandlers, children: Node[]): HTMLElement {
  const link = createElement('a', { class: `${PANEL_CLASS}__bot`, href: `#${anchor}`, title: label }, children);
  link.addEventListener('click', (event) => {
    event.preventDefault();
    handlers.onOpenAnchor(anchor);
  });
  return link;
}

/** One bot: its icon, name, detail and a traffic-light glyph; clicking opens its run summary where the reader is. */
function botChip(bot: BotVerdictRecord, model: PanelModel, handlers: PanelHandlers): HTMLElement {
  const health = botHealth(bot);
  const current = isCurrent(bot, model.meta.headSha);
  const label = `${verdictLabel(bot)}${current ? '' : ' (earlier commit)'}`;
  const children: Node[] = [];
  const iconSrc = model.botIconFor(bot.id);
  if (iconSrc !== null) children.push(createElement('img', { class: `${PANEL_CLASS}__bot-icon`, src: iconSrc, alt: '', width: '16', height: '16' }));
  children.push(createElement('span', { class: `${PANEL_CLASS}__bot-name` }, [botTitle(bot.id, bot.login)]));
  children.push(createElement('span', { class: `${PANEL_CLASS}__bot-detail` }, [botDetail(bot)]));
  children.push(healthGlyph(health, label));
  if (bot.sourceId !== undefined) return anchorLink(bot.sourceId, label, handlers, children);
  return createElement('span', { class: `${PANEL_CLASS}__bot`, title: label, ...(current ? {} : { 'data-current': 'false' }) }, children);
}

/** Re-run menu: one entry per installed bot plus All; choosing one turns the menu into a confirm. */
function rerunMenu(model: PanelModel, handlers: PanelHandlers): HTMLElement | null {
  if (model.requestable.length === 0) return null;
  const details = createElement('details', { class: `${PANEL_CLASS}__menu` });
  const summary = createElement('summary', { class: `${PANEL_CLASS}__icon`, 'aria-label': 'Request a review', title: 'Request a review', role: 'button', [ATTR_FOCUS]: 'rerun' }, [icon(ICON_SYNC)]);
  summary.addEventListener('click', (event) => event.stopPropagation());
  const list = createElement('div', { class: `${PANEL_CLASS}__menu-list`, role: 'menu' });
  const choices: ReadonlyArray<{ readonly label: string; readonly ids: readonly string[]; readonly prompt: string; readonly iconSrc: string | null }> = [
    ...model.requestable.map((bot) => ({ label: `Re-run ${bot.label}`, ids: [bot.id], prompt: `Post “${bot.trigger}”?`, iconSrc: bot.iconSrc })),
    ...(model.requestable.length > 1
      ? [{ label: 'Re-run all', ids: model.requestable.map((bot) => bot.id), prompt: `Post ${model.requestable.length} comments: ${model.requestable.map((bot) => `“${bot.trigger}”`).join(', ')}?`, iconSrc: null }]
      : []),
  ];
  const render = (): void => {
    list.replaceChildren(
      createElement('div', { class: `${PANEL_CLASS}__menu-title` }, ['Request a review']),
      ...choices.map((choice) => {
        const item = createElement('button', { type: 'button', class: `${PANEL_CLASS}__menu-item`, role: 'menuitem' });
        if (choice.iconSrc !== null) item.append(createElement('img', { class: `${PANEL_CLASS}__bot-icon`, src: choice.iconSrc, alt: '', width: '16', height: '16' }));
        item.append(createElement('span', {}, [choice.label]));
        item.addEventListener('click', (event) => {
          event.stopPropagation();
          const yes = createElement('button', { type: 'button', class: `${PANEL_CLASS}__menu-item ${PANEL_CLASS}__menu-item--primary`, role: 'menuitem' }, ['Post comment']);
          const no = createElement('button', { type: 'button', class: `${PANEL_CLASS}__menu-item`, role: 'menuitem' }, ['Cancel']);
          yes.addEventListener('click', (inner) => {
            inner.stopPropagation();
            details.removeAttribute('open');
            render();
            handlers.onRequest(choice.ids);
          });
          no.addEventListener('click', (inner) => {
            inner.stopPropagation();
            render();
          });
          list.replaceChildren(createElement('div', { class: `${PANEL_CLASS}__menu-title` }, [choice.prompt]), yes, no);
          yes.focus({ preventScroll: true });
        });
        return item;
      }),
    );
  };
  render();
  details.addEventListener('toggle', () => {
    if (!details.hasAttribute('open')) render();
  });
  details.append(summary, list);
  return details;
}

/** GitHub's own status ring: one arc per state, in its colours, drawn around a 16px circle. */
function checksRing(counts: CheckCounts): SVGElement {
  const total = checksTotal(counts);
  const r = 6;
  const circumference = 2 * Math.PI * r;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add(`${PANEL_CLASS}__ring`);
  let offset = 0;
  const segments: ReadonlyArray<readonly [keyof CheckCounts, number]> = [
    ['success', counts.success],
    ['failure', counts.failure],
    ['pending', counts.pending],
    ['skipped', counts.skipped],
    ['neutral', counts.neutral],
  ];
  for (const [state, count] of segments) {
    if (count === 0 || total === 0) continue;
    const length = (count / total) * circumference;
    const arc = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    arc.setAttribute('cx', '8');
    arc.setAttribute('cy', '8');
    arc.setAttribute('r', String(r));
    arc.setAttribute('fill', 'none');
    arc.setAttribute('stroke-width', '2.5');
    arc.setAttribute('stroke-dasharray', `${length} ${circumference - length}`);
    arc.setAttribute('stroke-dashoffset', String(-offset));
    arc.setAttribute('transform', 'rotate(-90 8 8)');
    arc.setAttribute('data-state', state);
    svg.append(arc);
    offset += length;
  }
  return svg;
}

function statusRow(label: string, lead: Node, content: Node[], right: Node[], extra: Readonly<Record<string, string>> = {}): HTMLElement {
  return createElement('li', { class: `${PANEL_CLASS}__row ${PANEL_CLASS}__row--status`, ...extra }, [
    createElement('span', { class: `${PANEL_CLASS}__status ${PANEL_CLASS}__status--muted`, 'aria-hidden': 'true' }, [lead]),
    createElement('span', { class: `${PANEL_CLASS}__label` }, [label]),
    createElement('span', { class: `${PANEL_CLASS}__status-content` }, content),
    createElement('span', { class: `${PANEL_CLASS}__right` }, right),
  ]);
}

function statusRows(model: PanelModel, handlers: PanelHandlers): HTMLElement | null {
  const rows = createElement('ul', { class: `${PANEL_CLASS}__rows ${PANEL_CLASS}__rows--status`, role: 'list' });
  if (model.meta.bots.length > 0 || model.requestable.length > 0) {
    const worst: Health = model.meta.bots.map(botHealth).reduce<Health>((acc, health) => (acc === 'bad' || health === 'bad' ? 'bad' : acc === 'warn' || health === 'warn' ? 'warn' : acc === 'pending' || health === 'pending' ? 'pending' : 'good'), 'good');
    const chips = model.meta.bots.map((bot) => botChip(bot, model, handlers));
    const menu = rerunMenu(model, handlers);
    rows.append(
      statusRow(
        'Review bots',
        icon(HEALTH_ICON[model.meta.bots.length === 0 ? 'pending' : worst]),
        chips.length === 0 ? [createElement('span', { class: `${PANEL_CLASS}__detail` }, ['No reviews yet'])] : chips,
        menu === null ? [] : [menu],
        { 'data-health': model.meta.bots.length === 0 ? 'pending' : worst },
      ),
    );
  }
  if (model.checks !== null) {
    const health = checksHealth(model.checks);
    const open = model.openKey === CHECKS_KEY;
    const main = createElement('button', { type: 'button', class: `${PANEL_CLASS}__main`, 'aria-expanded': String(open), [ATTR_FOCUS]: `main:${CHECKS_KEY}` }, [
      createElement('span', { class: `${PANEL_CLASS}__title ${PANEL_CLASS}__title--plain` }, [`${checksTotal(model.checks)} checks`]),
      createElement('span', { class: `${PANEL_CLASS}__detail` }, [checksSummary(model.checks)]),
    ]);
    main.addEventListener('click', () => handlers.onToggle(CHECKS_KEY));
    const row = createElement('li', { class: `${PANEL_CLASS}__row ${PANEL_CLASS}__row--status`, 'data-health': health }, [
      createElement('span', { class: `${PANEL_CLASS}__status ${PANEL_CLASS}__status--muted`, 'aria-hidden': 'true' }, [checksRing(model.checks)]),
      createElement('span', { class: `${PANEL_CLASS}__label` }, ['CI checks']),
      main,
      createElement('span', { class: `${PANEL_CLASS}__right` }, [healthGlyph(health, checksSummary(model.checks)), chevron(open)]),
    ]);
    if (open) row.setAttribute('data-open', '');
    rows.append(row);
    if (open) rows.append(slotRow(CHECKS_KEY));
  }
  if (model.reviews !== null) {
    const health = reviewsHealth(model.reviews);
    const marks = createElement('span', { class: `${PANEL_CLASS}__marks`, 'aria-hidden': 'true' });
    for (let index = 0; index < Math.max(model.reviews.required, model.reviews.approvals); index += 1) {
      marks.append(createElement('span', { class: `${PANEL_CLASS}__mark`, 'data-done': String(index < model.reviews.approvals) }, [icon(index < model.reviews.approvals ? ICON_CHECK : ICON_CIRCLE)]));
    }
    const text = model.reviews.changesRequested ? 'changes requested' : `${model.reviews.approvals}/${model.reviews.required} approvals`;
    rows.append(
      statusRow(
        'Reviews',
        icon(ICON_COMMENT_DISCUSSION),
        [createElement('span', { class: `${PANEL_CLASS}__detail` }, [text]), marks],
        [healthGlyph(health, text)],
        { 'data-health': health },
      ),
    );
  }
  return rows.childElementCount === 0 ? null : rows;
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
    bots: model.meta.bots.map((bot) => `${bot.id}:${bot.verdict}:${bot.count ?? ''}:${bot.score ?? ''}:${bot.severity ?? ''}:${bot.reviewedSha}:${bot.sourceId ?? ''}`),
    reviewers: model.meta.reviewers.map((reviewer) => `${reviewer.login}:${reviewer.state}`),
    folds: model.folds.map((fold) => `${fold.key}:${fold.count}:${fold.avatarSrc ?? ''}`),
    requestable: model.requestable.map((bot) => `${bot.id}:${bot.iconSrc ?? ''}`),
    checks: model.checks,
    reviews: model.reviews,
    icons: model.meta.bots.map((bot) => model.botIconFor(bot.id) ?? ''),
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
  const focusKey = focusKeyOf(existing);
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
  const tools = createElement('div', { class: `${PANEL_CLASS}__tools` });
  const copy = iconButton(ICON_COPY, 'Copy digest as Markdown', { [ATTR_FOCUS]: 'copy' });
  copy.addEventListener('click', () => handlers.onCopy());
  tools.append(copy);
  const head = createElement('div', { class: `${PANEL_CLASS}__head` }, [summary, tools]);
  const status = statusRows(model, handlers);
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
    ...(status === null ? [] : [status]),
    ...(tldr === null ? [] : [tldr]),
    rows,
  ]);

  /* Footer */
  if (model.truncated) {
    panel.append(createElement('div', { class: `${PANEL_CLASS}__foot` }, [createElement('p', { class: `${PANEL_CLASS}__note` }, ['The summary was truncated; the rest of the discussion is still in the timeline.'])]));
  }
  if (model.compacting && (model.hiddenCount > 0 || model.fullTimeline)) {
    // The one control for the timeline itself, shaped like GitHub's own "N hidden items · Load more" bar.
    const toggle = createElement('button', { type: 'button', class: `${PANEL_CLASS}__timeline-btn`, 'aria-pressed': String(model.fullTimeline), [ATTR_FOCUS]: 'timeline' }, [
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
  // Below the box, not in it: a quiet, persistent pointer to the Action while this repository lacks it.
  document.querySelector(`.${NUDGE_CLASS}`)?.remove();
  if (model.nudge) {
    const nudge = createElement('p', { class: NUDGE_CLASS, [OWN_UI_ATTRIBUTE]: '' }, ['Built from this page. Add the Geld Action to this repository and the digest is ready before the page opens — ']);
    nudge.append(createElement('a', { href: 'https://www.geld.sh/how-it-works#summary', target: '_blank', rel: 'noreferrer' }, ['how']), document.createTextNode('.'));
    nudge.style.marginLeft = cardStyle.marginLeft;
    nudge.style.marginRight = cardStyle.marginRight;
    panel.insertAdjacentElement('afterend', nudge);
  }
  restoreFocus(panel, focusKey);
  return { root: panel, slot: panel.querySelector<HTMLElement>(`[${ATTR_SLOT}] > .${PANEL_CLASS}__slot-body`) };
}

export function unmountPanel(): void {
  restoreAll();
  document.querySelector(`.${PANEL_CLASS}[${ATTR_PANEL}]`)?.remove();
  document.querySelector(`.${NUDGE_CLASS}`)?.remove();
  for (const card of document.querySelectorAll(`[${ATTR_ATTACHED}]`)) card.removeAttribute(ATTR_ATTACHED);
}

