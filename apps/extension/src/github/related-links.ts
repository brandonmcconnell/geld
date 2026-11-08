import { browser } from 'wxt/browser';
import { isDependencyUpdate, relatedLinksFrom } from '@geld/review/related-links';
import type { LinkCandidate, RelatedKind, RelatedLink } from '@geld/review/related-links';
import { createElement, isOwnElement, OWN_UI_ATTRIBUTE, svgFromString } from './dom';
import { pageFetch } from './page-fetch';
import { descriptionBody } from './review/description';
import { appLoginOf } from './review/login';
import { refDetails } from './review/refs';
import type { RefState } from './review/refs';
import { forgetPageStack, pageStack } from './stack';
import type { PageStack } from './stack';
import { attachStackCard, hideStackCard } from './ui/stack-card';
import {
  ICON_ALERT,
  ICON_COMMENT_DISCUSSION,
  ICON_COPILOT,
  ICON_FILE,
  ICON_GIT_MERGE,
  ICON_GIT_PULL_REQUEST,
  ICON_GIT_PULL_REQUEST_CLOSED,
  ICON_GIT_PULL_REQUEST_DRAFT,
  ICON_ISSUE_CLOSED,
  ICON_ISSUE_OPENED,
  ICON_LINK_EXTERNAL,
  ICON_SKIP,
  ICON_STACK,
} from './ui/icons';

/**
 * "Related links" in the pull request's sidebar, under Reviewers: the tickets, chat threads, agent sessions, review
 * tools and docs the description links to (and Linear's linkback comment), read by `@geld/review`'s registry. Under it
 * "Related work": the stack the pull request is in, as one row, and the issues and pull requests its description links
 * to, leaving out the stack's own; every reference either way is the digest's Mentions row, which it links to.
 */

const SECTION_CLASS = 'geld-related';

/** The headings of GitHub's own sidebar sections, which tell the sidebar's list apart from whatever holds it. */
const SECTION_HEADING = /^(?:activity|reviewers|assignees|labels|projects|milestones?|development|deployments|notifications|participants|\d+ participants?)$/i;

const HEADINGS = 'h2, h3, h4, summary, [role="heading"], .discussion-sidebar-heading';

const KIND_ICONS: Readonly<Record<RelatedKind, string>> = {
  github: ICON_GIT_PULL_REQUEST,
  ticket: ICON_ISSUE_OPENED,
  conversation: ICON_COMMENT_DISCUSSION,
  agent: ICON_COPILOT,
  review: ICON_LINK_EXTERNAL,
  doc: ICON_FILE,
  error: ICON_ALERT,
};

const words = (element: Element): string => (element.textContent ?? '').replace(/\s+/g, ' ').trim();

/** A link's target and the words it shows, its pictures' alt text included (a badge is an image in a link). */
function candidateOf(link: HTMLAnchorElement): LinkCandidate | null {
  const raw = link.getAttribute('href') ?? '';
  let href: string;
  try {
    href = new URL(raw, location.href).href;
  } catch {
    return null;
  }
  const alts = [...link.querySelectorAll('img[alt]')].map((image) => image.getAttribute('alt') ?? '');
  return { href, text: [words(link), ...alts].join(' ').trim() };
}

function linksIn(root: ParentNode): LinkCandidate[] {
  return [...root.querySelectorAll<HTMLAnchorElement>('a[href]')]
    // `isOwnElement`, not `closest`: a comment the digest has on loan (opened in its panel) is still GitHub's.
    .filter((link) => link.closest('pre') === null && !isOwnElement(link))
    .map(candidateOf)
    .filter((candidate) => candidate !== null);
}

/** The description's links, or none for a dependency update, whose links are the upstream projects' release notes. */
function descriptionLinks(body: ParentNode & Node): LinkCandidate[] {
  return isDependencyUpdate(body.textContent ?? '') ? [] : linksIn(body);
}

const COMMENT_BODY = '.markdown-body, .comment-body';

