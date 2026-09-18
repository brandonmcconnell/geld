/**
 * Review digest panel inserted below the PR description. Hidden comment
 * content *is* the panel, so the original Geld comment is folded away.
 */

import type { BotVerdictRecord, GeldPrMeta, ReviewItem } from '@geld/review';
import { botTitle, doneItemCount, isOpenStatus, openItemCount, rerunTriggerFor } from '@geld/review';
import { createElement, OWN_UI_ATTRIBUTE } from '../dom';

export const PANEL_CLASS = 'geld-review-panel';
export const ATTR_PANEL = 'data-geld-review-panel';

export interface PanelHandlers {
  readonly onToggleItem: (id: string) => void;
  readonly onTick: (id: string, checked: boolean) => void;
  readonly onCopy: () => void;
  readonly onFullTimeline: () => void;
  readonly onRerun: (botId: string) => void;
  readonly onDismissNudge: () => void;
  readonly onShowInTimeline: (anchor: string) => void;
}

export interface PanelModel {
  readonly meta: GeldPrMeta;
  readonly freshness: 'fresh' | 'stale' | 'partial' | 'local';
  readonly truncated: boolean;
  readonly openItemId: string | null;
  readonly fullTimeline: boolean;
  readonly nudge: boolean;
  readonly viewingAnchor: string | null;
}

function severityClass(severity: ReviewItem['severity']): string {
  return `geld-review-item--${severity}`;
}

function botLine(bot: BotVerdictRecord, headSha: string): string {
  const title = botTitle(bot.id, bot.login);
  const current = bot.reviewedSha.toLowerCase() === headSha.toLowerCase() || headSha.toLowerCase().startsWith(bot.reviewedSha.toLowerCase());
  const tag = current ? 'current' : 'behind';
  if (bot.verdict === 'clean') return `${title} clean (${tag})`;
  if (bot.verdict === 'running') return `${title} running (${tag})`;
  if (bot.verdict === 'failed') return `${title} failed (${tag})`;
  if (bot.score !== undefined) return `${title} ${bot.score}/5 (${tag})`;
  if (bot.count !== undefined) return `${title} ${bot.count} issue${bot.count === 1 ? '' : 's'} (${tag})`;
  return `${title} findings (${tag})`;
}

function freshnessLabel(freshness: PanelModel['freshness']): string | null {
  if (freshness === 'stale' || freshness === 'partial') return 'Updating…';
  if (freshness === 'local') return 'From this page';
  return null;
}

function itemRow(item: ReviewItem, open: boolean, handlers: PanelHandlers): HTMLElement {
  const checked = !isOpenStatus(item.status);
  const box = createElement('input', { type: 'checkbox', class: 'geld-review-item__check' });
  box.checked = checked;
  box.addEventListener('click', (event) => {
    event.stopPropagation();
    handlers.onTick(item.id, box.checked);
  });
  const title = createElement('span', { class: 'geld-review-item__title' }, [item.title]);
  const meta: string[] = [];
  if (item.path !== undefined) meta.push(item.line === undefined ? item.path : `${item.path}:${item.line}`);
  meta.push(item.sources.map((source) => (source.bot !== undefined ? botTitle(source.bot, source.author) : `@${source.author}`)).join(', '));
  const details = createElement('p', { class: 'geld-review-item__meta' }, [meta.join(' · ')]);
  const sources = createElement(
    'p',
    { class: 'geld-review-item__sources' },
    item.sources.flatMap((source, index) => {
      const link = createElement('a', { href: `#${source.anchor}`, class: 'geld-review-item__source' }, ['source']);
      return index === 0 ? [link] : [document.createTextNode(' · '), link];
    }),
  );
  const body = createElement('div', { class: 'geld-review-item__body' }, [title, details, sources]);
  const row = createElement('div', { class: `geld-review-item ${severityClass(item.severity)}`, 'data-geld-item': item.id }, [box, body]);
  if (open) row.setAttribute('data-open', '');
  row.addEventListener('click', () => handlers.onToggleItem(item.id));
  return row;
}

function descriptionAnchor(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>('.js-discussion > .js-comment-container') ??
    document.querySelector<HTMLElement>('#discussion_bucket .js-comment-container') ??
    document.querySelector<HTMLElement>('[data-testid="issue-body"]') ??
    document.querySelector<HTMLElement>('.timeline-comment')
  );
}

function panelSignature(model: PanelModel): string {
  return JSON.stringify({
    freshness: model.freshness,
    truncated: model.truncated,
    openItemId: model.openItemId,
    fullTimeline: model.fullTimeline,
    nudge: model.nudge,
    viewingAnchor: model.viewingAnchor,
    generatedAt: model.meta.generatedAt,
    headSha: model.meta.headSha,
    items: model.meta.items.map((item) => `${item.id}:${item.status}:${item.title}`),
    bots: model.meta.bots.map((bot) => `${bot.id}:${bot.verdict}:${bot.count ?? ''}:${bot.score ?? ''}`),
    reviewers: model.meta.reviewers.map((reviewer) => `${reviewer.login}:${reviewer.state}`),
  });
}

