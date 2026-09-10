import type { DiffEntry } from './model';

/**
 * GitHub collapses two kinds of file behind a "Load diff" button: very large
 * diffs and files it considers generated. Only the first is expanded here; the
 * reason text GitHub renders next to the button tells them apart in both the
 * legacy view (`aria-describedby` → "Large diffs are not rendered by default.")
 * and the React view (the sentence sits beside the button).
 */
const LARGE_REASON = /large diffs? (?:is|are) not rendered/i;
const LOAD_LABEL = /^\s*load diff\s*$/i;

/** Roots whose button was already clicked; a re-render that brings the button back gets a fresh root. */
const clicked = new WeakSet<Element>();

function explainsLargeDiff(button: HTMLButtonElement, root: HTMLElement): boolean {
  const describedBy = button.getAttribute('aria-describedby');
  if (describedBy !== null) {
    for (const id of describedBy.split(/\s+/)) {
      const reason = document.getElementById(id);
      if (reason !== null && LARGE_REASON.test(reason.textContent ?? '')) return true;
    }
  }
  // The reason is a sibling paragraph in the collapsed placeholder: look at the
  // button's parent and grandparent only, and never past this file's root
  // (which would read the neighbours' placeholders too).
  let scope: HTMLElement | null = button.parentElement;
  for (let depth = 0; scope !== null && scope !== root && depth < 2; depth += 1) {
    if (LARGE_REASON.test(scope.textContent ?? '')) return true;
    scope = scope.parentElement;
  }
  return false;
}

function loadDiffButton(root: HTMLElement): HTMLButtonElement | null {
  for (const button of root.querySelectorAll('button')) {
    if (button.disabled || !LOAD_LABEL.test(button.textContent ?? '')) continue;
    if (explainsLargeDiff(button, root)) return button;
  }
  return null;
}

/**
 * Click "Load diff" on every visible entry GitHub collapsed for size. Entries
 * Geld hides are left alone: expanding them would fetch diffs nobody asked for.
 */
export function expandLargeDiffs(entries: readonly DiffEntry[], isHidden: (entry: DiffEntry) => boolean): void {
  for (const entry of entries) {
    if (clicked.has(entry.root) || isHidden(entry)) continue;
    const button = loadDiffButton(entry.root);
    if (button === null) continue;
    clicked.add(entry.root);
    button.click();
  }
}
