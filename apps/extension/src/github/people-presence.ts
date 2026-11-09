import { compileAuthorRules } from '@geld/core';
import type { BlockedBy } from './blocked-list';
import { blockedFor } from './blocked-users';
import { createElement, OWN_UI_ATTRIBUTE } from './dom';
import { lookUpUnhideForms, markedOnGitHub, sendUnhide, unhideFormOf } from './review/hidden-people';
import type { MarkedContent } from './review/hidden-people';
import type { PersonCard } from './person-hovercard';
import { removePersonHovercards, syncPersonHovercards } from './person-hovercard';
import { loginOfLink } from './review/login';
import { blockedWords, descriptionCard } from './review/panel';
import { clearSidebarPeople, syncSidebarPeople } from './review/sidebar-people';

/**
 * Where a blocked or hidden person still shows on a conversation page, with
 * or without the digest. GitHub decides what is hidden: someone with a comment
 * GitHub marked as spam or abuse, or on the reader's hidden list in Geld, has
 * each other comment of theirs fold behind a line in the shape of GitHub's own
 * hidden comments (Show comment / Hide comment). A block alone folds nothing,
 * since GitHub shows a blocked person's comments: a Blocked label stands beside
 * their name wherever GitHub writes it, a notice heads a page they opened, and
 * GitHub's Reviewers and Participants leave them out. GitHub's nodes stay where they are: a fold
 * is an attribute the stylesheet keys on, and the line beside it is Geld's.
 */

const ATTR_FOLD = 'data-geld-person-fold';
const ATTR_FOLD_OPEN = 'data-geld-person-fold-open';
const ATTR_LINE = 'data-geld-person-line';
const ATTR_LABEL = 'data-geld-blocked-label';
const ATTR_NOTICE = 'data-geld-blocked-notice';

/** A comment's card: a thread's comment, an issue comment or a review's own words, on the conversation and the Overview. */
const COMMENTS = '.review-comment, .timeline-comment, article[id^="issuecomment-"], article[id^="pullrequestreview-"], [id^="discussion_r"]:not(a)';
const AUTHOR = 'a.author, a[data-testid="avatar-link"], [data-testid="comment-header"] a[data-hovercard-url^="/users/"], a[href^="/apps/"].author';
const NAME_LINKS = 'a[data-hovercard-url^="/users/"]:not(.user-mention), a.author:not(.user-mention)';

/** Why a person's comments fold: hidden the way GitHub hid them (blocked or not), or by the reader's list in Geld. */
type Standing = { readonly kind: 'blocked' } | { readonly kind: 'marked' } | { readonly kind: 'list' };

/** Comment ids the reader has unfolded, kept across GitHub's re-renders for the page's life. */
const opened = new Set<string>();

function isOwn(node: Element): boolean {
  return node.closest(`[${OWN_UI_ATTRIBUTE}]`) !== null;
}

/** The page's description, never folded: the pull request itself, not a comment on it. */
function isDescription(node: Element): boolean {
  if (node.closest('section[aria-label="Description"]') !== null) return true;
  const card = descriptionCard();
  return card !== null && (card === node || card.contains(node) || node.contains(card));
}

function authorOfComment(card: Element): string | null {
  const link = [...card.querySelectorAll(AUTHOR)].find((candidate) => candidate.closest(COMMENTS) === card);
  return link === undefined ? null : loginOfLink(link);
}

function idOf(card: Element): string {
  return card.id !== '' ? card.id : (card.closest('[id^="issuecomment-"], [id^="pullrequestreview-"], [id^="discussion_r"]')?.id ?? '');
}

function foldWords(standing: Standing): string {
  if (standing.kind === 'blocked') return 'This comment was posted by a blocked user.';
  return standing.kind === 'list' ? 'This comment was posted by someone on your hidden list in Geld.' : 'This comment was posted by someone with hidden comments here.';
}

function lineFor(card: Element, standing: Standing): HTMLElement {
  const before = card.previousElementSibling;
  const open = card.hasAttribute(ATTR_FOLD_OPEN);
  if (before instanceof HTMLElement && before.hasAttribute(ATTR_LINE)) {
    const words = before.querySelector('.geld-person-line__words');
    if (words !== null && words.textContent !== foldWords(standing)) words.textContent = foldWords(standing);
    const toggle = before.querySelector('.geld-person-line__toggle');
    const label = open ? 'Hide comment' : 'Show comment';
    if (toggle !== null && toggle.textContent !== label) toggle.textContent = label;
    return before;
  }
  const toggle = createElement('button', { type: 'button', class: 'geld-person-line__toggle btn-link color-fg-muted f6' }, [open ? 'Hide comment' : 'Show comment']);
  const line = createElement('div', { class: 'geld-person-line', [OWN_UI_ATTRIBUTE]: '', [ATTR_LINE]: '' }, [
    createElement('span', { class: 'geld-person-line__words color-fg-muted text-italic' }, [foldWords(standing)]),
    toggle,
  ]);
  toggle.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const id = idOf(card);
    const nowOpen = !card.hasAttribute(ATTR_FOLD_OPEN);
    card.toggleAttribute(ATTR_FOLD_OPEN, nowOpen);
    if (id !== '') {
      if (nowOpen) opened.add(id);
      else opened.delete(id);
    }
    toggle.textContent = nowOpen ? 'Hide comment' : 'Show comment';
  });
  card.before(line);
  return line;
}

