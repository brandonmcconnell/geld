/**
 * Quick view: the real timeline nodes of a row — a review thread with
 * every comment, its reactions, its per-comment ⋯ menus and the
 * collapsible reply box with Resolve; a bot's comment; an event row —
 * moved into the slot under the row (teleport.ts) and compacted by CSS.
 * GitHub sees its own DOM, so replying, resolving, reacting and editing
 * behave exactly as they do in the timeline. Inside a `<react-app>`
 * island the node is shown as a read-only clone instead.
 */

import { createElement } from '../dom';
import { teleportInto } from './teleport';

/** Fill `slot` with `nodes`. Returns false when a node could only be shown as a read-only clone. */
export function renderQuickView(slot: HTMLElement, nodes: readonly HTMLElement[]): boolean {
  const list = createElement('div', { class: 'geld-review__qv' });
  slot.replaceChildren(list);
  const live = teleportInto(list, nodes);
  if (list.childElementCount === 0) list.append(createElement('p', { class: 'geld-review__qv-empty' }, ['Not loaded on this page yet.']));
  return live;
}
