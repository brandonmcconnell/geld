import { OWN_UI_ATTRIBUTE } from '../dom';

/** GitHub's classic files view; the React view's field is found by its label instead. */
const FILTER_FIELD_ID = 'file-tree-filter-field';

/**
 * What the reader has typed into GitHub's file filter above the tree ("Filter changed files"), trimmed. '' when the
 * field is empty or not on the page. Only the typed text counts: GitHub's other filters (extension, viewed, files you
 * own) hide tree items too, and those must never move the reader to another panel.
 */
export function fileFilterQuery(treeRoot: HTMLElement): string {
  const byId = document.getElementById(FILTER_FIELD_ID);
  const field = byId instanceof HTMLInputElement ? byId : filterFieldNear(treeRoot);
  return field === null ? '' : field.value.trim();
}

function filterFieldNear(treeRoot: HTMLElement): HTMLInputElement | null {
  let node = treeRoot.parentElement;
  for (let depth = 0; node !== null && depth < 6; depth += 1, node = node.parentElement) {
    for (const input of node.querySelectorAll<HTMLInputElement>('input')) {
      if (input.closest(`[${OWN_UI_ATTRIBUTE}]`) !== null) continue;
      if (/filter/i.test(`${input.getAttribute('aria-label') ?? ''} ${input.placeholder}`)) return input;
    }
  }
  return null;
}

/**
 * The panel to show while the reader filters the tree: theirs while it holds a match, else the first in sidebar order
 * that does, else theirs. Recomputed every pass, so narrowing and widening the query moves back as well as forward.
 */
export function panelForSearch(home: string, order: readonly string[], matches: ReadonlyMap<string, number>): string {
  if ((matches.get(home) ?? 0) > 0) return home;
  return order.find((panel) => (matches.get(panel) ?? 0) > 0) ?? home;
}