function unfold(card: Element): void {
  card.removeAttribute(ATTR_FOLD);
  card.removeAttribute(ATTR_FOLD_OPEN);
  const before = card.previousElementSibling;
  if (before?.hasAttribute(ATTR_LINE) === true) before.remove();
}

function syncFolds(standingOf: (login: string) => Standing | null): void {
  for (const card of document.querySelectorAll(COMMENTS)) {
    if (isOwn(card) && card.closest('[data-geld-teleported]') === null) continue;
    // A card inside another card is that card's (a review's threads stand inside the review on the Overview).
    const outer = card.parentElement?.closest(COMMENTS) ?? null;
    if (outer !== null && !card.matches('.review-comment, [id^="discussion_r"]')) continue;
    const login = authorOfComment(card);
    const standing = login === null || isDescription(card) || card.closest('.minimized-comment') !== null ? null : standingOf(login);
    if (standing === null) {
      if (card.hasAttribute(ATTR_FOLD)) unfold(card);
      continue;
    }
    if (!card.hasAttribute(ATTR_FOLD)) card.setAttribute(ATTR_FOLD, standing.kind);
    const id = idOf(card);
    if (id !== '' && opened.has(id) !== card.hasAttribute(ATTR_FOLD_OPEN)) card.toggleAttribute(ATTR_FOLD_OPEN, opened.has(id));
    lineFor(card, standing);
  }
  for (const line of document.querySelectorAll(`[${ATTR_LINE}]`)) {
    if (line.nextElementSibling?.hasAttribute(ATTR_FOLD) !== true) line.remove();
  }
}

function syncLabels(blocked: ReadonlyMap<string, BlockedBy>): void {
  for (const link of document.querySelectorAll(NAME_LINKS)) {
    if (isOwn(link)) continue;
    const login = loginOfLink(link);
    const text = (link.textContent ?? '').trim().replace(/^@/, '');
    const isName = login !== null && text !== '' && (text.toLowerCase() === login.toLowerCase() || text.toLowerCase().includes(`(${login.toLowerCase()})`));
    const want = isName && login !== null && blocked.has(login.toLowerCase());
    const next = link.nextElementSibling;
    const has = next?.hasAttribute(ATTR_LABEL) === true;
    const by = login === null ? undefined : blocked.get(login.toLowerCase());
    if (want && !has && by !== undefined) link.after(createElement('span', { class: 'Label Label--secondary geld-blocked-label', [OWN_UI_ATTRIBUTE]: '', [ATTR_LABEL]: '', title: blockedWords(by) }, ['Blocked']));
    if (!want && has) next?.remove();
  }
}

/** The person who opened the page's pull request (or issue, or discussion), from its header. */
function pageAuthor(): string | null {
  const header = document.querySelector('.gh-header-meta a.author, [data-testid="issue-metadata-author"] a, [data-component="PageHeader"] a[data-hovercard-type="user"], [data-component="PageHeader"] a[data-hovercard-url^="/users/"], .gh-header-meta a[data-hovercard-type="user"]');
  return header === null ? null : loginOfLink(header);
}

function noticeHost(): Element | null {
  return document.querySelector('section[aria-label="Description"]') ?? document.querySelector('.js-discussion') ?? document.querySelector('[data-testid="issue-viewer-issue-container"]');
}

function syncNotice(blocked: ReadonlyMap<string, BlockedBy>, noun: string): void {
  const author = pageAuthor();
  const by = author === null ? undefined : blocked.get(author.toLowerCase());
  const existing = document.querySelector(`[${ATTR_NOTICE}]`);
  if (author === null || by === undefined) {
    existing?.remove();
    return;
  }
  const who = by.org && by.personal ? 'who is blocked by you and this organization' : by.org ? 'who is blocked by this organization' : 'who you have blocked';
  const text = `This ${noun} was opened by ${author}, ${who}.`;
  if (existing !== null) {
    const words = existing.querySelector('.geld-blocked-notice__words');
    if (words !== null && words.textContent !== text) words.textContent = text;
    return;
  }
  const host = noticeHost();
  if (host === null) return;
  const notice = createElement('div', { class: 'flash geld-blocked-notice', role: 'note', [OWN_UI_ATTRIBUTE]: '', [ATTR_NOTICE]: '' }, [createElement('span', { class: 'geld-blocked-notice__words' }, [text])]);
  if (host.matches('.js-discussion')) host.prepend(notice);
  else host.before(notice);
}

