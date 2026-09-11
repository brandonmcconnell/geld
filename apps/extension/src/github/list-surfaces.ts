import type { Catalog, ChipPlacement, ListSurfaceSpec } from '@geld/core';
import { STACK_CONTAINER_SELECTOR, STACK_SURFACE_ID } from '@geld/core';
import { cleanText, OWN_UI_ATTRIBUTE } from './dom';

/**
 * Runtime form of the catalog's list surfaces (`@geld/core/list-surfaces.ts`):
 * the declarative specs compiled into functions. Everything UI-specific about
 * PR lists stays in the catalog data, so a GitHub markup change is fixed by a
 * catalog publish, not a store release; this file only knows how to *apply* a
 * spec. Rows and chips Geld touches are stamped `data-geld-surface="<id>"` so
 * the catalog's per-surface CSS (see {@link applySurfaceStyles}) and a live
 * page can tell the UIs apart.
 */

export const ATTR_SURFACE = 'data-geld-surface';
const STYLE_ID = 'geld-surface-styles';

export interface ChipAnchor {
  readonly element: HTMLElement;
  readonly placement: ChipPlacement;
}

export interface ListSurface {
  readonly id: string;
  readonly spec: ListSurfaceSpec;
  /** The row a PR title link belongs to, or `null` when the link is not on this surface. */
  rowOf(link: HTMLAnchorElement): HTMLElement | null;
  /** The metadata element the chip attaches to (`null` falls back to right after the title). */
  chipAnchor(row: HTMLElement, number: string): ChipAnchor | null;
  /** The author's login as GitHub shows it (`dependabot[bot]`), or `null` when the surface does not name one. */
  authorOf(row: HTMLElement): string | null;
}

/** Read `…opened by <login>` / `Filter by author <login>` labels. */
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

/** Whether a selector parses in this browser; a fetched typo must not break the whole list. */
function selectorIsValid(selector: string): boolean {
  try {
    document.createDocumentFragment().querySelector(selector);
    return true;
  } catch {
    return false;
  }
}

function compileSurface(spec: ListSurfaceSpec): ListSurface | null {
  const selectors = [spec.row, spec.notInside ?? ':root', ...spec.chipAnchors.map((anchor) => anchor.selector), ...spec.authors.map((source) => source.selector)];
  const broken = selectors.find((selector) => !selectorIsValid(selector));
  if (broken !== undefined) {
    console.warn(`Geld: list surface "${spec.id}" has an invalid selector and is skipped: ${broken}`);
    return null;
  }
  const notInside = spec.notInside;
  return {
    id: spec.id,
    spec,
    rowOf(link) {
      const row = link.closest<HTMLElement>(spec.row);
      if (row === null) return null;
      if (notInside !== undefined && row.closest(notInside) !== null) return null;
      // The stack popover's items are ActionList entries found in many menus; only inside a stack do they count.
      if (spec.id === STACK_SURFACE_ID && row.closest(STACK_CONTAINER_SELECTOR) === null) return null;
      return row;
    },
    chipAnchor(row, number) {
      for (const anchor of spec.chipAnchors) {
        const element = row.querySelector<HTMLElement>(anchor.selector);
        if (element !== null) return { element, placement: anchor.placement };
      }
      return metaByNumber(row, number);
    },
    authorOf(row) {
      for (const source of spec.authors) {
        for (const element of row.querySelectorAll<HTMLElement>(source.selector)) {
          const login = readAuthor(element, source.from);
          if (login !== null) return login;
        }
      }
      return null;
    },
  };
}

function readAuthor(element: HTMLElement, from: ListSurfaceSpec['authors'][number]['from']): string | null {
  switch (from) {
    case 'label':
      return loginFromLabel(element.getAttribute('title')) ?? loginFromLabel(element.getAttribute('aria-label'));
    case 'href':
      return loginFromAuthorQuery(element.getAttribute('href'));
    case 'text': {
      const text = cleanText(element.textContent);
      return text !== '' && !/\s/.test(text) ? text : null;
    }
  }
}

/** Compile a catalog's surfaces, in order; the first whose `rowOf` answers owns a link. Cached per catalog object. */
const compiled = new WeakMap<Catalog, readonly ListSurface[]>();
export function surfacesOf(catalog: Catalog): readonly ListSurface[] {
  let surfaces = compiled.get(catalog);
  if (surfaces === undefined) {
    surfaces = catalog.listSurfaces.map(compileSurface).filter((surface): surface is ListSurface => surface !== null);
    compiled.set(catalog, surfaces);
  }
  return surfaces;
}

export function surfaceOf(surfaces: readonly ListSurface[], link: HTMLAnchorElement): { readonly surface: ListSurface; readonly row: HTMLElement } | null {
  for (const surface of surfaces) {
    const row = surface.rowOf(link);
    if (row !== null) return { surface, row };
  }
  return null;
}

/**
 * Put the catalog's per-surface CSS on the page (one `<style>` Geld owns,
 * rewritten when the catalog changes). Signed data from the Geld repository,
 * like the patterns.
 */
export function applySurfaceStyles(catalog: Catalog): void {
  const css = [...catalog.listSurfaces, ...catalog.diffstatSurfaces]
    .flatMap((surface) => (surface.css === undefined ? [] : [`/* ${surface.id} */\n${surface.css}`]))
    .join('\n\n');
  let style = document.getElementById(STYLE_ID);
  if (css === '') {
    style?.remove();
    return;
  }
  if (style === null) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    style.setAttribute(OWN_UI_ATTRIBUTE, '');
    (document.head ?? document.documentElement).append(style);
  }
  if (style.textContent !== css) style.textContent = css;
}

export function removeSurfaceStyles(): void {
  document.getElementById(STYLE_ID)?.remove();
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
