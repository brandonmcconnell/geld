import type { LineStats } from './dom';

/** A single file's diff as rendered on the page. */
export interface DiffEntry {
  /** Repository-relative path of the file (post-image path for renames). */
  readonly path: string;
  /**
   * The element that is a direct child of the diff container. This is what we
   * hide and reorder. It may wrap GitHub's own file element.
   */
  readonly root: HTMLElement;
  /** GitHub's anchor id for the diff, e.g. `diff-<sha256>`. */
  readonly anchor: string | null;
  /** Additions/deletions as displayed by GitHub, or `null` when unavailable (binary files). */
  readonly stats: LineStats | null;
}

/** A file node in the left-hand file tree. */
export interface TreeFileNode {
  readonly path: string;
  /** The `li[role=treeitem]` for the file. */
  readonly element: HTMLElement;
  /** GitHub's trailing status icon (modified/added/deleted), when the view shows one. */
  readonly statusIcon: SVGElement | null;
}

/** The parts of a diff page that Geld manipulates. */
export interface DiffView {
  readonly kind: 'legacy' | 'react';
  /** Element whose direct children are diff entry roots (plus GitHub chrome). */
  readonly container: HTMLElement;
  readonly entries: readonly DiffEntry[];
  /** `ul[role=tree]` of the file tree, when the page has one. */
  readonly treeRoot: HTMLElement | null;
  readonly treeFiles: readonly TreeFileNode[];
  /** Directory `li` elements in the tree (any depth). */
  readonly treeDirectories: readonly HTMLElement[];
  /** Compare-page table of contents items keyed by anchor. */
  readonly tocItems: ReadonlyMap<string, HTMLElement>;
  /**
   * Files GitHub's own file filter (extension, viewed, "files you own") has
   * taken off the page: their tree item or diff carries `hidden`. Geld leaves
   * them alone but keeps them out of the counts, as GitHub itself does not.
   */
  readonly filteredPaths: ReadonlySet<string>;
  /** Make sure a collapsed diff is expanded so it can be scrolled to. Returns `false` when no control was found yet. */
  expandEntry(entry: DiffEntry): boolean;
  /** Collapse an expanded diff with GitHub's own control. Returns `false` when no control was found yet. */
  collapseEntry(entry: DiffEntry): boolean;
}

export interface DiffViewAdapter {
  readonly kind: DiffView['kind'];
  /** Return the view when this adapter recognises the current page. */
  read(): DiffView | null;
}

/**
 * Paths GitHub's file filter hides on this page: a tree item or a diff root
 * with the `hidden` attribute (GitHub toggles it client-side; the header
 * numbers are not touched, so Geld mirrors the filter there).
 */
export function filteredPathsOf(entries: readonly DiffEntry[], treeFiles: readonly TreeFileNode[]): ReadonlySet<string> {
  const filtered = new Set<string>();
  for (const file of treeFiles) if (file.element.hidden) filtered.add(file.path);
  for (const entry of entries) if (entry.root.hidden || entry.root.closest('[hidden]') !== null) filtered.add(entry.path);
  return filtered;
}