/** GitHub's Hide forms for `login`'s comments the page still shows, which GitHub renders only for someone who may hide them. */
function hideFormsFor(login: string): readonly HTMLFormElement[] {
  const forms: HTMLFormElement[] = [];
  for (const card of document.querySelectorAll(COMMENTS)) {
    if (isOwn(card) && card.closest('[data-geld-teleported]') === null) continue;
    if (card.closest('.minimized-comment') !== null || isDescription(card) || authorOfComment(card)?.toLowerCase() !== login) continue;
    const home = card.closest('.review-comment, [id^="pullrequestreview-"], .js-comment-container, .timeline-comment-group') ?? card;
    const form = home.querySelector<HTMLFormElement>('form.js-timeline-comment-minimize, form[action$="/minimize"], form[action*="/minimize-comment"]');
    if (form !== null && !forms.includes(form)) forms.push(form);
  }
  return forms;
}

/** Unhides `contents` through GitHub's own Unhide forms, after the reader confirms; null when GitHub offers the reader none. */
function unhideFor(login: string, contents: readonly MarkedContent[]): (() => void) | null {
  const forms = contents.flatMap((content) => {
    const form = unhideFormOf(content);
    return form === null ? [] : [form];
  });
  if (forms.length === 0) return null;
  return () => {
    if (!window.confirm(`Unhide ${login} on GitHub?\n\nThis unhides ${forms.length === 1 ? 'their hidden comment' : `their ${forms.length} hidden comments`} for everyone.`)) return;
    void (async () => {
      for (const form of forms) {
        if (!(await sendUnhide(form))) {
          window.alert(`GitHub did not unhide ${login}'s comment. Try GitHub's own Unhide on it.`);
          return;
        }
      }
      location.reload();
    })();
  };
}

export interface PresenceOptions {
  /** Whether the page is a conversation Geld dresses (a pull request, for now). */
  readonly enabled: boolean;
  /** "pull request", "issue" or "discussion", for the notice. */
  readonly noun: string;
  readonly hiddenAuthors: readonly string[];
  /** A pass to run when a Blocked users list lands. */
  readonly schedule: () => void;
}

export function applyPeoplePresence(options: PresenceOptions): void {
  if (!options.enabled) {
    removePeoplePresence();
    return;
  }
  const owner = location.pathname.split('/')[1] ?? '';
  const viewer = document.querySelector('meta[name="user-login"]')?.getAttribute('content') ?? '';
  const blocked = blockedFor(owner, viewer, options.schedule);
  const rules = compileAuthorRules(options.hiddenAuthors);
  const markedContent = markedOnGitHub(document);
  lookUpUnhideForms(markedContent, options.schedule);
  const marked = new Set(markedContent.map((content) => content.login.toLowerCase()));
  // GitHub decides what is hidden: a block alone folds nothing (GitHub shows a blocked person's comments), it only labels.
  const standingOf = (login: string): Standing | null => {
    const key = login.toLowerCase();
    if (marked.has(key)) return blocked.has(key) ? { kind: 'blocked' } : { kind: 'marked' };
    return rules.hides(login) ? { kind: 'list' } : null;
  };
  syncFolds(standingOf);
  syncLabels(blocked);
  syncNotice(blocked, options.noun);
  // Blocked people always leave the sidebar; the pull request's state stays GitHub's.
  syncSidebarPeople((login) => standingOf(login) !== null || blocked.has(login.toLowerCase()));
  // Their hovercard says why, with Hide their comments for a blocked person GitHub still shows, and Unhide for the hidden.
  const cards = new Map<string, PersonCard>();
  const contentsOf = (login: string): readonly MarkedContent[] => markedContent.filter((content) => content.login.toLowerCase() === login);
  for (const [login, by] of blocked) cards.set(login, { words: blockedWords(by), blocked: by, hideForms: () => hideFormsFor(login), unhide: unhideFor(login, contentsOf(login)) });
  for (const login of marked) if (!cards.has(login)) cards.set(login, { words: 'Comments hidden on this page', blocked: null, hideForms: () => [], unhide: unhideFor(login, contentsOf(login)) });
  for (const card of document.querySelectorAll(COMMENTS)) {
    const login = authorOfComment(card)?.toLowerCase();
    if (login !== undefined && !cards.has(login) && rules.hides(login)) cards.set(login, { words: 'On your hidden list in Geld', blocked: null, hideForms: () => [], unhide: null });
  }
  syncPersonHovercards(cards);
}

export function removePeoplePresence(): void {
  for (const card of document.querySelectorAll(`[${ATTR_FOLD}]`)) unfold(card);
  for (const node of document.querySelectorAll(`[${ATTR_LINE}], [${ATTR_LABEL}], [${ATTR_NOTICE}]`)) node.remove();
  clearSidebarPeople();
  removePersonHovercards();
}