/**
 * The comments Apps wrote, each with its author (`<slug>[bot]` from its `/apps/<slug>` author link, in either
 * conversation), for the registry to take only what an App says of its own service: Linear's linkback naming the
 * issue, Atlassian's Jira bot, an agent's comment linking its session. The comment is the nearest box above the
 * author link that holds one body; a box holding several is not one comment, and is passed over.
 */
function appComments(description: Element | null): LinkCandidate[] {
  for (const link of document.querySelectorAll('a[href*="/apps/"]')) {
    const author = appLoginOf(link.getAttribute('href') ?? '');
    if (author === null || link.closest(COMMENT_BODY) !== null || isOwnElement(link)) continue;
    let box: Element | null = link.parentElement;
    for (let depth = 0; box !== null && depth < 8; depth++, box = box.parentElement) {
      const bodies = box.querySelectorAll(COMMENT_BODY);
      if (bodies.length === 0) continue;
      const body = bodies[0];
      const single = [...bodies].every((other) => other === body || body?.contains(other) === true);
      if (single && body !== undefined && body !== description) authors.set(body, author);
      break;
    }
  }
  const found: LinkCandidate[] = [];
  for (const [body, author] of authors) {
    if (!body.isConnected) authors.delete(body);
    else found.push(...linksIn(body).map((candidate) => ({ ...candidate, author })));
  }
  return found;
}

/**
 * Each App comment's author, kept while its body is in the page: a comment the digest opens wears its header in the
 * row, away from its body, and is still that App's comment.
 */
const authors = new Map<Element, string>();

/** How long a fetched description stands before it is read again: an edit shows within this. */
const FETCHED_DESCRIPTION_MS = 2 * 60 * 1000;

/**
 * The description where the page does not hold it as the conversation does (GitHub's Overview page renders it through
 * its Markdown viewer, sometimes in a side panel): GitHub's own `page_data/description`, the JSON that page loads,
 * `bodyHtml` read into a detached document so nothing in it loads or runs.
 */
interface Fetched {
  pull: string;
  at: number;
  pending: boolean;
  body: Document | null;
}

const fetched: Fetched = { pull: '', at: 0, pending: false, body: null };

async function readJson(answer: Response): Promise<unknown> {
  if (!answer.ok) return null;
  const value: unknown = await answer.json();
  return value;
}

function pullPath(): string | null {
  return /^\/[^/]+\/[^/]+\/pull\/\d+/.exec(location.pathname)?.[0] ?? null;
}

function fetchedDescription(onChange: () => void): Document | null {
  const pull = pullPath();
  if (pull === null) return null;
  if (fetched.pull !== pull) Object.assign(fetched, { pull, at: 0, pending: false, body: null });
  if (!fetched.pending && Date.now() - fetched.at > FETCHED_DESCRIPTION_MS) {
    fetched.pending = true;
    void pageFetch(`${pull}/page_data/description`, { headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'GitHub-Verified-Fetch': 'true' }, credentials: 'same-origin' })
      .then(readJson)
      .catch(() => null)
      .then((value: unknown) => {
        if (fetched.pull !== pull) return;
        const html = typeof value === 'object' && value !== null && 'bodyHtml' in value && typeof value.bodyHtml === 'string' ? value.bodyHtml : null;
        const before = fetched.body?.body.innerHTML ?? null;
        Object.assign(fetched, { at: Date.now(), pending: false, body: html === null ? fetched.body : new DOMParser().parseFromString(html, 'text/html') });
        if ((fetched.body?.body.innerHTML ?? null) !== before) onChange();
      });
  }
  return fetched.body;
}

/** Every related link the page holds, in the registry's order. Exported for its test. */
export function relatedLinksOnPage(onChange: () => void = () => undefined): RelatedLink[] {
  const inPage = descriptionBody();
  const body = inPage ?? fetchedDescription(onChange)?.body ?? null;
  const pull = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(location.pathname);
  const repository = pull === null ? null : `${pull[1] ?? ''}/${pull[2] ?? ''}`;
  return relatedLinksFrom([...(body === null ? [] : descriptionLinks(body)), ...appComments(inPage)], {
    githubHosts: [location.hostname],
    host: location.hostname,
    repository,
    self: pull === null ? null : `${repository ?? ''}#${pull[3] ?? ''}`,
  });
}

