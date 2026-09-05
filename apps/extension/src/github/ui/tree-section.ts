import type { HiddenCategory } from '@geld/core';
import { formatCount } from '@geld/core';
import { createElement, OWN_UI_ATTRIBUTE, svgFromString } from '../dom';
import { CATEGORY_ICONS, ICON_CHEVRON_RIGHT, ICON_FILE, ICON_FILE_DIRECTORY, ICON_FILE_DIFF } from './icons';

export const TREE_SECTION_CLASS = 'geld-tree-section';

export interface TreeSectionFile {
  readonly path: string;
  /** Whether the file's diff is present on the page and can be scrolled to. */
  readonly available: boolean;
  /** GitHub's own status icon for the file, cloned into our tree when present. */
  readonly statusIcon: SVGElement | null;
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
  readonly resizeObserver: ResizeObserver | null;
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

function renderDir(dir: DirNode, level: number, collapsed: ReadonlySet<string>): HTMLLIElement {
  const isCollapsed = collapsed.has(dir.path);
  const button = row(
    level,
    [
      createElement('span', { class: 'geld-tree__toggle' }, [svgFromString(ICON_CHEVRON_RIGHT)]),
      createElement('span', { class: 'geld-tree__visual geld-tree__visual--dir' }, [svgFromString(ICON_FILE_DIRECTORY)]),
      createElement('span', { class: 'geld-tree__label' }, [dir.name]),
    ],
    { 'data-dir': dir.path, 'aria-expanded': String(!isCollapsed), title: dir.path },
  );
  const group = createElement('ul', { class: 'geld-tree__group', role: 'group' }, renderChildren(dir, level + 1, collapsed));
  group.style.setProperty('--geld-level', String(level));
  group.hidden = isCollapsed;
  return createElement('li', { class: 'geld-tree__item geld-tree__item--dir' }, [button, group]);
}

function renderFile(node: FileNode, level: number): HTMLLIElement {
  const trailing: Node[] = [];
  if (node.file.statusIcon !== null) {
    const icon = node.file.statusIcon.cloneNode(true);
    if (icon instanceof SVGElement) {
      icon.removeAttribute('id');
      trailing.push(createElement('span', { class: 'geld-tree__visual geld-tree__visual--trailing' }, [icon]));
    }
  }
  const button = row(
    level,
    [
      createElement('span', { class: 'geld-tree__toggle geld-tree__toggle--spacer' }),
      createElement('span', { class: 'geld-tree__visual' }, [svgFromString(ICON_FILE)]),
      createElement('span', { class: 'geld-tree__label' }, [node.name]),
      ...trailing,
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
  const header = row(
    1,
    [
      createElement('span', { class: 'geld-tree__toggle' }, [svgFromString(ICON_CHEVRON_RIGHT)]),
      createElement('span', { class: 'geld-tree__visual geld-tree__visual--root' }, [
        svgFromString(CATEGORY_ICONS[category.id]),
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

  const resizeObserver =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => {
          const treeRoot = root.parentElement?.querySelector<HTMLElement>('ul[role="tree"]');
          if (treeRoot instanceof HTMLElement) syncGeometry(root, treeRoot);
        });

  return { root, header, title, count, group, resizeObserver };
}

/**
 * Match the horizontal box of GitHub's tree list exactly (margins, padding and
 * width), so our rows line up with theirs and hover backgrounds stop where
 * GitHub's do rather than running into the pane border.
 */
function syncGeometry(section: HTMLElement, treeRoot: HTMLElement): void {
  const style = getComputedStyle(treeRoot);
  section.style.marginLeft = style.marginLeft;
  section.style.marginRight = style.marginRight;
  section.style.paddingLeft = style.paddingLeft;
  section.style.paddingRight = style.paddingRight;

  const parent = treeRoot.parentElement;
  if (parent === null) return;
  const parentStyle = getComputedStyle(parent);
  const available =
    parent.clientWidth -
    (Number.parseFloat(parentStyle.paddingLeft) || 0) -
    (Number.parseFloat(parentStyle.paddingRight) || 0) -
    (Number.parseFloat(style.marginLeft) || 0) -
    (Number.parseFloat(style.marginRight) || 0);
  const width = treeRoot.getBoundingClientRect().width;
  section.style.width = width > 0 && Math.abs(available - width) > 1 ? `${width}px` : '';
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
    section.resizeObserver?.observe(treeRoot);
  } else if (after !== null && section.root.previousElementSibling !== after) {
    after.insertAdjacentElement('afterend', section.root);
  }

  section.root.dataset.view = state.view;
  section.title.textContent = state.category.title;
  section.count.textContent = formatCount(state.files.length);
  section.header.setAttribute(
    'aria-label',
    `${state.category.title}: ${formatCount(state.files.length)} hidden ${state.category.nounPlural}`,
  );
  section.header.setAttribute('aria-expanded', String(state.active));
  section.group.hidden = !state.active;
  section.root.toggleAttribute('data-active', state.active);

  const signature = `${state.stateKey}#${state.category.id}\n${state.files
    .map((file) => `${file.path}\u0000${file.available ? 1 : 0}\u0000${file.statusIcon?.getAttribute('title') ?? ''}`)
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

  syncGeometry(section.root, treeRoot);
  return section.root;
}

/** Remove all sections, or only those whose category is not in `keep`. */
export function removeTreeSection(root: ParentNode, keep: ReadonlySet<string> | null = null): void {
  for (const element of root.querySelectorAll<HTMLElement>(`.${TREE_SECTION_CLASS}`)) {
    const category = element.dataset.category;
    if (keep !== null && category !== undefined && (category === CHANGES_SECTION_ID || keep.has(category))) continue;
    parts.get(element)?.resizeObserver?.disconnect();
    element.remove();
  }
}

/* ------------------------------------------------------------------------- */
/* Sidebar accordion                                                          */
/* ------------------------------------------------------------------------- */

export const CHANGES_SECTION_ID = 'changes';
const ATTR_SIDEBAR = 'data-geld-sidebar';
const ATTR_SIDEBAR_PATH = 'data-geld-sidebar-path';
const ATTR_TREE_LIST = 'data-geld-tree-list';

interface ChangesHeaderParts {
  readonly root: HTMLElement;
  readonly header: HTMLButtonElement;
  readonly count: HTMLElement;
}

const changesParts = new WeakMap<HTMLElement, ChangesHeaderParts>();

/**
 * A header for GitHub's own tree ("Changes"), so it behaves like the other
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
        createElement('span', { class: 'geld-tree__toggle' }, [svgFromString(ICON_CHEVRON_RIGHT)]),
        createElement('span', { class: 'geld-tree__visual geld-tree__visual--root' }, [svgFromString(ICON_FILE_DIFF)]),
        createElement('span', { class: 'geld-tree__label geld-tree__label--root' }, ['Changes']),
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
  parts.root.dataset.view = state.view;
  parts.count.textContent = formatCount(state.count);
  parts.header.setAttribute('aria-expanded', String(state.active));
  parts.header.setAttribute('aria-label', `Changes: ${formatCount(state.count)} files`);
  parts.root.toggleAttribute('data-active', state.active);
  syncGeometry(parts.root, treeRoot);
  centreFilterAboveHeader(parts.root, treeRoot);
  return parts.root;
}

/**
 * GitHub's "Filter files" field sits between the sidebar's top edge and our
 * Changes header. Give the header exactly the top margin that makes the space
 * below the field equal the space above it, whatever spacing the view uses.
 */
function centreFilterAboveHeader(header: HTMLElement, treeRoot: HTMLElement): void {
  const scroller = treeRoot.closest<HTMLElement>(`[${ATTR_SIDEBAR}]`);
  if (scroller === null) return;
  const filter = previousVisibleBlock(header, scroller);
  if (filter === null) return;

  // The visible edge is the sidebar's border box (its padding is part of the gap).
  const boundaryTop = scroller.getBoundingClientRect().top;
  const filterRect = filter.getBoundingClientRect();
  const gapAbove = filterRect.top - boundaryTop;
  if (gapAbove < 0 || gapAbove > 64) return; // Something unexpected sits above; leave GitHub's spacing alone.

  const currentMargin = Number.parseFloat(getComputedStyle(header).marginTop) || 0;
  const gapBelow = header.getBoundingClientRect().top - filterRect.bottom;
  const margin = Math.max(MIN_HEADER_GAP, Math.round(currentMargin + (gapAbove - gapBelow)));
  const value = `${margin}px`;
  if (header.style.marginTop !== value) header.style.marginTop = value;
}

const MIN_HEADER_GAP = 8;

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
 * Keeps the sidebar exactly as tall as its visible part. GitHub's sticky pane
 * is 100vh tall, so before the page is scrolled its bottom (and our accordion
 * headers) sit below the fold. Sizing it to `viewport bottom − pane top` pins
 * the headers to the bottom of the viewport and hands every pixel gained by
 * scrolling to the open panel.
 */
class SidebarSizer {
  private scroller: HTMLElement | null = null;
  private frame = 0;
  private lastHeight = -1;

  attach(scroller: HTMLElement): void {
    if (this.scroller === scroller) {
      this.schedule();
      return;
    }
    this.detach();
    this.scroller = scroller;
    window.addEventListener('scroll', this.schedule, { passive: true });
    window.addEventListener('resize', this.schedule, { passive: true });
    this.update();
  }

  detach(): void {
    window.removeEventListener('scroll', this.schedule);
    window.removeEventListener('resize', this.schedule);
    if (this.frame !== 0) cancelAnimationFrame(this.frame);
    this.frame = 0;
    if (this.scroller !== null) {
      this.scroller.style.removeProperty('height');
      this.scroller.style.removeProperty('max-height');
    }
    this.scroller = null;
    this.lastHeight = -1;
  }

  private readonly schedule = (): void => {
    if (this.frame !== 0) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.update();
    });
  };

  private update(): void {
    const scroller = this.scroller;
    if (scroller === null || !scroller.isConnected) return;
    // Only sticky sidebars need this; stacked (narrow) layouts keep GitHub's sizing.
    if (!isWithinSticky(scroller)) {
      if (this.lastHeight !== -1) {
        scroller.style.removeProperty('height');
        scroller.style.removeProperty('max-height');
        this.lastHeight = -1;
      }
      return;
    }
    const top = Math.max(0, scroller.getBoundingClientRect().top);
    const height = Math.max(MIN_SIDEBAR_HEIGHT, Math.round(window.innerHeight - top));
    if (height === this.lastHeight) return;
    this.lastHeight = height;
    scroller.style.setProperty('height', `${height}px`);
    scroller.style.setProperty('max-height', `${height}px`);
  }
}

const MIN_SIDEBAR_HEIGHT = 160;

function isWithinSticky(element: HTMLElement): boolean {
  let current: HTMLElement | null = element;
  for (let depth = 0; current !== null && depth < 4; depth += 1) {
    if (getComputedStyle(current).position === 'sticky') return true;
    current = current.parentElement;
  }
  return false;
}

const sidebarSizer = new SidebarSizer();

/**
 * Turn the sidebar's scroll container into a full-height flex column so the
 * active panel fills the space and scrolls on its own while every header stays
 * visible. Only attributes are set; GitHub's DOM order is untouched.
 */
export function applySidebarLayout(treeRoot: HTMLElement, active: string): void {
  // Once marked, the scroller has `overflow: hidden`, so reuse the mark rather
  // than searching for an overflowing ancestor again.
  const scroller = treeRoot.closest<HTMLElement>(`[${ATTR_SIDEBAR}]`) ?? scrollContainerOf(treeRoot) ?? treeRoot.parentElement;
  if (scroller === null) return;
  scroller.setAttribute(ATTR_SIDEBAR, active);
  treeRoot.setAttribute(ATTR_TREE_LIST, '');
  // Mark the chain between the scroller and the tree so heights propagate.
  const onPath = new Set<Element>();
  let current = treeRoot.parentElement;
  while (current !== null && current !== scroller) {
    onPath.add(current);
    current.setAttribute(ATTR_SIDEBAR_PATH, '');
    current = current.parentElement;
  }
  for (const stale of scroller.querySelectorAll(`[${ATTR_SIDEBAR_PATH}]`)) {
    if (!onPath.has(stale)) stale.removeAttribute(ATTR_SIDEBAR_PATH);
  }
  sidebarSizer.attach(scroller);
}

export function removeSidebarLayout(root: ParentNode = document): void {
  sidebarSizer.detach();
  for (const element of root.querySelectorAll(`[${ATTR_SIDEBAR}], [${ATTR_SIDEBAR_PATH}], [${ATTR_TREE_LIST}]`)) {
    element.removeAttribute(ATTR_SIDEBAR);
    element.removeAttribute(ATTR_SIDEBAR_PATH);
    element.removeAttribute(ATTR_TREE_LIST);
  }
  for (const element of root.querySelectorAll<HTMLElement>(`.${TREE_SECTION_CLASS}--changes`)) element.remove();
}
