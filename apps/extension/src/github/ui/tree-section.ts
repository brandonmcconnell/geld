import type { FileStatus, HiddenCategory } from '@geld/core';
import { formatCount } from '@geld/core';
import { createElement, OWN_UI_ATTRIBUTE, svgFromString, writeAttribute, writeText } from '../dom';
import {
  categoryIconFor,
  ICON_CHEVRON_RIGHT,
  ICON_FILE_ADDED,
  ICON_FILE_DIFF,
  ICON_FILE_DIRECTORY,
  ICON_FILE_DIRECTORY_OPEN,
  ICON_FILE_MODIFIED,
  ICON_FILE_MOVED,
  ICON_FILE_REMOVED,
} from './icons';

export const TREE_SECTION_CLASS = 'geld-tree-section';

export interface TreeSectionFile {
  readonly path: string;
  /** Whether the file's diff is present on the page and can be scrolled to. */
  readonly available: boolean;
  /** GitHub's own status icon for the file, cloned into our tree when present. */
  readonly statusIcon: SVGElement | null;
  /** What the diff says happened to the file, for the icon when GitHub's tree shows none. */
  readonly status: FileStatus | null;
}

export interface TreeSectionState {
  readonly category: HiddenCategory;
  readonly view: 'legacy' | 'react';
  /** Identifies the page so folder collapse state survives re-renders. */
  readonly stateKey: string;
  readonly files: readonly TreeSectionFile[];
  /** Whether this is the open panel of the sidebar accordion. */
  readonly active: boolean;
}

export interface DirNode {
  readonly kind: 'dir';
  name: string;
  path: string;
  readonly children: Map<string, TreeNode>;
}

export interface FileNode {
  readonly kind: 'file';
  readonly name: string;
  readonly file: TreeSectionFile;
}

export type TreeNode = DirNode | FileNode;

interface TreeSectionParts {
  readonly root: HTMLElement;
  readonly header: HTMLButtonElement;
  readonly title: HTMLElement;
  readonly count: HTMLElement;
  readonly group: HTMLUListElement;
}

const parts = new WeakMap<HTMLElement, TreeSectionParts>();
/** Collapsed directory paths per page; GitHub expands everything by default, so do we. */
const collapsedByPage = new Map<string, Set<string>>();

function collapsedSet(stateKey: string): Set<string> {
  let set = collapsedByPage.get(stateKey);
  if (set === undefined) {
    set = new Set();
    collapsedByPage.set(stateKey, set);
  }
  return set;
}

/** Build a directory tree and merge single-child directory chains like GitHub does. */
export function buildTree(files: readonly TreeSectionFile[]): DirNode {
  const root: DirNode = { kind: 'dir', name: '', path: '', children: new Map() };
  for (const file of files) {
    const segments = file.path.split('/');
    let current = root;
    for (let index = 0; index < segments.length - 1; index += 1) {
      const segment = segments[index] ?? '';
      let child = current.children.get(segment);
      if (child === undefined || child.kind !== 'dir') {
        const path = current.path === '' ? segment : `${current.path}/${segment}`;
        child = { kind: 'dir', name: segment, path, children: new Map() };
        current.children.set(segment, child);
      }
      current = child;
    }
    const name = segments[segments.length - 1] ?? file.path;
    current.children.set(name, { kind: 'file', name, file });
  }
  compact(root);
  return root;
}

function compact(dir: DirNode): void {
  for (const [key, child] of Array.from(dir.children)) {
    if (child.kind !== 'dir') continue;
    let node = child;
    while (node.children.size === 1) {
      const only = node.children.values().next().value;
      if (only === undefined || only.kind !== 'dir') break;
      node = { kind: 'dir', name: `${node.name}/${only.name}`, path: only.path, children: only.children };
    }
    dir.children.delete(key);
    dir.children.set(node.name, node);
    compact(node);
  }
}

export function sortedChildren(dir: DirNode): TreeNode[] {
  return Array.from(dir.children.values()).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }),
  );
}

function row(level: number, children: ReadonlyArray<Node | string>, attributes: Record<string, string>): HTMLButtonElement {
  const button = createElement('button', { type: 'button', class: 'geld-tree__row', ...attributes }, children);
  button.style.setProperty('--geld-level', String(level));
  return button;
}

/** GitHub's folder reads open or closed with its own icon, not just the chevron. */
function setDirVisual(button: HTMLElement, expanded: boolean): void {
  const visual = button.querySelector('.geld-tree__visual--dir');
  if (visual === null) return;
  const next = expanded ? ICON_FILE_DIRECTORY_OPEN : ICON_FILE_DIRECTORY;
  if (visual.getAttribute('data-open') === String(expanded)) return;
  visual.setAttribute('data-open', String(expanded));
  visual.replaceChildren(svgFromString(next));
}

function renderDir(dir: DirNode, level: number, collapsed: ReadonlySet<string>): HTMLLIElement {
  const isCollapsed = collapsed.has(dir.path);
  const button = row(
    level,
    [
      createElement('span', { class: 'geld-tree__toggle' }, [svgFromString(ICON_CHEVRON_RIGHT)]),
      createElement('span', { class: 'geld-tree__visual geld-tree__visual--dir', 'data-open': String(!isCollapsed) }, [
        svgFromString(isCollapsed ? ICON_FILE_DIRECTORY : ICON_FILE_DIRECTORY_OPEN),
      ]),
      createElement('span', { class: 'geld-tree__label' }, [dir.name]),
    ],
    { 'data-dir': dir.path, 'aria-expanded': String(!isCollapsed), title: dir.path },
  );
  const group = createElement('ul', { class: 'geld-tree__group', role: 'group' }, renderChildren(dir, level + 1, collapsed));
  group.style.setProperty('--geld-level', String(level));
  group.hidden = isCollapsed;
  return createElement('li', { class: 'geld-tree__item geld-tree__item--dir' }, [button, group]);
}