const isHeading = (element: Element): boolean => SECTION_HEADING.test(words(element));

/** Pickers and menus GitHub opens over the page repeat a section's title ("Assignees" over the list of people). */
const OVERLAYS = '[role="dialog"], [role="menu"], [role="listbox"], [popover], .Overlay, #__primerPortalRoot__, details-menu, .select-menu-modal';

/** A sidebar section's own title: its first heading, which names it. */
const titleOf = (section: Element): Element | null => section.querySelector(HEADINGS);

/**
 * Every Assignees section on the page, each found by its heading and climbed to the child of the list that holds
 * the other sections (two or more of them titled as GitHub's are). So the Rails sidebar (`.discussion-sidebar-item`,
 * an `h3` signed out, a `summary` signed in) and the Overview page's (`section[data-overview-sidebar-item]` with an
 * `h4`, or an `h4 > button > span` with a gear) are found alike. Exported for its test.
 */
export function assigneesSections(): HTMLElement[] {
  const found = new Set<HTMLElement>();
  for (const heading of document.querySelectorAll(HEADINGS)) {
    if (words(heading).toLowerCase() !== 'assignees' || heading.closest(`.markdown-body, [${OWN_UI_ATTRIBUTE}], ${OVERLAYS}`) !== null) continue;
    let section: Element = heading;
    for (let depth = 0; depth < 6 && section.parentElement !== null && section.parentElement !== document.body; depth++) {
      const list = section.parentElement;
      const others = [...list.children].filter((child) => child !== section && !child.hasAttribute(OWN_UI_ATTRIBUTE) && (() => {
        const title = titleOf(child);
        return title !== null && isHeading(title);
      })());
      if (others.length >= 2) {
        if (section instanceof HTMLElement && titleOf(section) === heading) found.add(section);
        break;
      }
      section = list;
    }
  }
  return [...found];
}

/** A row: the link, and for GitHub's own issues and pull requests what GitHub's hovercard says of it. */
type RelatedRow = RelatedLink & { readonly state: RefState | null };

/** GitHub's glyph for an issue or pull request in each state, in GitHub's colour for it (as its hovercard's badge has them). */
const STATE_GLYPHS: Readonly<Record<RefState, { readonly icon: string; readonly tone: string; readonly word: string }>> = {
  open: { icon: ICON_GIT_PULL_REQUEST, tone: 'open', word: 'Open' },
  draft: { icon: ICON_GIT_PULL_REQUEST_DRAFT, tone: 'draft', word: 'Draft' },
  merged: { icon: ICON_GIT_MERGE, tone: 'done', word: 'Merged' },
  closed: { icon: ICON_GIT_PULL_REQUEST_CLOSED, tone: 'closed', word: 'Closed' },
  'issue-open': { icon: ICON_ISSUE_OPENED, tone: 'open', word: 'Open' },
  'issue-closed': { icon: ICON_ISSUE_CLOSED, tone: 'done', word: 'Closed' },
  'issue-not-planned': { icon: ICON_SKIP, tone: 'muted', word: 'Closed as not planned' },
  unknown: { icon: ICON_ISSUE_OPENED, tone: 'unknown', word: '' },
};

const NOUN_GLYPHS: Readonly<Record<string, string>> = { issue: ICON_ISSUE_OPENED, 'pull request': ICON_GIT_PULL_REQUEST, discussion: ICON_COMMENT_DISCUSSION };

/**
 * GitHub's own references get their title and state from GitHub's hovercard (`refs.ts`, once per reference per
 * visit), when they live on this page's host; `onChange` asks for a pass when one lands.
 */
/**
 * How many rows may ask GitHub's hovercard for their title and state: the rows that show, all of them once "Show N
 * more" is open, and never more than `MAX_LOOKUPS`, so a description naming a hundred issues is not a hundred requests.
 */
