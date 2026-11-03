// @vitest-environment happy-dom
import * as core from '@geld/core';
import { readGitLabDiff } from '../gitlab/diff';
import { readBitbucketDiff } from '../bitbucket/diff';
import { applyProviderLineFolds, ATTR_PROVIDER_FOLD_ROW, clearProviderLineFolds } from './line-folds';

type Provider = 'gitlab' | 'bitbucket';
type Line = { old: number | null; new: number | null; text: string };
const PATH = 'src/example.test.ts';
const oldTest: Line[] = ["it('old test', () => {", '  expect(1).toBe(1);', '});'].map((text, index) => ({ old: 10 + index, new: null, text }));
const newTest: Line[] = ["it('new test', () => {", '  expect(2).toBe(2);', '});'].map((text, index) => ({ old: null, new: 30 + index, text }));

function fixture(provider: Provider) {
  // Row/control structure reduced from installed public MR266334 and PR27 captures.
  document.body.innerHTML = provider === 'gitlab'
    ? `<article data-rapid-diffs><div data-diffs-list><diff-file data-file-data='{"new_path":"${PATH}"}'><table><tbody></tbody></table></diff-file></div></article>`
    : `<div role="region" aria-label="Diff"><div><div id="chg-${PATH}"></div><article data-qa="branch-diff-file"><div class="diff-chunk"><div class="diff-chunk-inner"></div></div></article></div></div>`;
  const root = document.querySelector<HTMLElement>(provider === 'gitlab' ? 'diff-file' : '[role="region"] > div')!;
  const content = root.querySelector<HTMLElement>(provider === 'gitlab' ? 'tbody' : '.diff-chunk-inner')!;
  function line(source: Line): HTMLElement {
    const row = document.createElement(provider === 'gitlab' ? 'tr' : 'div');
    if (provider === 'gitlab') {
      row.className = 'rd-hunk-lines rd-hunk-lines-inline';
      for (const side of ['old', 'new'] as const) {
        const cell = document.createElement('td');
        cell.className = 'rd-line-number'; cell.dataset.position = side;
        if (source[side] !== null) { const anchor = document.createElement('a'); anchor.dataset.lineNumber = String(source[side]); cell.append(anchor); }
        row.append(cell);
      }
      const cell = document.createElement('td'); cell.className = 'rd-line-content';
      const text = document.createElement('pre'); text.className = 'rd-line-text'; text.textContent = `${source.text}\n`; cell.append(text); row.append(cell);
    } else {
      row.dataset.qa = 'code-line';
      const numbers = document.createElement('div'); numbers.dataset.key = 'code-line-number';
      if (source.old !== null) numbers.dataset.oldLineNumber = String(source.old);
      if (source.new !== null) numbers.dataset.newLineNumber = String(source.new);
      const code = document.createElement('span'); code.dataset.lineType = source.old === null ? '+' : source.new === null ? '-' : ' '; code.textContent = source.text;
      row.append(numbers, code);
    }
    content.append(row); return row;
  }
  function boundary(valid = true): { row: HTMLElement; button: HTMLButtonElement } {
    const row = document.createElement(provider === 'gitlab' ? 'tr' : 'div');
    row.className = provider === 'gitlab' ? 'rd-hunk-header rd-hunk-header-inline' : 'chunk-heading-wrapper gutter-width-apply-padding-left';
    const holder = document.createElement(provider === 'gitlab' ? 'td' : 'div');
    if (provider === 'gitlab') holder.className = 'rd-hunk-header-buttons';
    else { holder.className = 'show-more-lines-wrapper'; }
    const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Show hidden lines';
    if (provider === 'gitlab') { button.dataset.click = valid ? 'expandLines' : 'other'; button.dataset.expandDirection = 'both'; }
    else button.dataset.qa = valid ? 'pr-diff-show-more-lines-below' : 'pr-diff-show-more-lines-is-dummy-chunk';
    holder.append(button); row.append(holder); content.append(row); return { row, button };
  }
  const read = () => (provider === 'gitlab' ? readGitLabDiff(document) : readBitbucketDiff(document))!;
  const apply = () => { const view = read(); applyProviderLineFolds(view, [{ path: PATH, additions: 3, deletions: 3 }], core.DEFAULT_SETTINGS); return view; };
  const folds = () => [...root.querySelectorAll<HTMLElement>(`[${ATTR_PROVIDER_FOLD_ROW}^="test:"]`)];
  return { root, content, line, boundary, read, apply, folds };
}

afterEach(() => { clearProviderLineFolds(); document.body.replaceChildren(); vi.restoreAllMocks(); });