/** GitHub's icon for what happened to the file; an edit is `file-diff`, never the plain file. */
function statusIcon(status: FileStatus | null): string {
  switch (status) {
    case 'added':
      return ICON_FILE_ADDED;
    case 'deleted':
      return ICON_FILE_REMOVED;
    case 'renamed':
      return ICON_FILE_MOVED;
    case 'modified':
    case null:
      return ICON_FILE_MODIFIED;
  }
}

/**
 * The file's leading icon is the one GitHub's own tree shows for it — cloned
 * from the tree item when the view renders one, else drawn from the diff's
 * account of the file — so the same file reads the same in every panel.
 */
function fileVisual(file: TreeSectionFile): SVGElement {
  if (file.statusIcon !== null) {
    const icon = file.statusIcon.cloneNode(true);
    if (icon instanceof SVGElement) {
      icon.removeAttribute('id');
      return icon;
    }
  }
  return svgFromString(statusIcon(file.status));
}

function renderFile(node: FileNode, level: number): HTMLLIElement {
  const button = row(
    level,
    [
      createElement('span', { class: 'geld-tree__toggle geld-tree__toggle--spacer' }),
      createElement('span', { class: 'geld-tree__visual geld-tree__visual--status' }, [fileVisual(node.file)]),
      createElement('span', { class: 'geld-tree__label' }, [node.name]),
    ],
    { 'data-path': node.file.path, title: node.file.path },
  );
  if (!node.file.available) {
    // GitHub has not rendered this diff yet (large PRs load progressively).
    // Clicking still works: the controller scrolls until it appears.
    button.dataset.pending = '';
    button.title = `${node.file.path} (diff not loaded yet; click to load and jump to it)`;
  }
  return createElement('li', { class: 'geld-tree__item geld-tree__item--file' }, [button]);
}

function renderChildren(dir: DirNode, level: number, collapsed: ReadonlySet<string>): HTMLLIElement[] {
  return sortedChildren(dir).map((child) =>
    child.kind === 'dir' ? renderDir(child, level, collapsed) : renderFile(child, level),
  );
}

function build(
  category: HiddenCategory,
  onToggle: () => void,
  onSelect: (path: string) => void,
  stateKey: string,
): TreeSectionParts {
  const title = createElement('span', { class: 'geld-tree__label geld-tree__label--root' });
  const count = createElement('span', { class: `${TREE_SECTION_CLASS}__count` });
  // No chevron: the panels are not an accordion (one is always open, never
  // several), so the header's icon leads the row and the chevrons below it
  // belong to folders only.
  const header = row(
    1,
    [
      createElement('span', { class: 'geld-tree__visual geld-tree__visual--root' }, [
        svgFromString(categoryIconFor(category)),
      ]),
      title,
      count,
    ],
    { class: `geld-tree__row ${TREE_SECTION_CLASS}__header`, 'aria-expanded': 'false' },
  );
  header.addEventListener('click', onToggle);

  const group = createElement('ul', { class: 'geld-tree__group', role: 'group', hidden: '' });
  group.style.setProperty('--geld-level', '1');
  group.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest<HTMLButtonElement>('.geld-tree__row');
    if (button === null || button === undefined) return;
    event.preventDefault();

    const dir = button.dataset.dir;
    if (dir !== undefined) {
      const collapsed = collapsedSet(`${stateKey}#${category.id}`);
      const nowCollapsed = !collapsed.has(dir);
      if (nowCollapsed) collapsed.add(dir);
      else collapsed.delete(dir);
      button.setAttribute('aria-expanded', String(!nowCollapsed));
      setDirVisual(button, !nowCollapsed);
      const childGroup = button.nextElementSibling;
      if (childGroup instanceof HTMLElement) childGroup.hidden = nowCollapsed;
      return;
    }

    const path = button.dataset.path;
    if (path === undefined) return;
    for (const item of group.querySelectorAll('[aria-current]')) item.removeAttribute('aria-current');
    button.setAttribute('aria-current', 'true');
    onSelect(path);
  });

  const rootItem = createElement('li', { class: 'geld-tree__item geld-tree__item--dir geld-tree__item--root' }, [
    header,
    group,
  ]);
  const tree = createElement('ul', { class: 'geld-tree', role: 'list', 'aria-label': 'Hidden files' }, [rootItem]);
  const root = createElement('div', { class: TREE_SECTION_CLASS, [OWN_UI_ATTRIBUTE]: '', 'data-category': category.id }, [tree]);
  return { root, header, title, count, group };
}

/** The horizontal box of GitHub's tree list, as read once per measurement and written to every section. */
interface TreeBox {
  readonly marginLeft: string;
  readonly marginRight: string;
  readonly paddingLeft: string;
  readonly paddingRight: string;
  /** An explicit width when the tree is narrower than the space its parent offers; '' otherwise. */
  readonly width: string;
}

function measureTreeBox(treeRoot: HTMLElement): TreeBox {
  const style = getComputedStyle(treeRoot);
  const box = { marginLeft: style.marginLeft, marginRight: style.marginRight, paddingLeft: style.paddingLeft, paddingRight: style.paddingRight };
  const parent = treeRoot.parentElement;
  if (parent === null) return { ...box, width: '' };
  const parentStyle = getComputedStyle(parent);
  const available =
    parent.clientWidth -
    (Number.parseFloat(parentStyle.paddingLeft) || 0) -
    (Number.parseFloat(parentStyle.paddingRight) || 0) -
    (Number.parseFloat(style.marginLeft) || 0) -
    (Number.parseFloat(style.marginRight) || 0);
  const width = treeRoot.getBoundingClientRect().width;
  return { ...box, width: width > 0 && Math.abs(available - width) > 1 ? `${width}px` : '' };
}

