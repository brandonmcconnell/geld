import { browser } from 'wxt/browser';
import { relatedLinksFrom } from '@geld/review/related-links';
import type { LinkCandidate, RelatedKind, RelatedLink } from '@geld/review/related-links';
import { createElement, OWN_UI_ATTRIBUTE, svgFromString } from './dom';
import { descriptionBody } from './review/description';
import { ICON_ALERT, ICON_COMMENT_DISCUSSION, ICON_COPILOT, ICON_FILE, ICON_ISSUE_OPENED, ICON_LINK_EXTERNAL } from './ui/icons';

/**
 * "Related links" in the pull request's sidebar, under Assignees: the tickets, chat threads, agent sessions, review
 * tools and docs the description links to (and Linear's linkback comment), read by `@geld/review`'s registry.
 */

const SECTION_CLASS = 'geld-related';

/** The headings of GitHub's own sidebar sections, which tell the sidebar's list apart from whatever holds it. */
const SECTION_HEADING = /^(?:activity|reviewers|assignees|labels|projects|milestones?|development|deployments|notifications|participants|\d+ participants?)$/i;

const HEADINGS = 'h2, h3, h4, summary, [role="heading"], .discussion-sidebar-heading';

const KIND_ICONS: Readonly<Record<RelatedKind, string>> = {
  ticket: ICON_ISSUE_OPENED,
  conversation: ICON_COMMENT_DISCUSSION,
  agent: ICON_COPILOT,
  review: ICON_LINK_EXTERNAL,
  doc: ICON_FILE,
  error: ICON_ALERT,
};

const words = (element: Element): string => (element.textContent ?? '').replace(/\s+/g, ' ').trim();

/** A link's target and the words it shows, its pictures' alt text included (a badge is an image in a link). */
function candidateOf(link: HTMLAnchorElement): LinkCandidate {
  const alts = [...link.querySelectorAll('img[alt]')].map((image) => image.getAttribute('alt') ?? '');
  return { href: link.href, text: [words(link), ...alts].join(' ').trim() };
}

function linksIn(root: ParentNode): LinkCandidate[] {
  return [...root.querySelectorAll<HTMLAnchorElement>('a[href]')].filter((link) => link.closest(`pre, [${OWN_UI_ATTRIBUTE}]`) === null).map(candidateOf);
}

/** Linear's linkback comment ("<!-- linear-linkback -->", the issue's key linked) names the issue when the description does not. */
function linearLinkbacks(): LinkCandidate[] {
  return [...document.querySelectorAll('a.author[href$="/apps/linear"]')].flatMap((author) => {
    const body = author.closest('.timeline-comment, .js-comment')?.querySelector('.comment-body');
    return body === null || body === undefined ? [] : linksIn(body);
  });
}

