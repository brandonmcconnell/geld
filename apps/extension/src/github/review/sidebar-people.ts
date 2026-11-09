import { createElement, OWN_UI_ATTRIBUTE } from '../dom';
import { loginOfLink } from './login';

/**
 * Hidden people leave GitHub's own sidebar too: their row in Reviewers and
 * their picture in Participants are hidden (an attribute the stylesheet keys
 * on, GitHub's nodes left where they are), the participants heading counts
 * only who is left, and a section left with nobody reads as GitHub's own empty
 * state ("No reviews" on the conversation, "No reviewers" on the Overview; a
 * pull request always has its author as a participant, so Participants, which
 * GitHub never shows empty, goes whole). Nothing about the pull request's state
 * changes: GitHub's merge box still counts what GitHub counts.
 */

const ATTR_HIDDEN = 'data-geld-sidebar-hidden';
const ATTR_OWN = 'data-geld-sidebar-own';

const CLASSIC_REVIEWERS = 'form[id^="pull-request-reviewers-form"]';
const CLASSIC_PARTICIPANTS = '#partial-users-participants';
const OVERVIEW_REVIEWERS = 'section[aria-label="Reviewers"][data-overview-sidebar-item]';
const OVERVIEW_PARTICIPANTS = 'section[data-overview-sidebar-item][aria-label$=" participants" i], section[data-overview-sidebar-item][aria-label$=" participant" i]';
const PERSON = 'a[data-hovercard-url^="/users/"], [data-hovercard-url^="/users/"], a[href^="/apps/"]';

function setHidden(node: Element, hidden: boolean): void {
  if (hidden === node.hasAttribute(ATTR_HIDDEN)) return;
  node.toggleAttribute(ATTR_HIDDEN, hidden);
}

function loginOf(node: Element): string | null {
  const assignee = node.getAttribute('data-assignee-name') ?? node.querySelector('[data-assignee-name]')?.getAttribute('data-assignee-name');
  if (assignee !== null && assignee !== undefined && assignee !== '') return assignee;
  const link = node.matches(PERSON) ? node : (node.querySelector(PERSON) ?? (node.matches('a[href]') ? node : null));
  return link === null ? null : loginOfLink(link);
}