for (const provider of ['gitlab', 'bitbucket'] as const) {
  describe(`${provider} native context boundaries`, () => {
    it('separates changed hunks without altering or activating the original control', () => {
      const f = fixture(provider); oldTest.forEach(f.line); const gap = f.boundary(); newTest.forEach(f.line);
      const click = vi.fn(); gap.button.addEventListener('click', click); const nativeControl = gap.row.outerHTML;
      const view = f.apply();
      expect(view.entries[0]?.readLines?.().map((line) => line.kind)).toEqual(['removed', 'removed', 'removed', 'hunk', 'added', 'added', 'added']);
      expect(f.folds().map((row) => row.dataset.status).sort()).toEqual(['added', 'removed']);
      expect(gap.row.outerHTML).toBe(nativeControl); expect(gap.button.isConnected).toBe(true); expect(click).not.toHaveBeenCalled();
    });
    it('discloses displayed-only scope for a truncated terminal test', () => {
      const f = fixture(provider); newTest.slice(0, 2).forEach(f.line); const gap = f.boundary(); f.apply();
      expect(f.folds()).toHaveLength(1); expect(f.folds()[0]?.textContent).toContain('shown lines');
      expect(f.folds()[0]?.querySelector('button')?.getAttribute('aria-label')).toContain('Only displayed lines are available');
      expect(gap.row.hasAttribute('data-geld-provider-line-hidden')).toBe(false);
    });
    it('retains legitimate rename pairing within one changed hunk', () => {
      const f = fixture(provider); oldTest.forEach(f.line); newTest.forEach(f.line); f.apply();
      expect(f.folds()).toHaveLength(1); expect(f.folds()[0]?.dataset.status).toBe('renamed');
    });
    it('does not treat unknown controls, dummy chunks or no-newline annotations as context proof', () => {
      const f = fixture(provider); oldTest.forEach(f.line); f.boundary(false);
      const annotation = document.createElement(provider === 'gitlab' ? 'tr' : 'div'); annotation.textContent = 'No newline at end of file'; f.content.append(annotation);
      newTest.forEach(f.line); const view = f.apply();
      expect(view.entries[0]?.readLines?.().some((line) => line.kind === 'hunk')).toBe(false);
      expect(f.folds()).toHaveLength(1); expect(f.folds()[0]?.dataset.status).toBe('renamed');
    });
    it('emits one boundary for a header with multiple known controls and ignores owned controls', () => {
      const f = fixture(provider); f.line(newTest[0]!); const gap = f.boundary(); const other = gap.button.cloneNode(true) as HTMLButtonElement;
      if (provider === 'gitlab') other.dataset.expandDirection = 'up'; else other.dataset.qa = 'pr-diff-show-more-lines-above';
      gap.button.after(other); const owned = f.boundary(); owned.row.dataset.geldUi = '';
      expect(f.read().entries[0]?.readLines?.().filter((line) => line.kind === 'hunk').map((line) => line.root)).toEqual([gap.row]);
    });
    it('rejects an owned control inside an otherwise native-looking context header', () => {
      const f = fixture(provider); f.line(newTest[0]!); const gap = f.boundary(); gap.button.parentElement!.dataset.geldUi = '';
      expect(f.read().entries[0]?.readLines?.().some((line) => line.kind === 'hunk')).toBe(false);
    });
    it('invalidates cached fold structure when only a terminal boundary changes', () => {
      const f = fixture(provider); newTest.slice(0, 2).forEach(f.line); const outline = vi.spyOn(core, 'outlineTestFolds'); f.apply();
      expect(outline).toHaveBeenCalledTimes(1); const gap = f.boundary(); f.apply();
      expect(outline).toHaveBeenCalledTimes(2); expect(f.folds()[0]?.textContent).toContain('shown lines');
      gap.row.remove(); f.apply(); expect(outline).toHaveBeenCalledTimes(3); expect(f.folds()[0]?.textContent).not.toContain('shown lines');
    });
  });
}

it('keeps GitLab split-side text and numbers around one native context boundary', () => {
  const f = fixture('gitlab');
  const row = f.line({ old: 10, new: 20, text: 'old text' }); row.className = 'rd-hunk-lines rd-hunk-lines-parallel';
  const old = row.querySelector<HTMLElement>('.rd-line-content')!; old.dataset.position = 'old';
  const next = old.cloneNode(true) as HTMLElement; next.dataset.position = 'new'; next.querySelector('.rd-line-text')!.textContent = 'new text\n'; row.append(next);
  const gap = f.boundary(); f.line({ old: 30, new: 40, text: 'context after gap' });
  expect(f.read().entries[0]?.readLines?.().map(({ oldLine, newLine, oldText, newText, kind }) => ({ oldLine, newLine, oldText, newText, kind }))).toEqual([
    { oldLine: 10, newLine: 20, oldText: 'old text', newText: 'new text', kind: 'context' },
    { oldLine: null, newLine: null, oldText: null, newText: null, kind: 'hunk' },
    { oldLine: 30, newLine: 40, oldText: 'context after gap', newText: 'context after gap', kind: 'context' },
  ]);
  expect(gap.row.isConnected).toBe(true);
});

it('requires Bitbucket context controls to retain their verified native chunk scope', () => {
  const f = fixture('bitbucket'); f.line(newTest[0]!); const gap = f.boundary();
  f.content.className = 'unknown-wrapper';
  expect(f.read().entries[0]?.readLines?.().some((line) => line.kind === 'hunk')).toBe(false);
  expect(gap.row.isConnected).toBe(true);
});