/**
 * Match the horizontal box of GitHub's tree list exactly (margins, padding and
 * width), so our rows line up with theirs and hover backgrounds stop where
 * GitHub's do rather than running into the pane border.
 */
function applyTreeBox(section: HTMLElement, box: TreeBox): void {
  const style = section.style;
  if (style.marginLeft !== box.marginLeft) style.marginLeft = box.marginLeft;
  if (style.marginRight !== box.marginRight) style.marginRight = box.marginRight;
  if (style.paddingLeft !== box.paddingLeft) style.paddingLeft = box.paddingLeft;
  if (style.paddingRight !== box.paddingRight) style.paddingRight = box.paddingRight;
  if (style.width !== box.width) style.width = box.width;
}

/**
 * Ensure the "Tests" pseudo-section exists right after the file tree and lists
 * the hidden files as a collapsible tree that mirrors GitHub's. It lives
 * outside GitHub's `role=tree` widget so it cannot be mistaken for a real
 * directory of the change set.
 */
export function renderTreeSection(
  treeRoot: HTMLElement,
  state: TreeSectionState,
  onToggle: () => void,
  onSelect: (path: string) => void,
  /** The section rendered just before this one, to keep category order stable. */
  after: HTMLElement | null = null,
): HTMLElement {
  const host = treeRoot.parentElement ?? treeRoot;
  let existing = Array.from(host.children).find(
    (child): child is HTMLElement =>
      child instanceof HTMLElement &&
      child.classList.contains(TREE_SECTION_CLASS) &&
      child.dataset.category === state.category.id,
  );
  let section = existing === undefined ? undefined : parts.get(existing);
  if (existing !== undefined && section === undefined) {
    existing.remove();
    existing = undefined;
  }
  if (section === undefined) {
    section = build(state.category, onToggle, onSelect, state.stateKey);
    parts.set(section.root, section);
    (after ?? treeRoot).insertAdjacentElement('afterend', section.root);
  } else if (after !== null && section.root.previousElementSibling !== after) {
    after.insertAdjacentElement('afterend', section.root);
  }

  writeAttribute(section.root, 'data-view', state.view);
  writeText(section.title, state.category.title);
  writeText(section.count, formatCount(state.files.length));
  writeAttribute(section.header, 'aria-label', `${state.category.title}: ${formatCount(state.files.length)} hidden ${state.category.nounPlural}`);
  writeAttribute(section.header, 'aria-expanded', String(state.active));
  if (section.group.hidden !== !state.active) section.group.hidden = !state.active;
  if (section.root.hasAttribute('data-active') !== state.active) section.root.toggleAttribute('data-active', state.active);

  const signature = `${state.stateKey}#${state.category.id}\n${state.files
    .map((file) => `${file.path}\u0000${file.available ? 1 : 0}\u0000${file.statusIcon?.getAttribute('class') ?? file.status ?? ''}`)
    .join('\n')}`;
  if (section.group.dataset.signature !== signature) {
    const selected = section.group.querySelector<HTMLElement>('[aria-current]')?.dataset.path;
    section.group.dataset.signature = signature;
    section.group.replaceChildren(
      ...renderChildren(buildTree(state.files), 2, collapsedSet(`${state.stateKey}#${state.category.id}`)),
    );
    if (selected !== undefined) {
      section.group
        .querySelector(`.geld-tree__row[data-path="${CSS.escape(selected)}"]`)
        ?.setAttribute('aria-current', 'true');
    }
  }

  // Measured (box matched to GitHub's tree) by the sidebar geometry observer once the browser has laid it out.
  sidebarGeometry.watch(treeRoot, section.root);
  return section.root;
}

/** Remove all sections, or only those whose category is not in `keep`. */
export function removeTreeSection(root: ParentNode, keep: ReadonlySet<string> | null = null): void {
  for (const element of root.querySelectorAll<HTMLElement>(`.${TREE_SECTION_CLASS}`)) {
    const category = element.dataset.category;
    if (keep !== null && category !== undefined && (category === CHANGES_SECTION_ID || keep.has(category))) continue;
    sidebarGeometry.unwatch(element);
    element.remove();
  }
}

/* ------------------------------------------------------------------------- */
/* Sidebar accordion                                                          */
/* ------------------------------------------------------------------------- */

export const CHANGES_SECTION_ID = 'changes';
const ATTR_SIDEBAR = 'data-geld-sidebar';
const ATTR_SIDEBAR_LAYOUT = 'data-geld-sidebar-layout';
const ATTR_SIDEBAR_PATH = 'data-geld-sidebar-path';
/** Present while the sidebar is GitHub's sticky pane (not the stacked narrow layout). */
const ATTR_SIDEBAR_STICKY = 'data-geld-sidebar-sticky';
const ATTR_TREE_LIST = 'data-geld-tree-list';
/** Section headers below the open panel, stuck to the viewport bottom. */
const ATTR_PINNED = 'data-geld-pinned';

interface ChangesHeaderParts {
  readonly root: HTMLElement;
  readonly header: HTMLButtonElement;
  readonly count: HTMLElement;
}

const changesParts = new WeakMap<HTMLElement, ChangesHeaderParts>();

/**
 * A header for GitHub's own tree ("Essential": what is left to review), so it behaves like the other
 * accordion panels. It is inserted right before the tree and never wraps it.
 */
