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

const SIDEBAR_ROOTS = '#partial-discussion-sidebar, [data-testid="issue-viewer-metadata-pane"], .Layout-sidebar';

const KIND_ICONS: Readonly<Record<RelatedKind, string>> = {
  ticket: ICON_ISSUE_OPENED,
  conversation: ICON_COMMENT_DISCUSSION,
  agent: ICON_COPILOT,
  review: ICON_LINK_EXTERNAL,
  doc: ICON_FILE,
  error: ICON_ALERT,
};

let mounted: { readonly section: HTMLElement; readonly after: Element; readonly signature: string } | null = null;

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

/**
 * GitHub's Assignees section, found by its heading and climbed to the child of the list that holds every section,
 * so the Rails sidebar (`.discussion-sidebar-item`) and a React one are found the same way. Exported for its test.
 */
export function assigneesSection(): HTMLElement | null {
  const roots = [...document.querySelectorAll(SIDEBAR_ROOTS)];
  const scopes: ParentNode[] = roots.length > 0 ? roots : [document];
  for (const scope of scopes) {
    for (const heading of scope.querySelectorAll(HEADINGS)) {
      if (words(heading).toLowerCase() !== 'assignees' || heading.closest(`.markdown-body, [${OWN_UI_ATTRIBUTE}]`) !== null) continue;
      let section: Element = heading;
      for (let depth = 0; depth < 10 && section.parentElement !== null; depth++) {
        const list = section.parentElement;
        const sibling = [...list.children].some((child) => child !== section && !child.hasAttribute(OWN_UI_ATTRIBUTE) && [...child.querySelectorAll(HEADINGS)].some(isHeading));
        if (sibling) return section instanceof HTMLElement ? section : null;
        section = list;
      }
    }
  }
  return null;
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

/** "Linear LIM-1391", "Slack thread", "Replicas workspace". */
export function relatedName(link: RelatedLink): string {
  return `${link.service} ${link.label}`;
}

function rowOf(link: RelatedLink): HTMLElement {
  const detail = link.title ?? link.context;
  const tip = [link.action, link.title, link.context].filter((part) => part !== null && part !== '').join(' · ');
  const anchor = createElement('a', { class: `${SECTION_CLASS}__link`, href: link.href, target: '_blank', rel: 'noopener noreferrer', title: tip, 'aria-label': `${relatedName(link)}${detail === null ? '' : `, ${detail}`}. ${link.action}` }, [
    markOf(link),
    createElement('span', { class: `${SECTION_CLASS}__name` }, [relatedName(link)]),
    ...(detail === null ? [] : [createElement('span', { class: `${SECTION_CLASS}__detail` }, [detail])]),
  ]);
  return createElement('li', { class: `${SECTION_CLASS}__item`, 'data-kind': link.kind }, [anchor]);
}

/** Our section in the shape of the one it follows: GitHub's classes on the box and the heading. */
function sectionLike(neighbour: HTMLElement, links: readonly RelatedLink[]): HTMLElement {
  const classic = neighbour.classList.contains('discussion-sidebar-item');
  const section = document.createElement(classic ? 'div' : neighbour.localName);
  section.className = `${classic ? 'discussion-sidebar-item' : neighbour.className} ${SECTION_CLASS}`.trim();
  section.setAttribute(OWN_UI_ATTRIBUTE, '');
  const theirs = [...neighbour.querySelectorAll(HEADINGS)].find(isHeading);
  const level = theirs !== undefined && /^H[2-4]$/.test(theirs.tagName) ? theirs.localName : 'h3';
  const heading = document.createElement(level);
  heading.className = classic || theirs === undefined || level !== theirs.localName ? 'discussion-sidebar-heading text-bold' : theirs.className;
  heading.classList.add(`${SECTION_CLASS}__heading`);
  heading.textContent = 'Related links';
  section.append(heading, createElement('ul', { class: `${SECTION_CLASS}__list` }, links.map(rowOf)));
  return section;
}

export function removeRelatedLinks(): void {
  mounted?.section.remove();
  mounted = null;
  for (const stray of document.querySelectorAll(`.${SECTION_CLASS}[${OWN_UI_ATTRIBUTE}]`)) stray.remove();
}

/** Draw, move back into place or take away the section. Writes only when the links or the place changed. */
export function applyRelatedLinks(active: boolean): void {
  if (!active) {
    if (mounted !== null) removeRelatedLinks();
    return;
  }
  const after = assigneesSection();
  const links = after === null ? [] : relatedLinksOnPage();
  if (after === null || links.length === 0) {
    if (mounted !== null) removeRelatedLinks();
    return;
  }
  const signature = JSON.stringify(links);
  if (mounted !== null && mounted.signature === signature && mounted.after === after && mounted.section.isConnected && after.nextElementSibling === mounted.section) return;
  removeRelatedLinks();
  const section = sectionLike(after, links);
  after.after(section);
  mounted = { section, after, signature };
}