/** Every related link the page holds, in the registry's order. Exported for its test. */
export function relatedLinksOnPage(): RelatedLink[] {
  const body = descriptionBody();
  return relatedLinksFrom([...(body === null ? [] : linksIn(body)), ...linearLinkbacks()]);
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

function markOf(link: RelatedLink): Element {
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

function rowOf(link: RelatedLink): HTMLElement {
  const named = link.ref !== null || link.title !== null;
  const tip = [link.action, link.title, link.context].filter((part) => part !== null && part !== '').join(' · ');
  const parts = named
    ? [
        ...(link.ref === null ? [] : [createElement('span', { class: `${SECTION_CLASS}__ref` }, [link.ref])]),
        ...(link.title === null ? [] : [createElement('span', { class: `${SECTION_CLASS}__title` }, [link.title])]),
      ]
    : [createElement('span', { class: `${SECTION_CLASS}__action` }, [link.action])];
  const label = named ? `${relatedText(link)}. ${link.action}` : link.action;
  const anchor = createElement('a', { class: `${SECTION_CLASS}__link`, href: link.href, target: '_blank', rel: 'noopener noreferrer', title: tip, 'aria-label': link.context === null ? label : `${label}, ${link.context}` }, [
    markOf(link),
    createElement('span', { class: `${SECTION_CLASS}__text` }, parts),
  ]);
  return createElement('li', { class: `${SECTION_CLASS}__item`, 'data-kind': link.kind }, [anchor]);
}

const TITLE = 'Related links';

function listOf(links: readonly RelatedLink[]): HTMLElement {
  return createElement('ul', { class: `${SECTION_CLASS}__list` }, links.map(rowOf));
}

/** The Rails sidebar's item: `div.discussion-sidebar-item` with an `h3.discussion-sidebar-heading`. */
function railsSection(links: readonly RelatedLink[]): HTMLElement {
  return createElement('div', { class: `discussion-sidebar-item ${SECTION_CLASS}`, [OWN_UI_ATTRIBUTE]: '', 'data-geld-shape': 'rails' }, [
    createElement('h3', { class: `discussion-sidebar-heading text-bold ${SECTION_CLASS}__heading` }, [TITLE]),
    listOf(links),
  ]);
}

/**
 * The Overview page's section (GitHub's `SidebarSection`): `<section aria-label data-overview-sidebar-item>` holding
 * a header `div` with the title's `h4` and a content `div`, every class a CSS module's, so each is taken from the page.
 * The title's class is the leaf that reads the neighbour's title (the `h4`, or the `span` inside a gear's button), the
 * header's from a section whose header is the plain `div > h4`, the content's from the neighbour's last child.
 */
function overviewSection(neighbour: HTMLElement, links: readonly RelatedLink[]): HTMLElement {
  const name = words(titleOf(neighbour) ?? neighbour);
  const leaf = [...neighbour.querySelectorAll('h2, h3, h4, span')].find((element) => element.childElementCount === 0 && words(element) === name);
  const plainHeader = neighbour.parentElement?.querySelector(':scope > [data-overview-sidebar-item] > div:first-child:has(> h4:only-child)') ?? null;
  const content = neighbour.lastElementChild;
  return createElement('section', { class: SECTION_CLASS, 'aria-label': TITLE, 'data-overview-sidebar-item': '', [OWN_UI_ATTRIBUTE]: '', 'data-geld-shape': 'overview' }, [
    createElement('div', { class: plainHeader?.className ?? '' }, [createElement('h4', { class: `${leaf?.className ?? ''} ${SECTION_CLASS}__heading`.trim() }, [TITLE])]),
    createElement('div', { class: content !== null && content !== titleOf(neighbour)?.parentElement ? content.className : '' }, [listOf(links)]),
  ]);
}

/** Any other sidebar: the neighbour's tag and classes, and its title's. */
function sectionLike(neighbour: HTMLElement, links: readonly RelatedLink[]): HTMLElement {
  if (neighbour.classList.contains('discussion-sidebar-item')) return railsSection(links);
  if (neighbour.hasAttribute('data-overview-sidebar-item')) return overviewSection(neighbour, links);
  const section = document.createElement(neighbour.localName);
  section.className = `${neighbour.className} ${SECTION_CLASS}`.trim();
  section.setAttribute(OWN_UI_ATTRIBUTE, '');
  const theirs = titleOf(neighbour);
  const level = theirs !== null && /^H[2-4]$/.test(theirs.tagName) ? theirs.localName : 'h3';
  const heading = document.createElement(level);
  heading.className = theirs === null || level !== theirs.localName ? 'discussion-sidebar-heading text-bold' : theirs.className;
  heading.classList.add(`${SECTION_CLASS}__heading`);
  heading.textContent = TITLE;
  section.append(heading, listOf(links));
  return section;
}

/** Our section after each Assignees section, keyed by it, with the links it was drawn from. */
let mounted = new Map<HTMLElement, { readonly section: HTMLElement; readonly signature: string }>();

export function removeRelatedLinks(): void {
  for (const { section } of mounted.values()) section.remove();
  mounted = new Map();
  for (const stray of document.querySelectorAll(`.${SECTION_CLASS}[${OWN_UI_ATTRIBUTE}]`)) stray.remove();
}

/** Draw, move back into place or take away the sections. Writes only where the links or the place changed. */
export function applyRelatedLinks(active: boolean): void {
  const afters = active ? assigneesSections() : [];
  const links = afters.length === 0 ? [] : relatedLinksOnPage();
  if (links.length === 0) {
    if (mounted.size > 0) removeRelatedLinks();
    return;
  }
  const signature = JSON.stringify(links);
  const next = new Map<HTMLElement, { readonly section: HTMLElement; readonly signature: string }>();
  for (const after of afters) {
    const known = mounted.get(after);
    if (known !== undefined && known.signature === signature && known.section.isConnected && after.nextElementSibling === known.section) {
      next.set(after, known);
      continue;
    }
    known?.section.remove();
    const section = sectionLike(after, links);
    after.after(section);
    next.set(after, { section, signature });
  }
  for (const [after, { section }] of mounted) if (!next.has(after)) section.remove();
  mounted = next;
}