export function renderChangesHeader(
  treeRoot: HTMLElement,
  state: { readonly count: number; readonly active: boolean; readonly view: 'legacy' | 'react' },
  onActivate: () => void,
): HTMLElement {
  const previous = treeRoot.previousElementSibling;
  let root = previous instanceof HTMLElement && previous.dataset.category === CHANGES_SECTION_ID ? previous : null;
  let parts = root === null ? undefined : changesParts.get(root);
  if (root !== null && parts === undefined) {
    root.remove();
    root = null;
  }
  if (parts === undefined) {
    const count = createElement('span', { class: `${TREE_SECTION_CLASS}__count` });
    const header = row(
      1,
      [
        createElement('span', { class: 'geld-tree__visual geld-tree__visual--root' }, [svgFromString(ICON_FILE_DIFF)]),
        createElement('span', { class: 'geld-tree__label geld-tree__label--root' }, ['Essential']),
        count,
      ],
      { class: `geld-tree__row ${TREE_SECTION_CLASS}__header`, 'aria-expanded': 'false' },
    );
    header.addEventListener('click', onActivate);
    root = createElement(
      'div',
      { class: `${TREE_SECTION_CLASS} ${TREE_SECTION_CLASS}--changes`, [OWN_UI_ATTRIBUTE]: '', 'data-category': CHANGES_SECTION_ID },
      [header],
    );
    parts = { root, header, count };
    changesParts.set(root, parts);
    treeRoot.insertAdjacentElement('beforebegin', root);
  }
  writeAttribute(parts.root, 'data-view', state.view);
  writeText(parts.count, formatCount(state.count));
  writeAttribute(parts.header, 'aria-expanded', String(state.active));
  writeAttribute(parts.header, 'aria-label', `Essential: ${formatCount(state.count)} files`);
  if (parts.root.hasAttribute('data-active') !== state.active) parts.root.toggleAttribute('data-active', state.active);
  sidebarGeometry.watch(treeRoot, parts.root);
  return parts.root;
}

/**
 * GitHub's "Filter files" field sits between the sidebar's top edge and our
 * Changes header. Give the header exactly the top margin that makes the space
 * below the field equal the space above it, whatever spacing the view uses.
 */
function centreFilterAboveHeader(header: HTMLElement, treeRoot: HTMLElement): string | null {
  const scroller = treeRoot.closest<HTMLElement>(`[${ATTR_SIDEBAR}]`);
  // A collapsed pane (display: none) measures as all zeros, which would read
  // as "header touching the field" and grow the margin by the minimum gap on
  // every pass; leave it for the pass after the pane is shown.
  if (scroller === null || !isRendered(scroller)) return null;
  const filter = previousVisibleBlock(header, scroller);
  if (filter === null) return null;

  // The visible edge is the sidebar's border box (its padding is part of the gap).
  const boundaryTop = scroller.getBoundingClientRect().top;
  // Measure what the eye sees (the bordered field), not the block around it:
  // GitHub wraps the field in a `tmp-pb-3` div whose 16px of bottom padding
  // would otherwise be mistaken for part of the field.
  const filterRect = paintedBounds(filter);
  const gapAbove = filterRect.top - boundaryTop;
  if (gapAbove < 0 || gapAbove > 120) return null; // Something unexpected sits above; leave GitHub's spacing alone.

  const currentMargin = Number.parseFloat(getComputedStyle(header).marginTop) || 0;
  const gapBelow = header.getBoundingClientRect().top - filterRect.bottom;
  // Balanced gap, but never let the header come within MIN_HEADER_GAP of the field.
  const balanced = Math.round(currentMargin + (gapAbove - gapBelow));
  const floor = Math.round(currentMargin + (MIN_HEADER_GAP - gapBelow));
  return `${Math.max(balanced, floor)}px`;
}

const MIN_HEADER_GAP = 8;

/**
 * Bounding box of the parts of `block` that actually paint something (a
 * border or background), so invisible wrapper padding does not count. Falls
 * back to the block's own box when nothing inside paints.
 */