/** A reviewer row on the Overview: its name links to the profile (an App's to `/apps/<slug>`), with no hovercard attribute. */
function overviewLoginOf(row: Element): string | null {
  const link = row.querySelector('a[href]:has([class*="reviewerName"])');
  const name = (row.querySelector('[class*="reviewerName"]')?.textContent ?? '').trim();
  const app = /^\/apps\/([^/?#]+)/.exec(link?.getAttribute('href') ?? '')?.[1];
  if (app !== undefined) return /\[bot\]$/i.test(name) ? name : `${app}[bot]`;
  if (link !== null) return loginOfLink(link) ?? (name === '' ? null : name);
  return loginOf(row);
}

/** Geld's stand-in beside GitHub's node (an empty state, a recounted heading), written only when its words change. */
function standIn(anchor: Element, key: string, make: () => HTMLElement, text: string | null): void {
  const existing = anchor.parentElement?.querySelector(`:scope > [${ATTR_OWN}="${key}"]`) ?? null;
  if (text === null) {
    existing?.remove();
    return;
  }
  if (existing !== null) {
    if (existing.textContent !== text) existing.textContent = text;
    return;
  }
  const node = make();
  node.setAttribute(ATTR_OWN, key);
  node.setAttribute(OWN_UI_ATTRIBUTE, '');
  node.textContent = text;
  anchor.after(node);
}

/** The count GitHub's heading states ("1,483 participants"): GitHub shows only some of the pictures. */
function statedCount(heading: Element, pictures: number): number {
  const digits = /([\d,]+)\s+participants?/i.exec(heading.textContent ?? '')?.[1]?.replace(/,/g, '');
  const stated = digits === undefined ? Number.NaN : Number.parseInt(digits, 10);
  return Number.isNaN(stated) ? pictures : Math.max(stated, pictures);
}

function participantsHeading(count: number): string {
  return count === 1 ? '1 participant' : `${count} participants`;
}

function classicReviewers(hides: (login: string) => boolean): void {
  const form = document.querySelector(CLASSIC_REVIEWERS);
  if (form === null) return;
  const rows = [...form.querySelectorAll('[data-assignee-name]')].flatMap((name) => {
    const row = name.closest('.d-flex.flex-items-center') ?? name.parentElement;
    return row === null || row.closest('details-menu, .select-menu-modal') !== null ? [] : [row];
  });
  let shown = 0;
  for (const row of rows) {
    const login = loginOf(row);
    const hidden = login !== null && hides(login);
    setHidden(row, hidden);
    if (!hidden) shown += 1;
  }
  // The groups GitHub nests rows in ("Reviewers whose approvals may not affect merge requirements") go with their last row.
  for (const group of form.querySelectorAll(':scope details:not(.select-menu):not(#reviewers-select-menu)')) {
    const own = rows.filter((row) => group.contains(row));
    if (own.length > 0) setHidden(group, own.every((row) => row.hasAttribute(ATTR_HIDDEN)));
  }
  const menu = form.querySelector('#reviewers-select-menu') ?? form.firstElementChild;
  // GitHub's own empty state is a `span.css-truncate` reading "No reviews", and the same span holds the rows when there are any.
  const empty = rows.length > 0 && shown === 0;
  if (menu !== null) standIn(menu, 'reviewers-empty', () => createElement('span', { class: 'css-truncate' }), empty ? 'No reviews' : null);
}

function classicParticipants(hides: (login: string) => boolean): void {
  const item = document.querySelector(CLASSIC_PARTICIPANTS);
  const heading = item?.querySelector('.discussion-sidebar-heading') ?? null;
  if (item === null || heading === null) return;
  const avatars = [...item.querySelectorAll('.participant-avatar')];
  let hiddenCount = 0;
  for (const avatar of avatars) {
    const login = loginOf(avatar);
    const hidden = login !== null && hides(login);
    setHidden(avatar, hidden);
    if (hidden) hiddenCount += 1;
  }
  const left = statedCount(heading, avatars.length) - hiddenCount;
  setHidden(item, avatars.length > 0 && left <= 0);
  setHidden(heading, hiddenCount > 0);
  const tag = heading.tagName === 'DIV' ? 'div' : 'h3';
  standIn(heading, 'participants', () => createElement(tag, { class: heading.getAttribute('class') ?? 'discussion-sidebar-heading text-bold' }), hiddenCount > 0 && left > 0 ? participantsHeading(left) : null);
}

function overviewReviewers(hides: (login: string) => boolean): void {
  const section = document.querySelector(OVERVIEW_REVIEWERS);
  if (section === null) return;
  const rows = [...section.querySelectorAll('li')].filter((row) => row.matches('[class*="reviewerRow"]') || row.querySelector(PERSON) !== null);
  let shown = 0;
  for (const row of rows) {
    const login = overviewLoginOf(row);
    const hidden = login !== null && hides(login);
    setHidden(row, hidden);
    if (!hidden) shown += 1;
  }
  // "1 more reviewer" (reviewers whose approvals may not affect merge requirements) goes with its last row.
  for (const group of section.querySelectorAll('[class*="ReviewersGroup"]')) {
    const own = rows.filter((row) => group.contains(row));
    if (own.length > 0) setHidden(group, own.every((row) => row.hasAttribute(ATTR_HIDDEN)));
  }
  const body = section.querySelector(':scope > [class*="body"]');
  const anchor = body?.firstElementChild ?? null;
  const emptyClass = document.querySelector('[data-overview-sidebar-item] [class*="emptyState"]:not([data-geld-sidebar-own])')?.getAttribute('class') ?? '';
  if (anchor !== null) standIn(anchor, 'reviewers-empty', () => createElement('span', { class: emptyClass }), rows.length > 0 && shown === 0 ? 'No reviewers' : null);
}

function overviewParticipants(hides: (login: string) => boolean): void {
  const section = document.querySelector(OVERVIEW_PARTICIPANTS);
  const heading = section?.querySelector('h4, h3') ?? null;
  if (section === null || heading === null) return;
  const avatars = [...section.querySelectorAll(PERSON)];
  let hiddenCount = 0;
  for (const avatar of avatars) {
    const login = loginOf(avatar);
    const hidden = login !== null && hides(login);
    setHidden(avatar, hidden);
    if (hidden) hiddenCount += 1;
  }
  const left = statedCount(heading, avatars.length) - hiddenCount;
  setHidden(section, avatars.length > 0 && left <= 0);
  setHidden(heading, hiddenCount > 0);
  standIn(heading, 'participants', () => createElement('h4', { class: heading.getAttribute('class') ?? '' }), hiddenCount > 0 && left > 0 ? participantsHeading(left) : null);
}

/** An issue's Participants (`sidebar-participants-section`): pictures with no count, the section gone when nobody is left. */
function issueParticipants(hides: (login: string) => boolean): void {
  const list = document.querySelector('[data-testid="sidebar-participants-section"]');
  if (list === null) return;
  const avatars = [...list.querySelectorAll(PERSON)];
  let left = 0;
  for (const avatar of avatars) {
    const login = loginOf(avatar);
    const hidden = login !== null && hides(login);
    setHidden(avatar, hidden);
    if (!hidden) left += 1;
  }
  const section = list.closest('[data-testid="sidebar-section"]') ?? list;
  setHidden(section, avatars.length > 0 && left === 0);
}

/** Hides `hides`'s people in GitHub's Reviewers and Participants: pull requests (the conversation and the Overview), issues and discussions. */
export function syncSidebarPeople(hides: (login: string) => boolean): void {
  classicReviewers(hides);
  classicParticipants(hides);
  overviewReviewers(hides);
  overviewParticipants(hides);
  issueParticipants(hides);
}

/** Puts GitHub's sidebar back as it was. */
export function clearSidebarPeople(): void {
  for (const node of document.querySelectorAll(`[${ATTR_HIDDEN}]`)) node.removeAttribute(ATTR_HIDDEN);
  for (const node of document.querySelectorAll(`[${ATTR_OWN}]`)) node.remove();
}
