import { formatCount } from '../../lib/format';
import type { HiddenCategory } from '../../lib/matcher';
import { createElement, OWN_UI_ATTRIBUTE, svgFromString } from '../dom';
import { ICON_BEAKER, ICON_CHEVRON_RIGHT, ICON_FILE } from './icons';

export const TREE_SECTION_CLASS = 'geld-tree-section';

export interface TreeSectionFile {
  readonly path: string;
  /** Whether the file's diff is present on the page and can be scrolled to. */
  readonly available: boolean;
}

export interface TreeSectionState {
  readonly category: HiddenCategory;
  readonly files: readonly TreeSectionFile[];
  readonly expanded: boolean;
}

interface TreeSectionParts {
  readonly root: HTMLElement;
  readonly header: HTMLButtonElement;
  readonly title: HTMLElement;
  readonly count: HTMLElement;
  readonly list: HTMLUListElement;
}

const parts = new WeakMap<HTMLElement, TreeSectionParts>();

function splitPath(path: string): { readonly directory: string; readonly name: string } {
  const slash = path.lastIndexOf('/');
  if (slash === -1) return { directory: '', name: path };
  return { directory: path.slice(0, slash), name: path.slice(slash + 1) };
}

function build(onToggle: () => void, onSelect: (path: string) => void): TreeSectionParts {
  const title = createElement('span', { class: `${TREE_SECTION_CLASS}__title` });
  const count = createElement('span', { class: `${TREE_SECTION_CLASS}__count` });
  const header = createElement(
    'button',
    { type: 'button', class: `${TREE_SECTION_CLASS}__header`, 'aria-expanded': 'false' },
    [svgFromString(ICON_CHEVRON_RIGHT), svgFromString(ICON_BEAKER), title, count],
  );
  header.addEventListener('click', onToggle);

  const list = createElement('ul', { class: `${TREE_SECTION_CLASS}__list`, role: 'list', hidden: '' });
  list.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest<HTMLButtonElement>(`.${TREE_SECTION_CLASS}__item`);
    const path = button?.dataset.path;
    if (path === undefined || button === undefined || button === null) return;
    event.preventDefault();
    for (const item of list.querySelectorAll('[aria-current]')) item.removeAttribute('aria-current');
    button.setAttribute('aria-current', 'true');
    onSelect(path);
  });

  const root = createElement('div', { class: TREE_SECTION_CLASS, [OWN_UI_ATTRIBUTE]: '' }, [header, list]);
  return { root, header, title, count, list };
}

function renderItem(file: TreeSectionFile): HTMLElement {
  const { directory, name } = splitPath(file.path);
  const button = createElement(
    'button',
    {
      type: 'button',
      class: `${TREE_SECTION_CLASS}__item`,
      'data-path': file.path,
      title: file.path,
    },
    [
      svgFromString(ICON_FILE),
      createElement('span', { class: `${TREE_SECTION_CLASS}__text` }, [
        createElement('span', { class: `${TREE_SECTION_CLASS}__name` }, [name]),
        ...(directory === ''
          ? []
          : [createElement('span', { class: `${TREE_SECTION_CLASS}__dir` }, [directory])]),
      ]),
    ],
  );
  if (!file.available) {
    // GitHub has not rendered this diff yet (large PRs load progressively).
    // Clicking still works: the controller scrolls until it appears.
    button.dataset.pending = '';
    button.title = `${file.path} (diff not loaded yet; click to load and jump to it)`;
  }
  return createElement('li', { role: 'listitem' }, [button]);
}

/**
 * Ensure the "Tests" pseudo-section exists right after the file tree and
 * lists the hidden files. It is deliberately not part of the `role=tree`
 * widget so it cannot be mistaken for a real directory.
 */
export function renderTreeSection(
  treeRoot: HTMLElement,
  state: TreeSectionState,
  onToggle: () => void,
  onSelect: (path: string) => void,
): HTMLElement {
  const host = treeRoot.parentElement ?? treeRoot;
  let existing = Array.from(host.children).find(
    (child): child is HTMLElement => child instanceof HTMLElement && child.classList.contains(TREE_SECTION_CLASS),
  );
  let section = existing === undefined ? undefined : parts.get(existing);
  if (existing !== undefined && section === undefined) {
    existing.remove();
    existing = undefined;
  }
  if (section === undefined) {
    section = build(onToggle, onSelect);
    parts.set(section.root, section);
    treeRoot.insertAdjacentElement('afterend', section.root);
  }

  section.title.textContent = state.category.title;
  section.count.textContent = formatCount(state.files.length);
  section.header.setAttribute(
    'aria-label',
    `${state.category.title}: ${formatCount(state.files.length)} hidden ${state.category.nounPlural}`,
  );
  section.header.setAttribute('aria-expanded', String(state.expanded));
  section.list.hidden = !state.expanded;
  section.root.dataset.expanded = String(state.expanded);

  const signature = state.files.map((file) => `${file.path}\u0000${file.available ? 1 : 0}`).join('\n');
  if (section.list.dataset.signature !== signature) {
    const selected = section.list.querySelector<HTMLElement>('[aria-current]')?.dataset.path;
    section.list.dataset.signature = signature;
    section.list.replaceChildren(...state.files.map(renderItem));
    if (selected !== undefined) {
      section.list
        .querySelector(`.${TREE_SECTION_CLASS}__item[data-path="${CSS.escape(selected)}"]`)
        ?.setAttribute('aria-current', 'true');
    }
  }
  return section.root;
}

export function removeTreeSection(root: ParentNode): void {
  for (const element of root.querySelectorAll(`.${TREE_SECTION_CLASS}`)) element.remove();
}