function paintedBounds(block: HTMLElement): DOMRect {
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  const consider = (element: Element): void => {
    const style = getComputedStyle(element);
    const paints =
      Number.parseFloat(style.borderTopWidth) > 0 ||
      Number.parseFloat(style.borderBottomWidth) > 0 ||
      (style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent');
    if (!paints) return;
    const rect = element.getBoundingClientRect();
    if (rect.height < 8) return;
    top = Math.min(top, rect.top);
    bottom = Math.max(bottom, rect.bottom);
  };
  for (const element of block.querySelectorAll('*')) consider(element);
  const own = block.getBoundingClientRect();
  if (!Number.isFinite(top) || !Number.isFinite(bottom)) return own;
  return new DOMRect(own.left, top, own.width, bottom - top);
}

/** The closest rendered element before `element` in document order, staying inside `boundary`. */
function previousVisibleBlock(element: HTMLElement, boundary: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = element;
  while (current !== null && current !== boundary) {
    let sibling = current.previousElementSibling;
    while (sibling !== null) {
      // Ignore 1px screen-reader-only spans and collapsed wrappers.
      if (sibling instanceof HTMLElement && sibling.getBoundingClientRect().height >= 8) return sibling;
      sibling = sibling.previousElementSibling;
    }
    current = current.parentElement;
  }
  return null;
}

function scrollContainerOf(element: HTMLElement): HTMLElement | null {
  let current = element.parentElement;
  while (current !== null && current !== document.body) {
    const overflow = getComputedStyle(current).overflowY;
    if (overflow === 'auto' || overflow === 'scroll') return current;
    current = current.parentElement;
  }
  return null;
}

/**
 * Sizes the sidebar so the browser, not a script, keeps the accordion headers
 * on the bottom edge of the viewport.
 *
 * GitHub's pane is `position: sticky; top: T`. Its height here is the
 * scroll-independent `100vh − T`: once the pane has reached its sticky top
 * its bottom is the viewport bottom, and before that (the page still scrolled
 * near the top) it overhangs the fold by `pane top − T`. The headers below
 * the open panel are `position: sticky; bottom: …` (see `pinSidebarHeaders`),
 * so during that overhang they ride the viewport bottom on the compositor.
 * The old approach — rewriting the pane's height to `viewport bottom − pane
 * top` on every scroll frame — ran one frame behind threaded scrolling and
 * the headers visibly chased the edge.
 *
 * The only value left that depends on the scroll position is the overhang
 * itself: the open list's last rows sit under the pinned headers (or below
 * the fold) until the pane is stuck, so the list gets a spacer of that height
 * at its end. A frame of lag there is invisible because the area is covered.
 */
class SidebarSizer {
  private scroller: HTMLElement | null = null;
  private frame = 0;
  private afterPaint: ReturnType<typeof setTimeout> | 0 = 0;
  private resizeObserver: ResizeObserver | null = null;
  /** Viewport width and rendered state at the last direction check (see `update`). */
  private checkedWidth = -1;
  private checkedRendered = false;
  /** The current width and rendered state, as the observer last reported them. */
  private width = -1;
  private rendered = false;

  attach(scroller: HTMLElement): void {
    if (this.scroller !== scroller) {
      this.detach();
      this.scroller = scroller;
      // Scrolling may happen on the window or on an inner container: listen in
      // the capture phase on the document to see both.
      document.addEventListener('scroll', this.onScroll, { passive: true, capture: true });
      window.addEventListener('resize', this.onResize, { passive: true });
      if (typeof ResizeObserver !== 'undefined') {
        this.resizeObserver = new ResizeObserver((entries) => {
          // The pane's box says whether it is rendered (display: none reports 0×0) and the
          // document's says how wide the viewport is: the direction's two inputs, for free.
          // The document also grows with every streamed diff file; that only moves the overhang.
          let full = false;
          for (const entry of entries) {
            if (entry.target === scroller) {
              const rendered = entry.contentRect.width > 0 || entry.contentRect.height > 0;
              full ||= rendered !== this.rendered;
              this.rendered = rendered;
            } else if (entry.target === document.documentElement) {
              full ||= entry.contentRect.width !== this.width;
              this.width = entry.contentRect.width;
            }
          }
          // Layout is clean inside a resize callback, so measure here rather than on a
          // frame the page will have dirtied again by the time it runs.
          this.cancelPending();
          this.update(full || this.fullPending);
          this.fullPending = false;
        });
        this.resizeObserver.observe(scroller);
        this.resizeObserver.observe(document.documentElement);
      }
      this.rendered = isRendered(scroller);
      this.width = document.documentElement.clientWidth || window.innerWidth;
      this.update();
    }
    // Same pane as before: its size, scroll position and the document's size are
    // all observed, and the geometry observer refreshes it after layout; nothing
    // here needs to read the (possibly dirty) layout on the apply path.
  }

  detach(): void {
    document.removeEventListener('scroll', this.onScroll, { capture: true });
    window.removeEventListener('resize', this.onResize);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.cancelPending();
    this.checkedWidth = -1;
    this.checkedRendered = false;
    this.width = -1;
    this.rendered = false;
    if (this.scroller !== null) {
      this.unsize(this.scroller);
      for (const panel of this.scroller.querySelectorAll<HTMLElement>(`[${ATTR_TREE_LIST}], .geld-tree__group`)) {
        panel.style.removeProperty(OVERHANG_PROPERTY);
      }
    }
    this.scroller = null;
  }

  /** Re-measure the open list's covered area now (after the pinned stack changed). */
  refresh(scroller: HTMLElement): void {
    if (this.scroller === scroller) this.update();
  }

  /**
   * Only scrolling that moves the pane matters: the window, or a container the
   * pane is inside. Scrolling inside a diff, the tree list or another panel
   * leaves the overhang alone — and a page streaming in a large diff fires
   * dozens of such inner scroll events with the layout dirty each time.
   */
  private readonly onScroll = (event: Event): void => {
    const target = event.target;
    if (target instanceof Element && this.scroller !== null && !target.contains(this.scroller)) return;
    this.schedule(false);
  };
  private readonly onResize = (): void => {
    if (typeof ResizeObserver === 'undefined') {
      // No observer to report them: read the direction's inputs on the next pass.
      this.width = -1;
    }
    this.schedule(true);
  };

  /** Whether the pending frame re-reads the sticky offset and direction, or only the overhang. */
  private fullPending = false;

  private cancelPending(): void {
    if (this.frame !== 0) cancelAnimationFrame(this.frame);
    if (this.afterPaint !== 0) clearTimeout(this.afterPaint);
    this.frame = 0;
    this.afterPaint = 0;
  }

  /**
   * Measure just after the next frame has painted, not in its animation
   * callbacks. A page streaming in a large diff scrolls itself (scroll
   * anchoring moves the document as files land above the fold) with its
   * layout dirty, and a rect read before that frame's layout would force a
   * full one — 20–30 ms on a big diff, dozens of times while it loads. After
   * paint the layout is clean and the same reads are free. The overhang is
   * then one frame late, which nothing shows: that area is covered.
   */
  private schedule(full: boolean): void {
    this.fullPending ||= full;
    if (this.frame !== 0) return;
    this.frame = requestAnimationFrame(() => {
      this.afterPaint = setTimeout(() => {
        this.afterPaint = 0;
        this.frame = 0;
        const wasFull = this.fullPending;
        this.fullPending = false;
        this.update(wasFull);
      }, 0);
    });
  }

  /**
   * The sticky offset is re-read on every pass, not only on resize: GitHub's
   * header height arrives late via a CSS variable on <html>, which is a change
   * no observer of the sidebar sees. Reading a computed style is cheap; the
   * write below only happens when the value differs.
   */
  private size(scroller: HTMLElement): void {
    // Only sticky sidebars need this; stacked (narrow) layouts keep GitHub's sizing.
    const stickyTop = stickyTopOf(scroller);
    if (stickyTop === null) {
      this.unsize(scroller);
      return;
    }
    // The height itself lives in the stylesheet (`100vh − this offset`, with
    // !important): GitHub's legacy `diff-layout` element rewrites the pane's
    // inline height on every scroll frame, and an inline write cannot beat an
    // important stylesheet rule, so its writes become inert instead of a fight.
    scroller.setAttribute(ATTR_SIDEBAR_STICKY, '');
    const value = `${stickyTop}px`;
    if (scroller.style.getPropertyValue(STICKY_TOP_PROPERTY) !== value) {
      scroller.style.setProperty(STICKY_TOP_PROPERTY, value);
    }
  }

  private unsize(scroller: HTMLElement): void {
    scroller.removeAttribute(ATTR_SIDEBAR_STICKY);
    scroller.style.removeProperty(STICKY_TOP_PROPERTY);
  }

  /**
   * The row/column decision is only trustworthy when made on a rendered pane,
   * and GitHub's own direction flips with the viewport (Primer stacks the pane
   * wrapper below 768px and lays it out as a row above). So it is (re)taken
   * here whenever the pane turns from unrendered to rendered — the "Files
   * changed" tab opened with the tree collapsed, then expanded — or the
   * viewport width changes. Never on scroll or pane drags: the check lifts our
   * override to measure and costs a style recalculation.
   */
  private settleDirection(scroller: HTMLElement): void {
    if (this.width < 0) {
      this.rendered = isRendered(scroller);
      this.width = document.documentElement.clientWidth || window.innerWidth;
    }
    const rendered = this.rendered;
    const width = this.width;
    const stale = rendered !== this.checkedRendered || width !== this.checkedWidth;
    if (!stale && scroller.hasAttribute(ATTR_SIDEBAR_LAYOUT)) return;
    this.checkedRendered = rendered;
    this.checkedWidth = width;
    if (rendered) settleSidebarDirection(scroller);
  }

  /**
   * `full` re-reads the sticky offset and the direction (computed styles: a
   * style recalculation when the page is mid-update); a scroll or a document
   * that merely grew only needs the overhang, from two rects.
   */
  private update(full = true): void {
    const scroller = this.scroller;
    if (scroller === null || !scroller.isConnected) return;
    if (full) {
      this.settleDirection(scroller);
      this.size(scroller);
    }
    const list = openPanelList(scroller);
    if (list === null) return;
    let overhang = 0;
    if (scroller.hasAttribute(ATTR_SIDEBAR_STICKY)) {
      // The list ends where the pinned stack starts in normal flow; while the
      // stack is shifted up onto the viewport edge (or, with nothing pinned,
      // while the list runs past the fold) that much of the list is covered.
      const cover = scroller.querySelector<HTMLElement>(`.${TREE_SECTION_CLASS}[${ATTR_PINNED}]`);
      const coverTop = cover === null ? document.documentElement.clientHeight || window.innerHeight : cover.getBoundingClientRect().top;
      overhang = Math.max(0, Math.round(list.getBoundingClientRect().bottom - coverTop));
    }
    // The stylesheet turns this into an ::after spacer inside the list (and its
    // scroll-padding). Content, not padding: padding is part of the flex item's
    // box, which min-height: 0 cannot shrink, so it would push the list's
    // bottom down and feed back into this very measurement.
    const value = overhang === 0 ? '' : `${overhang}px`;
    if (list.style.getPropertyValue(OVERHANG_PROPERTY) !== value) {
      if (value === '') list.style.removeProperty(OVERHANG_PROPERTY);
      else list.style.setProperty(OVERHANG_PROPERTY, value);
    }
  }
}

/** Read by the stylesheet: how much of the open list's end is covered by pinned headers or past the fold. */
const OVERHANG_PROPERTY = '--geld-overhang';

/** Read by the stylesheet: the pane's height is `100vh` minus this. */
const STICKY_TOP_PROPERTY = '--geld-sticky-top';

/** The scrolling list of the open panel: GitHub's tree for "Essential", else the active section's group. */
function openPanelList(root: HTMLElement): HTMLElement | null {
  return root.getAttribute(ATTR_SIDEBAR) === CHANGES_SECTION_ID
    ? root.querySelector<HTMLElement>(`[${ATTR_TREE_LIST}]`)
    : root.querySelector<HTMLElement>(`.${TREE_SECTION_CLASS}[data-active] > .geld-tree > .geld-tree__item--root > .geld-tree__group`);
}

/**
 * The distance from the viewport top at which the sidebar rests once stuck:
 * the sticky ancestor's `top`, plus the sidebar's own offset inside it when
 * they differ. `null` when the layout is not sticky at all (narrow screens
 * stack the sidebar above the diff).
 */
function stickyTopOf(root: HTMLElement): number | null {
  let current: HTMLElement | null = root;
  for (let depth = 0; current !== null && depth < 4; depth += 1) {
    const style = getComputedStyle(current);
    if (style.position === 'sticky' || style.position === 'fixed') {
      const top = Number.parseFloat(style.top);
      const stickyTop = Number.isFinite(top) ? top : Math.max(0, current.getBoundingClientRect().top);
      const offset = current === root ? 0 : root.getBoundingClientRect().top - current.getBoundingClientRect().top;
      return Math.max(0, Math.round(stickyTop + offset));
    }
    current = current.parentElement;
  }
  return null;
}

const sidebarSizer = new SidebarSizer();

/**
 * Pin the section headers that follow the open panel to the bottom of the
 * viewport, stacked: each one's `bottom` is the height of the headers beneath
 * it, the last one sits at 0. Sections before the open panel stay in normal
 * flow. Pure CSS from here on. Which headers are pinned is decided here on
 * every apply() without measuring anything; the offsets are measured by the
 * geometry observer, right away only when the set of pinned headers changed
 * (a panel opened, a category came or went), otherwise when their sizes do.
 */
export function pinSidebarHeaders(treeRoot: HTMLElement): void {
  const root = treeRoot.closest<HTMLElement>(`[${ATTR_SIDEBAR}]`);
  if (root === null) return;
  const list = openPanelList(root);
  let changed = false;
  for (const section of root.querySelectorAll<HTMLElement>(`.${TREE_SECTION_CLASS}`)) {
    const pin = list !== null && (list.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    if (pin === section.hasAttribute(ATTR_PINNED)) continue;
    changed = true;
    if (pin) {
      section.setAttribute(ATTR_PINNED, '');
    } else {
      section.removeAttribute(ATTR_PINNED);
      section.style.removeProperty('bottom');
    }
  }
  if (changed) sidebarGeometry.refresh();
}

/** The `bottom` of each pinned header is the height of the pinned headers beneath it. */
function measurePinnedStack(root: HTMLElement): ReadonlyArray<readonly [HTMLElement, string]> {
  const pinned = Array.from(root.querySelectorAll<HTMLElement>(`.${TREE_SECTION_CLASS}[${ATTR_PINNED}]`)).reverse();
  const heights = pinned.map((section) => section.getBoundingClientRect().height);
  let offset = 0;
  return pinned.map((section, index) => {
    const entry = [section, `${offset}px`] as const;
    offset += heights[index] ?? 0;
    return entry;
  });
}

/**
 * Everything in the sidebar that is *measured* — section boxes matched to
 * GitHub's tree, the gap under the filter field, the pinned headers' offsets,
 * the open list's overhang — is measured here and nowhere on the apply path.
 *
 * apply() runs after every batch of page mutations, and while a large diff
 * streams in that is many times a second with a layout GitHub has just
 * dirtied: a single `getBoundingClientRect` there forces a full layout of the
 * page, in addition to the one the next frame does anyway, and did so on every
 * pass. A ResizeObserver callback runs after layout, so the same reads there
 * are free, and it only runs when a watched box actually changed size (or was
 * first observed). Structural changes no size reflects — a header pinned or
 * unpinned, a category removed — call `refresh()` themselves; those follow a
 * user action or a settled classification, never a streaming batch.
 */
class SidebarGeometry {
  private observer: ResizeObserver | null = null;
  private htmlWatcher: MutationObserver | null = null;
  private frame = 0;
  private treeRoot: HTMLElement | null = null;
  private readonly observed = new Set<Element>();

  /** Measure `treeRoot`'s sidebar whenever `element` (a section, GitHub's tree, the pane) changes size. */
  watch(treeRoot: HTMLElement, element: HTMLElement): void {
    if (this.treeRoot !== treeRoot) {
      // GitHub remounted its tree: start over with the new one.
      this.detach();
      this.treeRoot = treeRoot;
      this.observe(treeRoot);
      const scroller = treeRoot.closest<HTMLElement>(`[${ATTR_SIDEBAR}]`);
      if (scroller !== null) this.observe(scroller);
      if (typeof MutationObserver !== 'undefined') {
        // GitHub's header height arrives late as a CSS variable on <html>, which no box size reflects.
        // Measured on the next frame, not in the mutation callback: the page is mid-update there, and
        // a read would pay for a style recalculation the frame is about to do anyway.
        this.htmlWatcher = new MutationObserver(() => this.refreshSoon());
        this.htmlWatcher.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });
      }
    }
    this.observe(element);
  }

  unwatch(element: Element): void {
    if (!this.observed.delete(element)) return;
    this.observer?.unobserve(element);
    // The sections above it shift down: their pinned offsets are stale.
    this.refresh();
  }

  /** Measure now: a structural change no box size reflects (headers pinned or unpinned, a section gone). */
  refresh(): void {
    this.measure();
  }

  private refreshSoon(): void {
    if (this.frame !== 0) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.measure();
    });
  }

  detach(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.htmlWatcher?.disconnect();
    this.htmlWatcher = null;
    if (this.frame !== 0) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.observed.clear();
    this.treeRoot = null;
  }

  private observe(element: Element): void {
    // A target observed twice would be reported again (its recorded size resets), so keep our own list.
    if (this.observed.has(element)) return;
    this.observed.add(element);
    if (typeof ResizeObserver === 'undefined') {
      this.measure();
      return;
    }
    this.observer ??= new ResizeObserver(() => this.measure());
    this.observer.observe(element);
  }

  /** Every read, then every write: a write between reads would make the next read pay for a style recalculation. */
  private measure(): void {
    const treeRoot = this.treeRoot;
    if (treeRoot === null || !treeRoot.isConnected) return;
    const root = treeRoot.closest<HTMLElement>(`[${ATTR_SIDEBAR}]`);
    const host = treeRoot.parentElement;
    if (host === null) return;
    const sections = Array.from(host.querySelectorAll<HTMLElement>(`:scope > .${TREE_SECTION_CLASS}`));
    const box = measureTreeBox(treeRoot);
    const changes = sections.find((section) => section.dataset.category === CHANGES_SECTION_ID) ?? null;
    const headerMargin = changes === null ? null : centreFilterAboveHeader(changes, treeRoot);
    const stack = root === null ? [] : measurePinnedStack(root);

    for (const section of sections) applyTreeBox(section, box);
    if (changes !== null && headerMargin !== null && changes.style.marginTop !== headerMargin) changes.style.marginTop = headerMargin;
    for (const [section, bottom] of stack) {
      if (section.style.bottom !== bottom) section.style.bottom = bottom;
    }
    // The pinned stack sets how much of the open list is covered.
    if (root !== null) sidebarSizer.refresh(root);
  }
}