const MAX_LOOKUPS = 32;

function rowsOf(links: readonly RelatedLink[], group: Group, onChange: () => void): RelatedRow[] {
  const lookups = Math.min(showAll.has(group) ? links.length : SHOWN_LINKS, MAX_LOOKUPS);
  return links.map((link, index) => {
    if (index >= lookups || !link.key.startsWith('github:') || new URL(link.href).hostname !== location.hostname) return { ...link, state: null };
    const details = refDetails(link.href, onChange);
    return details === null ? { ...link, state: null } : { ...link, title: details.title, state: details.state };
  });
}

function glyphOf(icon: string, tone: string): Element {
  const glyph = svgFromString(icon);
  glyph.classList.add(`${SECTION_CLASS}__mark`);
  glyph.setAttribute('data-tone', tone);
  return glyph;
}

function markOf(link: RelatedRow): Element {
  if (link.key.startsWith('github:')) {
    if (link.state !== null) return glyphOf(STATE_GLYPHS[link.state].icon, STATE_GLYPHS[link.state].tone);
    return glyphOf(NOUN_GLYPHS[link.noun] ?? ICON_ISSUE_OPENED, 'unknown');
  }
  if (link.appId !== null) {
    return createElement('img', { class: `${SECTION_CLASS}__mark ${SECTION_CLASS}__mark--app`, src: `https://avatars.githubusercontent.com/in/${link.appId}?s=32&v=4`, alt: '', width: '16', height: '16' });
  }
  if (link.icon !== null) {
    return createElement('img', { class: `${SECTION_CLASS}__mark`, src: browser.runtime.getURL(`/tracker-icons/${link.icon}.svg`), alt: '', width: '16', height: '16' });
  }
  const glyph = svgFromString(KIND_ICONS[link.kind]);
  glyph.classList.add(`${SECTION_CLASS}__mark`, 'fgColor-muted');
  return glyph;
}

/**
 * What a row says: the identifier and title when the link names either ("LIM-1391 Fix the nav"), else what following
 * it does ("Open issue in Linear", "View workspace in Replicas"), the service being in its mark. Exported for its test.
 */
export function relatedText(link: RelatedLink): string {
  const named = [link.ref, link.title].filter((part) => part !== null && part !== '');
  return named.length > 0 ? named.join(' ') : link.action;
}

function rowOf(link: RelatedRow): HTMLElement {
  const named = link.ref !== null || link.title !== null;
  const state = link.state === null ? null : STATE_GLYPHS[link.state].word || null;
  const tip = [state, link.action, link.title, link.context].filter((part) => part !== null && part !== '').join(' · ');
  const parts = named
    ? [
        ...(link.ref === null ? [] : [createElement('span', { class: `${SECTION_CLASS}__ref` }, [link.ref])]),
        ...(link.ref !== null && link.title !== null ? [' '] : []),
        ...(link.title === null ? [] : [createElement('span', { class: `${SECTION_CLASS}__title` }, [link.title])]),
      ]
    : [createElement('span', { class: `${SECTION_CLASS}__action` }, [link.action])];
  const label = `${state === null ? '' : `${state}. `}${named ? `${relatedText(link)}. ${link.action}` : link.action}`;
  const anchor = createElement('a', { class: `${SECTION_CLASS}__link`, href: link.href, target: '_blank', rel: 'noopener noreferrer', title: tip, 'aria-label': link.context === null ? label : `${label}, ${link.context}` }, [
    markOf(link),
    createElement('span', { class: `${SECTION_CLASS}__text` }, parts),
  ]);
  return createElement('li', { class: `${SECTION_CLASS}__item`, 'data-kind': link.kind }, [anchor]);
}

/** The two sections, in the order they stand: the context the pull request came from, then the work it goes with. */
type Group = 'related' | 'work';

const TITLES: Readonly<Record<Group, string>> = { related: 'Related links', work: 'Related work' };