export function mountPanel(model: PanelModel, handlers: PanelHandlers): HTMLElement {
  const existing = document.querySelector<HTMLElement>(`.${PANEL_CLASS}`);
  const signature = panelSignature(model);
  if (existing !== null && existing.getAttribute('data-geld-review-sig') === signature) return existing;
  existing?.remove();
  const open = model.meta.items.filter((item) => isOpenStatus(item.status));
  const done = model.meta.items.filter((item) => !isOpenStatus(item.status));
  const header = createElement('div', { class: 'geld-review-panel__header' }, [
    createElement('strong', { class: 'geld-review-panel__title' }, ['Geld review']),
    createElement('span', { class: 'geld-review-panel__counts' }, [`${doneItemCount(model.meta.items)} of ${model.meta.items.length} done`]),
  ]);
  const updating = freshnessLabel(model.freshness);
  if (updating !== null) header.append(createElement('span', { class: 'geld-review-panel__fresh' }, [updating]));
  const bots = createElement(
    'p',
    { class: 'geld-review-panel__bots' },
    model.meta.bots.length === 0
      ? []
      : model.meta.bots.flatMap((bot, index) => {
          const phrase = document.createTextNode(botLine(bot, model.meta.headSha));
          const trigger = rerunTriggerFor(bot.id);
          const nodes: Array<Node> = index === 0 ? [phrase] : [document.createTextNode(' · '), phrase];
          if (trigger !== null) {
            const rerun = createElement('button', { type: 'button', class: 'geld-review-panel__rerun' }, ['Re-run']);
            rerun.addEventListener('click', (event) => {
              event.stopPropagation();
              handlers.onRerun(bot.id);
            });
            nodes.push(document.createTextNode(' '), rerun);
          }
          return nodes;
        }),
  );
  const toolbar = createElement('div', { class: 'geld-review-panel__toolbar' });
  const copy = createElement('button', { type: 'button', class: 'geld-review-panel__btn' }, ['Copy digest']);
  copy.addEventListener('click', () => handlers.onCopy());
  const timeline = createElement('button', { type: 'button', class: 'geld-review-panel__btn' }, [model.fullTimeline ? 'Compact timeline' : 'Show full timeline']);
  timeline.addEventListener('click', () => handlers.onFullTimeline());
  toolbar.append(copy, timeline);

  const list = createElement('div', { class: 'geld-review-panel__list' });
  if (open.length > 0) {
    list.append(createElement('p', { class: 'geld-review-panel__group' }, [`Open (${open.length})`]));
    for (const item of open) list.append(itemRow(item, item.id === model.openItemId, handlers));
  }
  if (done.length > 0) {
    list.append(createElement('p', { class: 'geld-review-panel__group' }, [`Done (${done.length})`]));
    for (const item of done) list.append(itemRow(item, item.id === model.openItemId, handlers));
  }
  if (model.meta.items.length === 0) {
    list.append(createElement('p', { class: 'geld-review-panel__empty' }, ['No review comments yet.']));
  }
  if (model.truncated) {
    list.append(createElement('p', { class: 'geld-review-panel__note' }, ['List truncated; remaining items are still in the timeline.']));
  }

  const reviewers =
    model.meta.reviewers.length === 0
      ? null
      : createElement(
          'p',
          { class: 'geld-review-panel__reviewers' },
          [
            model.meta.reviewers
              .map((reviewer) => {
                if (reviewer.state === 'approved') return `@${reviewer.login} approved`;
                if (reviewer.state === 'changes_requested') return `@${reviewer.login} requested changes`;
                if (reviewer.state === 'pending') return `@${reviewer.login} pending`;
                return `@${reviewer.login} commented`;
              })
              .join(' · '),
          ],
        );

  const panel = createElement('section', { class: PANEL_CLASS, [OWN_UI_ATTRIBUTE]: '', [ATTR_PANEL]: '', 'data-geld-review-sig': signature }, [
    header,
    bots,
    toolbar,
    list,
  ]);
  if (model.viewingAnchor !== null) {
    const viewing = createElement('p', { class: 'geld-review-panel__viewing' }, ['Viewing in Geld overview · ']);
    const show = createElement('button', { type: 'button', class: 'geld-review-panel__btn' }, ['show in timeline']);
    show.addEventListener('click', (event) => {
      event.stopPropagation();
      handlers.onShowInTimeline(model.viewingAnchor ?? '');
    });
    viewing.append(show);
    panel.prepend(viewing);
  }
  if (reviewers !== null) panel.append(reviewers);
  if (model.nudge) {
    const nudge = createElement('p', { class: 'geld-review-panel__nudge' }, [
      'Add the Geld action to this repo so this digest is ready before anyone opens the pull request. ',
    ]);
    const link = createElement('a', { href: 'https://www.geld.sh/how-it-works#summary', target: '_blank', rel: 'noreferrer' }, ['How']);
    const dismiss = createElement('button', { type: 'button', class: 'geld-review-panel__btn' }, ['Dismiss']);
    dismiss.addEventListener('click', () => handlers.onDismissNudge());
    nudge.append(link, document.createTextNode(' · '), dismiss);
    panel.append(nudge);
  }
  const host = descriptionAnchor();
  if (host?.parentElement !== undefined && host.parentElement !== null) host.insertAdjacentElement('afterend', panel);
  else document.body.prepend(panel);
  return panel;
}

export function unmountPanel(): void {
  document.querySelector(`.${PANEL_CLASS}`)?.remove();
}

export function digestText(meta: GeldPrMeta): string {
  const lines = [
    `Geld review: ${doneItemCount(meta.items)} of ${meta.items.length} done.`,
    ...meta.bots.map((bot) => botLine(bot, meta.headSha)),
    '',
    ...meta.items.map((item) => {
      const loc = item.path === undefined ? '' : item.line === undefined ? ` (${item.path})` : ` (${item.path}:${item.line})`;
      return `- [${isOpenStatus(item.status) ? ' ' : 'x'}] ${item.title}${loc}`;
    }),
  ];
  return lines.join('\n');
}

export function openItemCountOf(meta: GeldPrMeta): number {
  return openItemCount(meta.items);
}