const sidebarGeometry = new SidebarGeometry();

/**
 * Turn the sidebar's sticky pane into a full-height flex column so the active
 * panel fills the space and scrolls on its own; `pinSidebarHeaders` then keeps
 * the headers below it on screen. Only attributes are set; GitHub's DOM order
 * is untouched.
 */
export function applySidebarLayout(treeRoot: HTMLElement, active: string): void {
  // The sticky ancestor is what defines the sidebar's visible box in every
  // GitHub layout; fall back to a scroll container, then the tree's parent.
  // Once marked, reuse the mark (our overrides change the computed styles).
  const root =
    treeRoot.closest<HTMLElement>(`[${ATTR_SIDEBAR}]`) ??
    stickyRootOf(treeRoot) ??
    scrollContainerOf(treeRoot) ??
    treeRoot.parentElement;
  if (root === null) return;
  writeAttribute(root, ATTR_SIDEBAR, active);
  // Decided once here when the pane is rendered; `SidebarSizer` takes it (or
  // takes it again) when the pane appears later or the viewport width changes.
  if (!root.hasAttribute(ATTR_SIDEBAR_LAYOUT)) settleSidebarDirection(root);
  writeAttribute(treeRoot, ATTR_TREE_LIST, '');
  // Mark the chain between the root and the tree so heights propagate.
  const onPath = new Set<Element>();
  let current = treeRoot.parentElement;
  while (current !== null && current !== root) {
    onPath.add(current);
    writeAttribute(current, ATTR_SIDEBAR_PATH, '');
    current = current.parentElement;
  }
  for (const stale of root.querySelectorAll(`[${ATTR_SIDEBAR_PATH}]`)) {
    if (!onPath.has(stale)) stale.removeAttribute(ATTR_SIDEBAR_PATH);
  }
  sidebarSizer.attach(root);
  sidebarGeometry.watch(treeRoot, root);
}