/** The stack the page's pull request is in, for its row's card to read when it opens. */
let currentStack: PageStack | null = null;

/** The stack as one row: its glyph, "Stack #193" and where this pull request stands in it, the card on hover. */
function stackRowOf(stack: PageStack): HTMLElement {
  const glyph = svgFromString(ICON_STACK);
  glyph.classList.add(`${SECTION_CLASS}__mark`, 'fgColor-muted');
  const place = stack.position === null ? null : `${stack.position} of ${stack.size}`;
  const anchor = createElement('a', {
    class: `${SECTION_CLASS}__link`,
    href: stack.path,
    'aria-label': `Stack #${stack.number}${place === null ? '' : `, this pull request ${place}`}. Open stack on GitHub`,
  }, [
    glyph,
    createElement('span', { class: `${SECTION_CLASS}__text` }, [
      createElement('span', { class: `${SECTION_CLASS}__title` }, [`Stack #${stack.number}`]),
      ...(place === null ? [] : [' ', createElement('span', { class: `${SECTION_CLASS}__ref` }, [place])]),
    ]),
  ]);
  attachStackCard(anchor, () => currentStack);
  return createElement('li', { class: `${SECTION_CLASS}__item`, 'data-kind': 'stack' }, [anchor]);
}

/** The digest's Mentions row: where every reference to and from the pull request is listed. */
const MENTIONS_ROW = '.geld-review [data-geld-fold="mentions"]';

/** Opens the digest's Mentions row, its Activity group first when that is folded, and brings it into view. */
function openDigestMentions(): void {
  const row = document.querySelector<HTMLElement>(MENTIONS_ROW);
  if (row === null) return;
  const group = row.getAttribute('data-geld-in-group');
  const heading = group === null ? null : document.querySelector<HTMLButtonElement>(`.geld-review [data-group="${CSS.escape(group)}"] button[aria-expanded="false"]`);
  heading?.click();
  const open = (): void => {
    const current = document.querySelector<HTMLElement>(MENTIONS_ROW);
    const main = current?.querySelector<HTMLButtonElement>('.geld-review__main');
    if (current === null || main === null || main === undefined) return;
    current.scrollIntoView({ block: 'center' });
    if (main.getAttribute('aria-expanded') !== 'true') main.click();
    main.focus({ preventScroll: true });
  };
  // Unfolding the group rebuilds nothing, but a row hidden a moment ago lays out only on the next frame.
  if (heading === null || heading === undefined) open();
  else requestAnimationFrame(open);
}

function allMentionsLink(): HTMLElement {
  const link = createElement('a', { class: `${SECTION_CLASS}__all`, href: '#geld-mentions' }, ['See all mentions']);
  link.addEventListener('click', (event) => {
    event.preventDefault();
    openDigestMentions();
  });
  return createElement('li', { class: `${SECTION_CLASS}__item ${SECTION_CLASS}__item--all` }, [link]);
}

const ATTR_GROUP = 'data-geld-section';

/** How many rows show before "Show N more": a description that links a dozen tickets should not push Labels off screen. */
export const SHOWN_LINKS = 8;

/** The sections whose every row the reader asked for on this page; kept across redraws, forgotten on teardown. */
const showAll = new Set<Group>();

function listOf(links: readonly RelatedRow[], group: Group, stack: PageStack | null = null): HTMLElement {
  const rows = links.map(rowOf);
  const list = createElement('ul', { class: `${SECTION_CLASS}__list` }, [...(stack === null ? [] : [stackRowOf(stack)]), ...rows]);
  if (group === 'work') list.append(allMentionsLink());
  const extra = rows.slice(SHOWN_LINKS);
  if (extra.length === 0 || showAll.has(group)) return list;
  for (const row of extra) row.hidden = true;
  const more = createElement('button', { type: 'button', class: `btn-link ${SECTION_CLASS}__more` }, [`Show ${extra.length} more`]);
  more.addEventListener('click', () => {
    showAll.add(group);
    for (const row of extra) row.hidden = false;
    more.parentElement?.remove();
    requestPass();
  });
  const footer = list.querySelector(`.${SECTION_CLASS}__item--all`);
  const moreItem = createElement('li', { class: `${SECTION_CLASS}__item` }, [more]);
  if (footer === null) list.append(moreItem);
  else footer.before(moreItem);
  return list;
}

