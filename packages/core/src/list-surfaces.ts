/**
 * Declarative descriptions of the GitHub UIs that list pull requests: how to
 * find a row from its title link, where the `+N −M` chip attaches, where the
 * author is written, and any CSS the chip needs there. This is data, not code,
 * which is the point: it ships inside the signed pattern catalog
 * (`catalog/patterns.json`), so when GitHub moves a class name or rolls out a
 * new list, the fix is a catalog publish that every installed extension picks
 * up on its next daily check — no store release. Behaviour that needs new
 * logic (a new placement mode, a new kind of author source) still needs code.
 *
 * The bundled copy below is the fallback and the source of the committed
 * JSON; `resolveCatalog` prefers a newer fetched list when it carries one.
 */

/** Where the chip is inserted relative to an anchor element. */
export type ChipPlacement = 'after' | 'append';

export const CHIP_PLACEMENTS: readonly ChipPlacement[] = ['after', 'append'];

/** Where a row's author login can be read from. */
export type AuthorSourceKind =
  /** The element's `title` or `aria-label`, phrased "…opened by X" / "Filter by author X". */
  | 'label'
  /** A link whose query says `author:X` or `author:app/X` (→ `X[bot]`). */
  | 'href'
  /** The element's text, when it is a single token. */
  | 'text';

export const AUTHOR_SOURCE_KINDS: readonly AuthorSourceKind[] = ['label', 'href', 'text'];

export interface ChipAnchorSpec {
  /** Selector, scoped to the row. */
  readonly selector: string;
  readonly placement: ChipPlacement;
}

export interface AuthorSourceSpec {
  /** Selector, scoped to the row. */
  readonly selector: string;
  readonly from: AuthorSourceKind;
}

export interface ListSurfaceSpec {
  /** Stable id, stamped on rows and chips as `data-geld-surface`. */
  readonly id: string;
  /** Which GitHub UI this is and how it was recognised when written; keep it current. */
  readonly description: string;
  /** `closest()` selector from a PR title link to its row. */
  readonly row: string;
  /** The row does not belong to this surface when it sits inside an element matching this. */
  readonly notInside?: string;
  /** Tried in order; the first element found anchors the chip. Empty: fall back to the "#N" line, then the title. */
  readonly chipAnchors: readonly ChipAnchorSpec[];
  /** Tried in order; the first that yields a login wins. Empty: the surface names no author. */
  readonly authors: readonly AuthorSourceSpec[];
  /** Extra CSS for Geld's elements on this surface (injected as-is; author it against `[data-geld-surface="<id>"]`). */
  readonly css?: string;
}

export const BUNDLED_LIST_SURFACES: readonly ListSurfaceSpec[] = [
  {
    id: 'classic-list',
    description:
      'Classic Rails PR/issue list (.js-issue-row rows, .opened-by metadata line, author link titled "pull requests opened by X"). Still served to signed-out visitors as of 2026-09.',
    row: '.js-issue-row',
    chipAnchors: [{ selector: '.opened-by', placement: 'after' }],
    authors: [
      { selector: '.opened-by a, a[data-hovercard-type="user"]', from: 'label' },
      { selector: 'a[href*="author%3A"], a[href*="author:"]', from: 'href' },
    ],
  },
  {
    id: 'react-list',
    description:
      'Primer ListView PR list rolling out to /pulls since 2026-09 (li[id*="-list-view-node-"] rows, a[data-testid="listitem-title-link"] titles, a Description-module__container line: "#N · author opened … · Review required · checks"), and the earlier React issues list (li[role="listitem"]).',
    row: 'li[id*="-list-view-node-"], li[role="listitem"]',
    notInside: '[class*="StackState"]',
    chipAnchors: [{ selector: '[class*="Description-module__container"], [data-testid="issue-pr-description"]', placement: 'append' }],
    authors: [
      { selector: 'a[data-testid="author-filter-link"], a[data-testid*="author"]', from: 'label' },
      { selector: 'a[data-testid="author-filter-link"], a[data-testid*="author"]', from: 'href' },
      { selector: 'a[data-testid="author-filter-link"]', from: 'text' },
      { selector: 'a[href*="author%3A"], a[href*="author:"]', from: 'href' },
    ],
    css: `.geld-pr-stat[data-geld-surface='react-list'] { margin-left: 6px; font-size: 12px; vertical-align: baseline; }`,
  },
  {
    id: 'stack-popover',
    description: 'Stacked pull requests popover: ActionList items inside [class*="StackState"] with a "#N · branch" description. Names no author.',
    row: 'li[data-component="ActionList.Item"]',
    chipAnchors: [{ selector: '[data-component="ActionList.Description"]', placement: 'append' }],
    authors: [],
    css: `.geld-pr-stat[data-geld-surface='stack-popover'] { margin-left: 8px; font-size: 11px; }`,
  },
];

/** The stack popover only counts when the item really is inside a stack. */
export const STACK_SURFACE_ID = 'stack-popover';
export const STACK_CONTAINER_SELECTOR = '[class*="StackState"]';