function stickyRootOf(element: HTMLElement): HTMLElement | null {
  let current = element.parentElement;
  while (current !== null && current !== document.body) {
    const position = getComputedStyle(current).position;
    if (position === 'sticky' || position === 'fixed') return current;
    current = current.parentElement;
  }
  return null;
}

/**
 * Record how the pane root lays out its children. A flex-row root (Primer's
 * pane wrapper holds a divider beside the pane) must keep its direction —
 * forcing a column there would stack the 1px full-height divider under the
 * pane instead of next to it; anything else becomes a column.
 *
 * Measured with our own override lifted, so a previous decision cannot feed
 * back into the next one. Nothing is recorded while the root is `display:
 * none` (Primer hides a collapsed pane wrapper that way): its computed
 * `display` says nothing about the direction it will have once shown, and
 * the mistaken "column" that used to be cached here at that moment is
 * exactly what left an expanded-later tree at content height.
 */
function settleSidebarDirection(root: HTMLElement): void {
  const previous = root.getAttribute(ATTR_SIDEBAR_LAYOUT);
  if (previous !== null) root.removeAttribute(ATTR_SIDEBAR_LAYOUT);
  const style = getComputedStyle(root);
  const display = style.display;
  const isRow = display.includes('flex') && style.flexDirection.startsWith('row');
  const direction = display === 'none' ? previous : isRow ? 'row' : 'column';
  if (direction !== null) writeAttribute(root, ATTR_SIDEBAR_LAYOUT, direction);
}