/** The Rails sidebar's item: `div.discussion-sidebar-item` with an `h3.discussion-sidebar-heading`. */
function railsSection(links: readonly RelatedRow[], group: Group, stack: PageStack | null): HTMLElement {
  return createElement('div', { class: `discussion-sidebar-item ${SECTION_CLASS}`, [OWN_UI_ATTRIBUTE]: '', [ATTR_GROUP]: group, 'data-geld-shape': 'rails' }, [
    createElement('h3', { class: `discussion-sidebar-heading text-bold ${SECTION_CLASS}__heading` }, [TITLES[group]]),
    listOf(links, group, stack),
  ]);
}

/**
 * The Overview page's section (GitHub's `SidebarSection`): `<section aria-label data-overview-sidebar-item>` holding
 * a header `div` with the title's `h4` and a content `div`, every class a CSS module's, so each is taken from the page.
 * The title's class is the leaf that reads the neighbour's title (the `h4`, or the `span` inside a gear's button), the
 * header's from a section whose header is the plain `div > h4`, the content's from the neighbour's last child.
 */
function overviewSection(neighbour: HTMLElement, links: readonly RelatedRow[], group: Group, stack: PageStack | null): HTMLElement {
  const name = words(titleOf(neighbour) ?? neighbour);
  const leaf = [...neighbour.querySelectorAll('h2, h3, h4, span')].find((element) => element.childElementCount === 0 && words(element) === name);
  const plainHeader = neighbour.parentElement?.querySelector(':scope > [data-overview-sidebar-item] > div:first-child:has(> h4:only-child)') ?? null;
  const content = neighbour.lastElementChild;
  return createElement('section', { class: SECTION_CLASS, 'aria-label': TITLES[group], 'data-overview-sidebar-item': '', [OWN_UI_ATTRIBUTE]: '', [ATTR_GROUP]: group, 'data-geld-shape': 'overview' }, [
    createElement('div', { class: plainHeader?.className ?? '' }, [createElement('h4', { class: `${leaf?.className ?? ''} ${SECTION_CLASS}__heading`.trim() }, [TITLES[group]])]),
    createElement('div', { class: content !== null && content !== titleOf(neighbour)?.parentElement ? content.className : '' }, [listOf(links, group, stack)]),
  ]);
}

/** Any other sidebar: the neighbour's tag and classes, and its title's. */
function sectionLike(neighbour: HTMLElement, links: readonly RelatedRow[], group: Group, stack: PageStack | null): HTMLElement {
  if (neighbour.classList.contains('discussion-sidebar-item')) return railsSection(links, group, stack);
  if (neighbour.hasAttribute('data-overview-sidebar-item')) return overviewSection(neighbour, links, group, stack);
  const section = document.createElement(neighbour.localName);
  section.className = `${neighbour.className} ${SECTION_CLASS}`.trim();
  section.setAttribute(OWN_UI_ATTRIBUTE, '');
  section.setAttribute(ATTR_GROUP, group);
  const theirs = titleOf(neighbour);
  const level = theirs !== null && /^H[2-4]$/.test(theirs.tagName) ? theirs.localName : 'h3';
  const heading = document.createElement(level);
  heading.className = theirs === null || level !== theirs.localName ? 'discussion-sidebar-heading text-bold' : theirs.className;
  heading.classList.add(`${SECTION_CLASS}__heading`);
  heading.textContent = TITLES[group];
  section.append(heading, listOf(links, group, stack));
  return section;
}

