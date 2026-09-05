import type { HiddenCategory } from '../../lib/categories';
import { formatCount } from '../../lib/format';
import { createElement, OWN_UI_ATTRIBUTE, svgFromString } from '../dom';
import { ICON_BEAKER, ICON_CHEVRON_RIGHT, ICON_EYE_CLOSED, ICON_FILE, ICON_FILE_DIRECTORY } from './icons';

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
  readonly expanded: boolean;
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
        svgFromString(category.id === 'tests' ? ICON_BEAKER : ICON_EYE_CLOSED),
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
  section.header.setAttribute('aria-expanded', String(state.expanded));
  section.group.hidden = !state.expanded;
  section.root.dataset.expanded = String(state.expanded);

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
    if (keep !== null && element.dataset.category !== undefined && keep.has(element.dataset.category)) continue;
    parts.get(element)?.resizeObserver?.disconnect();
    element.remove();
  }
}
