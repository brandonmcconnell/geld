import { cleanText, OWN_UI_ATTRIBUTE } from './dom';

/**
 * The GitHub UIs that list pull requests, one entry per UI. Everything that is
 * specific to a UI — how to find a row from its title link, where the `+N −M`
 * chip goes, where the author is written — lives here and nowhere else, so
 * when GitHub ships (or A/B tests) a new list, it is one more entry and one
 * more block of CSS keyed on `data-geld-surface="<id>"`.
 *
 * Rows Geld touches are stamped with `data-geld-surface` so styles and
 * debugging can tell the UIs apart on a live page.
 */

export type ListSurfaceId = 'classic-list' | 'react-list' | 'stack-popover';

export const ATTR_SURFACE = 'data-geld-surface';

/** Where a chip is inserted relative to its anchor element. */
export interface ChipAnchor {
  readonly element: HTMLElement;
  /** `after`: as the next sibling (inline metadata line); `append`: as the last child (block-level description). */
  readonly placement: 'after' | 'append';
}

export interface ListSurface {
  readonly id: ListSurfaceId;
  /** Which GitHub UI this is, and how it was recognised when written; keep it current. */
  readonly description: string;
  /** The row a PR title link belongs to, or `null` when the link is not on this surface. */
  rowOf(link: HTMLAnchorElement): HTMLElement | null;
  /** The metadata element the chip attaches to (`null` falls back to right after the title). */
  chipAnchor(row: HTMLElement, number: string): ChipAnchor | null;
  /** The author's login as GitHub shows it (`dependabot[bot]`), or `null` when the surface does not name one. */
  authorOf(row: HTMLElement): string | null;
}

/** Read `…by <login>` / `Filter by author <login>` style labels. */
function loginFromLabel(text: string | null): string | null {
  if (text === null) return null;
  const match = /(?:opened by|by author)\s+(\S+)/i.exec(text);
  return match?.[1] ?? null;
}

/** `author:app/dependabot` → `dependabot[bot]`; `author:octocat` → `octocat`. */
function loginFromAuthorQuery(href: string | null): string | null {
  if (href === null) return null;
  const app = /author(?:%3A|:)app(?:%2F|\/)([^&+\s]+)/i.exec(href)?.[1];
  if (app !== undefined) return `${decodeURIComponent(app)}[bot]`;
  const user = /author(?:%3A|:)([^&+\s]+)/i.exec(href)?.[1];
  return user === undefined ? null : decodeURIComponent(user);
}

/**
 * The classic Rails list: `/pulls`, the dashboard and search results as they
 * have rendered for years. Rows are `.js-issue-row`, the metadata line is
 * `.opened-by` and the author link's title reads "pull requests opened by X".
 * Still served to signed-out visitors as of September 2026.
 */
const classicList: ListSurface = {
  id: 'classic-list',
  description: 'Classic Rails PR/issue list (.js-issue-row rows, .opened-by metadata).',
  rowOf(link) {
    return link.closest<HTMLElement>('.js-issue-row');
  },
  chipAnchor(row) {
    const meta = row.querySelector<HTMLElement>('.opened-by');
    return meta === null ? null : { element: meta, placement: 'after' };
  },
  authorOf(row) {
    for (const link of row.querySelectorAll<HTMLAnchorElement>('.opened-by a, a[data-hovercard-type="user"]')) {
      const fromTitle = loginFromLabel(link.getAttribute('title'));
      if (fromTitle !== null) return fromTitle;
    }
    const query = row.querySelector<HTMLAnchorElement>('a[href*="author%3A"], a[href*="author:"]');
    return query === null ? null : loginFromAuthorQuery(query.getAttribute('href'));
  },
};