/**
 * Where the section goes in the sidebar holding `assignees`: after its Reviewers section, else after Assignees, and
 * after the untitled helpers that follow it (the classic sidebar's hidden error fragment), so the next section is
 * still a sidebar item's neighbour. Assignees stays the shape to copy: Reviewers has controls of its own ("Merge status").
 */
function isSection(element: Element): boolean {
  const title = titleOf(element);
  return title !== null && isHeading(title);
}

function placeFor(assignees: HTMLElement): HTMLElement {
  const list = assignees.parentElement;
  let place = (list === null ? undefined : [...list.children].find((child): child is HTMLElement => child instanceof HTMLElement && !child.hasAttribute(OWN_UI_ATTRIBUTE) && (() => {
    const title = titleOf(child);
    return title !== null && words(title).toLowerCase() === 'reviewers';
  })())) ?? assignees;
  for (let next = place.nextElementSibling; next instanceof HTMLElement && !next.hasAttribute(OWN_UI_ATTRIBUTE) && !next.hasAttribute('data-overview-sidebar-item') && !isSection(next); next = next.nextElementSibling) {
    place = next;
  }
  return place;
}

interface Mounted {
  readonly sections: readonly HTMLElement[];
  readonly signature: string;
}

/** Our sections in the sidebar of each Assignees section, keyed by it, with the links they were drawn from. */
let mounted = new Map<HTMLElement, Mounted>();

function removeSections(): void {
  for (const { sections } of mounted.values()) for (const section of sections) section.remove();
  mounted = new Map();
  for (const stray of document.querySelectorAll(`.${SECTION_CLASS}[${OWN_UI_ATTRIBUTE}]`)) stray.remove();
  showAll.clear();
}

/** Whether the sections still stand right after `place`, one after another. */
function standsAfter(place: HTMLElement, sections: readonly HTMLElement[]): boolean {
  let previous: Element = place;
  for (const section of sections) {
    if (!section.isConnected || previous.nextElementSibling !== section) return false;
    previous = section;
  }
  return true;
}

export function removeRelatedLinks(): void {
  removeSections();
  hideStackCard();
  forgetPageStack();
  currentStack = null;
  authors.clear();
  orderSidebars([]);
}

const ATTR_ORDERED = 'data-geld-sidebar-order';
const ATTR_PLACE = 'data-geld-order';
const ATTR_FIRST = 'data-geld-order-first';

/** Where a section of the Overview sidebar is shown, before GitHub's order for the rest: Reviewers, Related links, Mentions, Activity. */
const PLACES = ['reviewers', 'related', 'work', 'activity'] as const;
type Place = (typeof PLACES)[number];

function placeOf(section: Element): Place | null {
  if (section.classList.contains(SECTION_CLASS) && section.hasAttribute(OWN_UI_ATTRIBUTE)) return section.getAttribute(ATTR_GROUP) === 'work' ? 'work' : 'related';
  const name = (section.getAttribute('aria-label') ?? words(titleOf(section) ?? section)).toLowerCase();
  if (name === 'reviewers') return 'reviewers';
  return name === 'activity' || name.startsWith('activity (') ? 'activity' : null;
}

function setAttribute(element: Element, name: string, value: string | null): void {
  if (value === null) {
    if (element.hasAttribute(name)) element.removeAttribute(name);
  } else if (element.getAttribute(name) !== value) {
    element.setAttribute(name, value);
  }
}

/**
 * The Overview sidebar shows Reviewers, then Related links, Related work and Activity, then GitHub's own order. Its list is a flex
 * column, so the order is CSS `order` on attributes, never React's nodes moved. GitHub draws the line above every
 * section but the first in page order, which no longer is the first shown, so on an ordered list the stylesheet draws
 * it above every section but the one marked first here. The classic sidebar keeps its order.
 */
