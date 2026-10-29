// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { BUILT_IN_TEST_SYNTAXES } from '@geld/core';
import { applyCommentRows } from './comment-rows';
import { applyTestFolds } from './test-folds';

const ANCHOR = 'diff-abc';

/** A new file in GitHub's classic unified view: every line added, its anchor on the new-side number cell. */
function addedFile(lines: readonly string[]): HTMLElement {
  const root = document.createElement('div');
  const rows = lines
    .map((text, index) => `<tr><td class="blob-num blob-num-addition"></td><td id="${ANCHOR}R${index + 1}" class="blob-num blob-num-addition"></td><td class="blob-code blob-code-addition"><span class="blob-code-inner">${text}</span></td></tr>`)
    .join('');
  root.innerHTML = `<table><tbody>${rows}</tbody></table>`;
  document.body.append(root);
  return root;
}

describe('a comment-only run inside a folded test', () => {
  it('folds its note away with its lines, and the tests on either side still share one border', () => {
    document.body.replaceChildren();
    const root = addedFile(["it('one', () => {", '  expect(1).toBe(1);', '});', '', "it('two', () => {", '  // why two', '  expect(2).toBe(2);', '});']);
    // The blank between the tests and the comment in the second are comment-only lines (comment-lines.ts).
    applyCommentRows(root, ANCHOR, { added: [4, 6], removed: [] }, new Set());
    expect(root.querySelectorAll('tr[data-geld-line-note]')).toHaveLength(2);
    applyTestFolds(root, ANCHOR, BUILT_IN_TEST_SYNTAXES, new Set());
    for (const note of root.querySelectorAll('tr[data-geld-line-note]')) expect(note.getAttribute('data-geld-test-fold')).toBe('hidden');
    const titles = [...root.querySelectorAll('tr[data-geld-test-row]')];
    expect(titles.map((row) => row.querySelector('.geld-test-row__title')?.textContent)).toEqual(['one', 'two']);
    expect(titles[1]?.hasAttribute('data-joined')).toBe(true);
    // Every row shown is a title row: no note stands alone between them.
    const shown = [...root.querySelectorAll('tr')].filter((row) => row.getAttribute('data-geld-test-fold') !== 'hidden');
    expect(shown.every((row) => row.hasAttribute('data-geld-test-row'))).toBe(true);
  });

  it('shows the note again with its lines once the test is opened', () => {
    document.body.replaceChildren();
    const root = addedFile(["it('two', () => {", '  // why two', '  expect(2).toBe(2);', '});']);
    applyCommentRows(root, ANCHOR, { added: [2], removed: [] }, new Set());
    const opened = new Set<string>();
    applyTestFolds(root, ANCHOR, BUILT_IN_TEST_SYNTAXES, opened);
    root.querySelector<HTMLButtonElement>('tr[data-geld-test-row] button')?.click();
    expect(root.querySelector('tr[data-geld-line-note]')?.hasAttribute('data-geld-test-fold')).toBe(false);
  });
});