/**
 * The React list GitHub started rolling out to `/pulls` in September 2026
 * (Primer ListView: `ul[data-listview-component="items-list"]` with
 * `li[id*="-list-view-node-"]` rows, `a[data-testid="listitem-title-link"]`
 * titles and a `Description-module__container` line holding "#N · author
 * opened … · Review required · checks"). Also covers the earlier React issues
 * list, whose rows are `li[role="listitem"]`. The chip is appended to the
 * description line so it reads as one more "· item".
 */
const reactList: ListSurface = {
  id: 'react-list',
  description: 'Primer ListView PR list (li[id*="-list-view-node-"] or li[role="listitem"] rows, data-testid hooks).',
  rowOf(link) {
    const row = link.closest<HTMLElement>('li[id*="-list-view-node-"], li[role="listitem"]');
    if (row === null) return null;
    // Stack popover items are ActionList entries, not list-view nodes; keep them apart.
    return row.closest('[class*="StackState"]') === null ? row : null;
  },
  chipAnchor(row, number) {
    const description = row.querySelector<HTMLElement>('[class*="Description-module__container"], [data-testid="issue-pr-description"]');
    if (description !== null) return { element: description, placement: 'append' };
    return metaByNumber(row, number);
  },
  authorOf(row) {
    const author = row.querySelector<HTMLAnchorElement>('a[data-testid="author-filter-link"], a[data-testid*="author"]');
    if (author !== null) {
      const fromLabel = loginFromLabel(author.getAttribute('aria-label'));
      if (fromLabel !== null) return fromLabel;
      const fromQuery = loginFromAuthorQuery(author.getAttribute('href'));
      if (fromQuery !== null) return fromQuery;
      const text = cleanText(author.textContent);
      if (text !== '' && !/\s/.test(text)) return text;
    }
    const query = row.querySelector<HTMLAnchorElement>('a[href*="author%3A"], a[href*="author:"]');
    return query === null ? null : loginFromAuthorQuery(query.getAttribute('href'));
  },
};

/**
 * The "Stack #N" popover of stacked pull requests: ActionList items linking to
 * each PR with a "#N · branch" description. Mounts lazily and may virtualise;
 * it shows no author.
 */
const stackPopover: ListSurface = {
  id: 'stack-popover',
  description: 'Stacked pull requests popover (ActionList items inside [class*="StackState"]).',
  rowOf(link) {
    const item = link.closest<HTMLElement>('li[data-component="ActionList.Item"]');
    return item !== null && item.closest('[class*="StackState"]') !== null ? item : null;
  },
  chipAnchor(row, number) {
    const description = row.querySelector<HTMLElement>('[data-component="ActionList.Description"]');
    // Block-level: append inside to stay on the "#N · branch" line.
    if (description !== null) return { element: description, placement: 'append' };
    return metaByNumber(row, number);
  },
  authorOf() {
    return null;
  },
};

/** Surfaces in the order they are tried; the first whose `rowOf` answers owns the link. */
export const LIST_SURFACES: readonly ListSurface[] = [classicList, reactList, stackPopover];

export function surfaceOf(link: HTMLAnchorElement): { readonly surface: ListSurface; readonly row: HTMLElement } | null {
  for (const surface of LIST_SURFACES) {
    const row = surface.rowOf(link);
    if (row !== null) return { surface, row };
  }
  return null;
}

/**
 * Generic fallback for a metadata line: the smallest element whose own text
 * starts with "#N", which every list UI so far has rendered.
 */
function metaByNumber(row: HTMLElement, number: string): ChipAnchor | null {
  const prefix = `#${number}`;
  let best: HTMLElement | null = null;
  for (const element of row.querySelectorAll<HTMLElement>('span, div, p')) {
    if (element.closest(`[${OWN_UI_ATTRIBUTE}]`) !== null) continue;
    const text = (element.textContent ?? '').trim();
    if (!text.startsWith(prefix) || text.length > 200) continue;
    if (best === null || text.length <= (best.textContent ?? '').trim().length) best = element;
  }
  return best === null ? null : { element: best, placement: 'after' };
}