function orderSidebars(afters: readonly HTMLElement[]): void {
  const lists = new Set<Element>(afters.filter((after) => after.hasAttribute('data-overview-sidebar-item')).map((after) => after.parentElement).filter((list) => list !== null));
  for (const stale of document.querySelectorAll(`[${ATTR_ORDERED}]`)) {
    if (lists.has(stale)) continue;
    stale.removeAttribute(ATTR_ORDERED);
    for (const child of stale.children) {
      child.removeAttribute(ATTR_PLACE);
      child.removeAttribute(ATTR_FIRST);
    }
  }
  for (const list of lists) {
    setAttribute(list, ATTR_ORDERED, '');
    const children = [...list.children];
    const places = children.map(placeOf);
    children.forEach((child, index) => setAttribute(child, ATTR_PLACE, places[index] ?? null));
    const rank = (index: number): number => {
      const place = places[index] ?? null;
      return place === null ? PLACES.length : PLACES.indexOf(place);
    };
    const shown = children.map((child, index) => ({ child, index })).filter(({ child }) => child.hasAttribute('data-overview-sidebar-item'));
    const first = shown.sort((a, b) => rank(a.index) - rank(b.index) || a.index - b.index)[0]?.child ?? null;
    for (const child of children) setAttribute(child, ATTR_FIRST, child === first ? '' : null);
  }
}

/** A reference's place as a stack member's, `host/owner/repo/pull/N`: a link to an issue of that number is not the pull request. */
function stackKeyOf(link: RelatedLink): string {
  try {
    const url = new URL(link.href);
    const pull = /^\/[^/]+\/[^/]+\/pull\/\d+/.exec(url.pathname)?.[0];
    return pull === undefined ? '' : `${url.hostname}${pull}`.toLowerCase();
  } catch {
    return '';
  }
}

/** The controller's pass, for rows "Show N more" reveals to look their details up. */
let requestPass: () => void = () => undefined;

/**
 * Draw, move back into place or take away the sections. Writes only where the links or the place changed. `onChange`
 * asks for another pass when a description read from GitHub lands.
 */
export function applyRelatedLinks(active: boolean, onChange: () => void = () => undefined): void {
  requestPass = onChange;
  const afters = active ? assigneesSections() : [];
  const all = afters.length === 0 ? [] : relatedLinksOnPage(onChange);
  const stack = afters.length === 0 ? null : pageStack(onChange);
  currentStack = stack;
  const inStack = new Set((stack?.pulls ?? []).map((pull) => `${location.hostname}${pull.path}`.toLowerCase()));
  const work = all.filter((link) => link.kind === 'github' && !inStack.has(stackKeyOf(link)));
  const groups = ([
    ['related', rowsOf(all.filter((link) => link.kind !== 'github'), 'related', onChange), null],
    ['work', rowsOf(work, 'work', onChange), stack],
  ] as const).filter(([, rows, lead]) => rows.length > 0 || lead !== null);
  if (groups.length === 0) {
    if (mounted.size > 0 || document.querySelector(`.${SECTION_CLASS}[${OWN_UI_ATTRIBUTE}]`) !== null) removeSections();
    orderSidebars(afters);
    return;
  }
  const signature = JSON.stringify(groups);
  const next = new Map<HTMLElement, Mounted>();
  for (const after of afters) {
    const place = placeFor(after);
    const known = mounted.get(after);
    if (known !== undefined && known.signature === signature && standsAfter(place, known.sections)) {
      next.set(after, known);
      continue;
    }
    for (const section of known?.sections ?? []) section.remove();
    const sections = groups.map(([group, rows, lead]) => sectionLike(after, rows, group, lead));
    place.after(...sections);
    next.set(after, { sections, signature });
  }
  for (const [after, { sections }] of mounted) if (!next.has(after)) for (const section of sections) section.remove();
  // A section left by another copy of Geld (one an extension reload or update retired, or a second build installed
  // beside this one) stood beside this one's as a second section: only the sections drawn here stay.
  const ours = new Set([...next.values()].flatMap(({ sections }) => sections));
  for (const stray of document.querySelectorAll(`.${SECTION_CLASS}[${OWN_UI_ATTRIBUTE}]`)) if (!(stray instanceof HTMLElement) || !ours.has(stray)) stray.remove();
  mounted = next;
  orderSidebars(afters);
}
