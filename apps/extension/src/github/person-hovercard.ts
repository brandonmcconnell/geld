import type { BlockedBy } from './blocked-list';
import { createElement, OWN_UI_ATTRIBUTE, svgFromString } from './dom';
import { pageFetch } from './page-fetch';
import { ICON_BLOCKED, ICON_EYE_CLOSED } from './ui/icons';

/**
 * GitHub's user hovercard for a blocked or hidden person says so, and offers
 * what GitHub would: "Hide their comments" for a blocked person whose comments
 * GitHub still shows (GitHub offers hiding them all only while blocking, so
 * Geld presses GitHub's own Hide on each of their comments on the page, with
 * the reason the reader picks), and Unhide for someone whose comments GitHub
 * hid. The card is one shared element GitHub refills per hover, so it is
 * dressed whenever it shows a login Geld knows.
 */

const ATTR_CARD = 'data-geld-person-card';
const ATTR_OFFERS = 'data-geld-person-card-offers';

/** The reasons GitHub's Hide form offers (`classifier`), in its order and words. */
const HIDE_REASONS: readonly { readonly value: string; readonly label: string }[] = [
  { value: 'SPAM', label: 'Spam' },
  { value: 'ABUSE', label: 'Abuse' },
  { value: 'OFF_TOPIC', label: 'Off Topic' },
  { value: 'OUTDATED', label: 'Outdated' },
  { value: 'DUPLICATE', label: 'Duplicate' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'LOW_QUALITY', label: 'Low Quality' },
];

export interface PersonCard {
  /** "Blocked by you", "On your hidden list in Geld"… */
  readonly words: string;
  readonly blocked: BlockedBy | null;
  /** GitHub's Hide forms for their comments GitHub still shows on this page (only those the reader may hide). */
  readonly hideForms: () => readonly HTMLFormElement[];
  /** Unhides their hidden comments through GitHub's own Unhide; null when GitHub offers the reader none. */
  readonly unhide: (() => void) | null;
}

let people: ReadonlyMap<string, PersonCard> = new Map();
let watched: Element | null = null;
let observer: MutationObserver | null = null;

/** The Hide form's fields with the reason set, as GitHub's own form would send them. */
function hideBody(form: HTMLFormElement, reason: string): URLSearchParams {
  const body = new URLSearchParams();
  for (const input of form.querySelectorAll('input[name]')) body.append(input.getAttribute('name') ?? '', input.getAttribute('value') ?? '');
  const select = form.querySelector('select[name]');
  body.set(select?.getAttribute('name') ?? 'classifier', reason);
  return body;
}

async function hideAll(forms: readonly HTMLFormElement[], reason: string): Promise<boolean> {
  for (const form of forms) {
    const action = form.getAttribute('action');
    if (action === null) return false;
    const response = await pageFetch(action, { method: 'POST', body: hideBody(form, reason), credentials: 'same-origin', headers: { Accept: 'text/html', 'X-Requested-With': 'XMLHttpRequest' } }).catch(() => null);
    if (response === null || !response.ok) return false;
  }
  return true;
}