const ID_PATTERN = /^[a-z][a-z0-9-]*$/;

export class ListSurfaceError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'nothing';
  if (Array.isArray(value)) return `a list of ${value.length}`;
  if (typeof value === 'object') return 'an object';
  if (typeof value === 'string') return JSON.stringify(value.length > 40 ? `${value.slice(0, 37)}…` : value);
  return String(value);
}

function requireSelector(record: Record<string, unknown>, key: string, path: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim() === '') throw new ListSurfaceError(`${path}.${key}: expected a CSS selector, got ${describe(value)}`);
  if (value.length > 500) throw new ListSurfaceError(`${path}.${key}: selector is unreasonably long`);
  return value;
}

/**
 * Validate the `listSurfaces` value of a catalog document. Selector *syntax*
 * cannot be checked without a DOM; the extension compiles each surface with
 * `querySelector` in a try/catch and drops the ones that fail, logging why.
 */
export function parseListSurfaces(value: unknown, path = 'listSurfaces'): readonly ListSurfaceSpec[] {
  if (!Array.isArray(value)) throw new ListSurfaceError(`${path}: expected a list, got ${describe(value)}`);
  const seen = new Set<string>();
  return value.map((entry: unknown, index): ListSurfaceSpec => {
    const at = `${path}[${index}]`;
    if (!isRecord(entry)) throw new ListSurfaceError(`${at}: expected a surface object, got ${describe(entry)}`);
    const id = entry.id;
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) throw new ListSurfaceError(`${at}.id: expected an id like "react-list", got ${describe(id)}`);
    if (seen.has(id)) throw new ListSurfaceError(`${path}: duplicate surface id "${id}"`);
    seen.add(id);
    const description = entry.description;
    if (typeof description !== 'string') throw new ListSurfaceError(`${at}.description: expected a string, got ${describe(description)}`);
    const row = requireSelector(entry, 'row', at);
    const notInside = entry.notInside === undefined ? undefined : requireSelector(entry, 'notInside', at);
    if (!Array.isArray(entry.chipAnchors)) throw new ListSurfaceError(`${at}.chipAnchors: expected a list, got ${describe(entry.chipAnchors)}`);
    const chipAnchors = entry.chipAnchors.map((anchor: unknown, anchorIndex): ChipAnchorSpec => {
      const anchorPath = `${at}.chipAnchors[${anchorIndex}]`;
      if (!isRecord(anchor)) throw new ListSurfaceError(`${anchorPath}: expected an object, got ${describe(anchor)}`);
      const placement = anchor.placement;
      if (!CHIP_PLACEMENTS.some((candidate) => candidate === placement)) {
        throw new ListSurfaceError(`${anchorPath}.placement: expected one of ${CHIP_PLACEMENTS.join(', ')}, got ${describe(placement)}`);
      }
      return { selector: requireSelector(anchor, 'selector', anchorPath), placement: placement as ChipPlacement };
    });
    if (!Array.isArray(entry.authors)) throw new ListSurfaceError(`${at}.authors: expected a list, got ${describe(entry.authors)}`);
    const authors = entry.authors.map((source: unknown, sourceIndex): AuthorSourceSpec => {
      const sourcePath = `${at}.authors[${sourceIndex}]`;
      if (!isRecord(source)) throw new ListSurfaceError(`${sourcePath}: expected an object, got ${describe(source)}`);
      const from = source.from;
      if (!AUTHOR_SOURCE_KINDS.some((candidate) => candidate === from)) {
        throw new ListSurfaceError(`${sourcePath}.from: expected one of ${AUTHOR_SOURCE_KINDS.join(', ')}, got ${describe(from)}`);
      }
      return { selector: requireSelector(source, 'selector', sourcePath), from: from as AuthorSourceKind };
    });
    const css = entry.css;
    if (css !== undefined && typeof css !== 'string') throw new ListSurfaceError(`${at}.css: expected a string, got ${describe(css)}`);
    if (typeof css === 'string' && css.length > 20_000) throw new ListSurfaceError(`${at}.css: unreasonably long`);
    const spec: ListSurfaceSpec = { id, description, row, chipAnchors, authors };
    return { ...spec, ...(notInside === undefined ? {} : { notInside }), ...(css === undefined ? {} : { css }) };
  });
}

/** Stable JSON shape for `serializeCatalog`. */
export function listSurfaceJson(spec: ListSurfaceSpec): Record<string, unknown> {
  return {
    id: spec.id,
    description: spec.description,
    row: spec.row,
    ...(spec.notInside === undefined ? {} : { notInside: spec.notInside }),
    chipAnchors: spec.chipAnchors.map((anchor) => ({ selector: anchor.selector, placement: anchor.placement })),
    authors: spec.authors.map((source) => ({ selector: source.selector, from: source.from })),
    ...(spec.css === undefined ? {} : { css: spec.css }),
  };
}