/**
 * Whether `element` currently has a layout box (is not inside `display: none`).
 * `checkVisibility` answers from computed style; the `getClientRects` fallback
 * forces a layout, which on a page still streaming in a large diff is the most
 * expensive thing a content script can do per pass.
 */
function isRendered(element: HTMLElement): boolean {
  if (typeof element.checkVisibility === 'function') return element.checkVisibility();
  return element.getClientRects().length > 0;
}

export function removeSidebarLayout(root: ParentNode = document): void {
  sidebarSizer.detach();
  sidebarGeometry.detach();
  // Callers pass the tree's parent, but the pane and path marks sit on its
  // ancestors: widen the scope to the marked pane so they come off as well.
  const scope: ParentNode = root instanceof Element ? (root.closest(`[${ATTR_SIDEBAR}]`) ?? root) : root;
  const marked: Element[] = Array.from(scope.querySelectorAll(`[${ATTR_SIDEBAR}], [${ATTR_SIDEBAR_PATH}], [${ATTR_TREE_LIST}]`));
  if (scope instanceof Element && scope.hasAttribute(ATTR_SIDEBAR)) marked.push(scope);
  for (const element of marked) {
    element.removeAttribute(ATTR_SIDEBAR);
    element.removeAttribute(ATTR_SIDEBAR_LAYOUT);
    element.removeAttribute(ATTR_SIDEBAR_STICKY);
    element.removeAttribute(ATTR_SIDEBAR_PATH);
    element.removeAttribute(ATTR_TREE_LIST);
  }
  for (const element of scope.querySelectorAll<HTMLElement>(`[${ATTR_PINNED}]`)) {
    element.removeAttribute(ATTR_PINNED);
    element.style.removeProperty('bottom');
  }
  for (const element of scope.querySelectorAll<HTMLElement>(`.${TREE_SECTION_CLASS}--changes`)) element.remove();
}
