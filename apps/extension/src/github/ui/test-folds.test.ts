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

/** Rows of GitHub's classic unified view: context (` `) and added (`+`) lines with their numbers, and hunk rows with expanders. */
type Row = { readonly kind: 'line'; readonly old: number | null; readonly new: number; readonly text: string } | { readonly kind: 'hunk'; readonly directions: readonly string[] };

function rowHtml(row: Row): string {
  if (row.kind === 'hunk') return `<tr class="js-expandable-line"><td class="blob-num blob-num-expandable" colspan="2">${row.directions.map((direction) => `<button class="js-expand directional-expander" data-direction="${direction}">${direction}</button>`).join('')}</td><td class="blob-code blob-code-hunk">@@</td></tr>`;
  const added = row.old === null;
  const kind = added ? 'addition' : 'context';
  const oldCell = row.old === null ? `<td class="blob-num blob-num-${kind}"></td>` : `<td id="${ANCHOR}L${row.old}" class="blob-num blob-num-${kind}"></td>`;
  return `<tr>${oldCell}<td id="${ANCHOR}R${row.new}" class="blob-num blob-num-${kind}"></td><td class="blob-code blob-code-${kind}"><span class="blob-code-inner">${row.text}</span></td></tr>`;
}

function fileWith(rows: readonly Row[]): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = `<table><tbody>${rows.map(rowHtml).join('')}</tbody></table>`;
  document.body.append(root);
  return root;
}

const context = (number: number, text: string): Row => ({ kind: 'line', old: number, new: number, text });

describe('a test the page shows only part of', () => {
  const file = ["describe('array', () => {", "  it('spies', () => {", '    const spy = vi.fn()', '    spy()', '    expect(spy).toHaveBeenCalled()', '  })', '', "  it('adds', () => {", '    expect(1).toBe(1)', '  })', '})'];

  it('folds from its first line, closing line and all, and opened presses GitHub\u2019s expander until the rest is shown', () => {
    document.body.replaceChildren();
    const root = fileWith([
      { kind: 'hunk', directions: ['up'] },
      context(5, file[4] ?? ''),
      context(6, file[5] ?? ''),
      context(7, ''),
      { kind: 'line', old: null, new: 8, text: file[7] ?? '' },
      { kind: 'line', old: null, new: 9, text: file[8] ?? '' },
      { kind: 'line', old: null, new: 10, text: file[9] ?? '' },
      { kind: 'line', old: 8, new: 11, text: file[10] ?? '' },
    ]);
    const presses: string[] = [];
    const up = root.querySelector<HTMLButtonElement>('button[data-direction="up"]');
    up?.addEventListener('click', () => {
      presses.push('up');
      // GitHub shows the lines above the hunk where they belong.
      const scratch = fileWith([1, 2, 3, 4].map((number) => context(number, file[number - 1] ?? '')));
      up.closest('tr')?.after(...scratch.querySelectorAll('tr'));
      scratch.remove();
    });
    const opened = new Set<string>();
    applyTestFolds(root, ANCHOR, BUILT_IN_TEST_SYNTAXES, opened, file);
    const spies = [...root.querySelectorAll('tr[data-geld-test-row]')].find((row) => row.textContent?.includes('spies'));
    expect(spies?.querySelector('.geld-test-row__lines')?.textContent).toBe('2');
    // Its closing line is in the fold.
    expect(root.querySelector(`#${ANCHOR}R6`)?.closest('tr')?.getAttribute('data-geld-test-fold')).toBe('hidden');
    spies?.querySelector('button')?.click();
    expect(presses).toEqual(['up']);
    applyTestFolds(root, ANCHOR, BUILT_IN_TEST_SYNTAXES, opened, file);
    // Everything from its declaration to its closing line is on the page and shown; nothing more to press.
    for (const number of [2, 3, 4, 5, 6]) expect(root.querySelector(`#${ANCHOR}R${number}`)?.closest('tr')?.hasAttribute('data-geld-test-fold')).toBe(false);
    applyTestFolds(root, ANCHOR, BUILT_IN_TEST_SYNTAXES, opened, file);
    expect(presses).toEqual(['up']);
  });

  it('folds the edge between two hunks inside a test, and shows what lies between when opened', () => {
    document.body.replaceChildren();
    const long = ["it('reads', () => {", '  const a = read(1)', '  const b = read(2)', '  const c = read(3)', '  const d = read(4)', '  const e = read(5)', '  expect(a + b + c + d + e).toBe(15)', '})'];
    const root = fileWith([
      context(1, long[0] ?? ''),
      context(2, long[1] ?? ''),
      { kind: 'hunk', directions: ['all'] },
      context(6, long[5] ?? ''),
      context(7, long[6] ?? ''),
      context(8, long[7] ?? ''),
    ]);
    const presses: string[] = [];
    root.querySelector('button[data-direction="all"]')?.addEventListener('click', () => presses.push('all'));
    const opened = new Set<string>();
    applyTestFolds(root, ANCHOR, BUILT_IN_TEST_SYNTAXES, opened, long);
    expect(root.querySelectorAll('tr[data-geld-test-row]')).toHaveLength(1);
    expect(root.querySelector('tr.js-expandable-line')?.getAttribute('data-geld-test-fold')).toBe('hidden');
    root.querySelector<HTMLButtonElement>('tr[data-geld-test-row] button')?.click();
    expect(root.querySelector('tr.js-expandable-line')?.hasAttribute('data-geld-test-fold')).toBe(false);
    expect(presses).toEqual(['all']);
  });

  it('presses the expander below a test whose end lies past the hunk', () => {
    document.body.replaceChildren();
    const long = ["it('reads', () => {", '  const a = read(1)', '  const b = read(2)', '  expect(a + b).toBe(3)', '})'];
    const root = fileWith([context(1, long[0] ?? ''), context(2, long[1] ?? ''), context(3, long[2] ?? ''), { kind: 'hunk', directions: ['down'] }]);
    const presses: string[] = [];
    root.querySelector('button[data-direction="down"]')?.addEventListener('click', () => presses.push('down'));
    const opened = new Set<string>();
    applyTestFolds(root, ANCHOR, BUILT_IN_TEST_SYNTAXES, opened, long);
    root.querySelector<HTMLButtonElement>('tr[data-geld-test-row] button')?.click();
    expect(presses).toEqual(['down']);
    // Nothing arrived yet: the same press is not repeated on the next pass.
    applyTestFolds(root, ANCHOR, BUILT_IN_TEST_SYNTAXES, opened, long);
    expect(presses).toEqual(['down']);
  });
});