function dress(card: Element): void {
  const url = (card.getAttribute('data-hovercard-target-url') ?? '').toLowerCase();
  const login = /^\/users\/([^/]+)\/hovercard/.exec(url)?.[1];
  const existing = card.querySelector(`[${ATTR_CARD}]`);
  const person = login === undefined ? undefined : people.get(decodeURIComponent(login));
  if (person === undefined) {
    existing?.remove();
    return;
  }
  const forms = person.blocked !== null ? person.hideForms() : [];
  const unhide = person.unhide;
  // The card is made again when what it offers changes (an Unhide form landing after it opened), never otherwise.
  const offers = `${forms.length}:${unhide === null ? '' : 'unhide'}`;
  if (existing !== null && existing.getAttribute(ATTR_CARD) === login && existing.getAttribute(ATTR_OFFERS) === offers) return;
  const picker = forms.length > 0 ? existing?.querySelector('.geld-person-card__picker') ?? null : null;
  existing?.remove();
  const rows = card.querySelector('.Popover-message .position-relative') ?? card.querySelector('.Popover-message');
  if (rows === null || rows.childElementCount === 0 || login === undefined) return;
  // Signed in, GitHub's own card already says "You and the <org> organization have blocked this user": no second line then.
  const githubSaysBlocked = /\bhave blocked this user\b|\bhas blocked this user\b/i.test(rows.textContent ?? '');
  const label = person.blocked !== null && githubSaysBlocked ? null : createElement('div', { class: 'geld-person-card__label' }, [svgFromString(person.blocked !== null ? ICON_BLOCKED : ICON_EYE_CLOSED), createElement('span', {}, [person.words])]);
  const actions = createElement('div', { class: 'geld-person-card__actions' });
  if (picker !== null) actions.append(picker);
  else if (forms.length > 0) {
    const hide = createElement('button', { type: 'button', class: 'btn btn-sm' }, [forms.length === 1 ? 'Hide their comment' : `Hide their ${forms.length} comments`]);
    hide.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const select = createElement('select', { class: 'form-select select-sm', 'aria-label': 'Reason for hiding' }, [
        createElement('option', { value: '' }, ['Choose a reason']),
        ...HIDE_REASONS.map((reason) => createElement('option', { value: reason.value }, [reason.label])),
      ]);
      const go = createElement('button', { type: 'button', class: 'btn btn-sm btn-danger', disabled: '' }, ['Hide']);
      select.addEventListener('change', () => go.toggleAttribute('disabled', select.value === ''));
      go.addEventListener('click', (goEvent) => {
        goEvent.preventDefault();
        goEvent.stopPropagation();
        const reason = select.value;
        const latest = person.hideForms();
        if (reason === '' || latest.length === 0) return;
        if (!window.confirm(`Hide ${latest.length === 1 ? 'their comment' : `all ${latest.length} of their comments`} on this page for everyone?\n\nGitHub will show ${latest.length === 1 ? 'it' : 'them'} as marked as ${select.selectedOptions[0]?.textContent?.toLowerCase() ?? reason.toLowerCase()}, and you can unhide ${latest.length === 1 ? 'it' : 'them'} later.`)) return;
        go.setAttribute('disabled', '');
        void hideAll(latest, reason).then((ok) => {
          if (ok) location.reload();
          else {
            go.removeAttribute('disabled');
            window.alert('GitHub did not hide every comment. Try GitHub’s own Hide on the rest.');
          }
        });
      });
      hide.replaceWith(createElement('span', { class: 'geld-person-card__picker' }, [select, go]));
    });
    actions.append(hide);
  }
  if (unhide !== null) {
    const button = createElement('button', { type: 'button', class: 'btn btn-sm' }, ['Unhide']);
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      unhide();
    });
    actions.append(button);
  }
  if (label === null && actions.childElementCount === 0) return;
  rows.append(createElement('div', { class: 'geld-person-card', [ATTR_CARD]: login, [ATTR_OFFERS]: offers, [OWN_UI_ATTRIBUTE]: '' }, [...(label === null ? [] : [label]), ...(actions.childElementCount > 0 ? [actions] : [])]));
}

/** The people whose hovercard Geld dresses, by lowercased login; called on every pass. */
export function syncPersonHovercards(next: ReadonlyMap<string, PersonCard>): void {
  people = next;
  const card = document.querySelector('.js-hovercard-content');
  if (card !== null && card !== watched) {
    observer?.disconnect();
    watched = card;
    observer = new MutationObserver(() => {
      if (watched !== null) dress(watched);
    });
    observer.observe(card, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-hovercard-target-url'] });
  }
  if (card !== null) dress(card);
}

export function removePersonHovercards(): void {
  people = new Map();
  observer?.disconnect();
  observer = null;
  watched = null;
  for (const node of document.querySelectorAll(`[${ATTR_CARD}]`)) node.remove();
}
