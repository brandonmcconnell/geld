/**
 * While the digest is off, a slim line under the description says so and
 * offers the three views, GitHub's timeline pressed. It stays for as long as the
 * digest is off: the digest is what Geld is growing into, and the way back in
 * should never be more than one click away.
 */

import type { DigestView } from '@geld/core';
import { digestViewPatch } from '@geld/core';
import { createElement, OWN_UI_ATTRIBUTE } from '../dom';
import { persist } from '../../lib/context';
import { settingsItem } from '../../lib/storage';
import { brandMark } from './brand';
import { viewChoice } from './digest-view';
import { ATTR_ATTACHED, ATTR_PANEL, PANEL_CLASS, descriptionCard } from './panel';
import { ATTR_VIEW_SUBTITLE, fitOffLineOnResize, OFF_SUBTITLE, OFF_TITLE } from './view-fit';
import { requestViewFocus, takeViewFocus } from './view-focus';

const BAR_CLASS = 'geld-digest-off';

/**
 * Store `view` (and that it was chosen), synced like every setting; the controller's settings watch applies it,
 * and focus follows to what stands for the view once it mounts: the off line for Timeline, else the panel.
 */
export function chooseDigestView(view: DigestView): void {
  const at = new Date().toISOString();
  const withdraw = requestViewFocus(view === 'github' ? 'off-line' : 'panel');
  persist(
    settingsItem.update((current) => digestViewPatch(current, view, at)).catch((error: unknown) => {
      withdraw();
      throw error;
    }),
  );
}

export function syncDigestOffBar(show: boolean): void {
  const card = show ? descriptionCard() : null;
  const existing = document.querySelector<HTMLElement>(`.${BAR_CLASS}`);
  if (card === null) {
    removeDigestOffBar();
    return;
  }
  if (existing !== null && existing.previousElementSibling === card && card.hasAttribute(ATTR_ATTACHED)) return;
  existing?.remove();
  for (const stale of document.querySelectorAll(`[${ATTR_ATTACHED}]`)) {
    if (stale !== card) stale.removeAttribute(ATTR_ATTACHED);
  }
  card.setAttribute(ATTR_ATTACHED, '');
  // The description card may hang past the timeline rail (`ml-n3`): the line shares its horizontal geometry, as the panel does.
  const cardStyle = getComputedStyle(card);
  const bar = createElement('section', { class: BAR_CLASS, [OWN_UI_ATTRIBUTE]: '', 'aria-label': 'Geld digest', [ATTR_VIEW_SUBTITLE]: 'hide' }, [
    brandMark(`${BAR_CLASS}__brand`),
    createElement('span', { class: `${BAR_CLASS}__text` }, [createElement('strong', {}, [OFF_TITLE]), createElement('span', { class: `${BAR_CLASS}__subtitle` }, [OFF_SUBTITLE])]),
    viewChoice('github', chooseDigestView),
  ]);
  bar.style.marginLeft = cardStyle.marginLeft;
  bar.style.marginRight = cardStyle.marginRight;
  card.insertAdjacentElement('afterend', bar);
  fitOffLineOnResize(bar);
  if (takeViewFocus('off-line')) {
    bar.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus({ preventScroll: true });
  }
}

export function removeDigestOffBar(): void {
  const bar = document.querySelector(`.${BAR_CLASS}`);
  if (bar === null) return;
  bar.remove();
  // The panel attaches to the same card; only the line's own attachment goes with it.
  if (document.querySelector(`.${PANEL_CLASS}[${ATTR_PANEL}]`) === null) {
    for (const card of document.querySelectorAll(`[${ATTR_ATTACHED}]`)) card.removeAttribute(ATTR_ATTACHED);
  }
}
