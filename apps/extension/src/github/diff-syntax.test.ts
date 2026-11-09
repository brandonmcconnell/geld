// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiffEntry } from './model';
import { applyDiffSyntax, removeDiffSyntax } from './diff-syntax';

type Row = readonly [number, number, string, ('context' | 'addition' | 'deletion')?];
const registry = new Map<string, Set<AbstractRange>>();

function fixture(rows: readonly Row[], view: 'legacy' | 'react' = 'legacy', path = '.github/workflows/release.yml', native = true): DiffEntry {
  const root = document.createElement('div');
  const table = document.createElement('table');
  root.append(table);
  for (const [old, next, text, kind = 'context'] of rows) {
    const row = table.insertRow();
    for (const [side, number] of [['L', old], ['R', next]] as const) {
      const cell = row.insertCell();
      cell.className = view === 'legacy' ? 'blob-num' : 'diff-line-number';
      if (view === 'legacy') {
        cell.id = `diff-file${side}${number}`;
        cell.setAttribute('data-line-number', String(number));
      }
      cell.textContent = number === 0 ? '' : String(number);
    }
    const cell = row.insertCell();
    if (view === 'legacy') {
      cell.className = `blob-code blob-code-${kind}`;
      cell.innerHTML = '<span class="blob-code-inner" data-code-marker=" "></span>';
    } else {
      cell.className = 'diff-text-cell';
      cell.setAttribute('data-line-anchor', `diff-file${kind === 'deletion' ? 'L' : 'R'}${next || old}`);
      cell.innerHTML = `<code class="diff-text syntax-highlighted-line ${kind}"><span class="diff-text-marker">+</span><div class="diff-text-inner"></div></code>`;
    }
    const source = cell.querySelector('.blob-code-inner, .diff-text-inner');
    if (source === null) throw new Error('Missing code cell');
    if (native) {
      const span = document.createElement('span');
      span.className = 'pl-s';
      span.textContent = text;
      source.append(span);
    } else {
      source.textContent = text;
    }
  }
  document.body.append(root);
  return { root, path, anchor: 'diff-file', stats: null };
}

function words(scope: string): string[] {
  return [...(registry.get(`geld-syntax-${scope}`) ?? [])].map((range) => {
    const live = document.createRange();
    live.setStart(range.startContainer, range.startOffset);
    live.setEnd(range.endContainer, range.endOffset);
    return live.toString();
  });
}

beforeEach(() => {
  registry.clear();
  vi.stubGlobal('CSS', { highlights: registry });
  vi.stubGlobal('Highlight', class extends Set<AbstractRange> {});
  vi.stubGlobal('StaticRange', class { constructor(init: StaticRangeInit) { Object.assign(this, init); } });
});
afterEach(() => {
  removeDiffSyntax();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

for (const view of ['legacy', 'react'] as const) {
  describe(view, () => {
    it('colors workflow shell while preserving native nodes, source text and diff markers', () => {
      const entry = fixture([
        [438, 438, '        run: |'],
        [439, 439, '          if true; then'],
        [440, 440, '            echo "Hello $VERSION" # release'],
        [441, 441, '          fi'],
        [442, 442, '        env:'],
        [443, 443, '          MESSAGE: echo untouched'],
        [444, 444, '          shell: python'],
      ], view);
      const original = entry.root.innerHTML;
      const nodes = [...entry.root.querySelectorAll('*')];
      applyDiffSyntax([entry]);
      expect(words('keyword')).toContain('if');
      expect(words('built_in')).toContain('echo');
      expect(words('variable')).toContain('$VERSION');
      expect(words('comment')).toContain('# release');
      expect(words('plain').join('')).not.toContain('untouched');
      expect(entry.root.innerHTML).toBe(original);
      expect([...entry.root.querySelectorAll('*')]).toEqual(nodes);
    });

    it('keeps additions and deletions in separate shell programs', () => {
      const entry = fixture([
        [1, 1, '      - run: |'],
        [2, 0, '          echo "old', 'deletion'],
        [0, 2, '          echo new', 'addition'],
        [3, 0, '          old"', 'deletion'],
        [0, 3, '          if true; then echo "$NEW"; fi', 'addition'],
      ], view);
      applyDiffSyntax([entry]);
      expect(words('string').join('')).toContain('old');
      expect(words('keyword')).toContain('if');
      expect(words('variable')).toContain('$NEW');
    });
  });
}

it('handles split rows with one line number per code cell', () => {
  const entry = fixture([[1, 1, '      - run: |'], [2, 2, '          echo "$VALUE"']]);
  for (const row of entry.root.querySelectorAll('tr')) {
    const code = row.querySelector('.blob-code');
    const right = row.querySelector('[id*="R"]');
    if (code !== null && right !== null) {
      const copy = code.cloneNode(true);
      row.insertBefore(copy, right);
    }
  }
  applyDiffSyntax([entry]);
  expect(words('built_in').filter((word) => word === 'echo')).toHaveLength(2);
});

it('skips unknown context, non-workflows and explicitly unsupported shells', () => {
  const scripts: Row[] = [[1, 1, '      - run: |'], [2, 2, '          echo "$VALUE"']];
  for (const entry of [
    fixture(scripts, 'legacy', 'config.yml'),
    fixture([[9, 9, '          echo "$VALUE"']]),
    fixture([...scripts, [3, 3, '        shell: python']]),
    fixture([[1, 1, '      - shell: pwsh'], [2, 2, '        run: |'], [3, 3, '          echo "$VALUE"']]),
    fixture([[1, 1, '    runs-on: windows-latest'], ...scripts.map(([old, next, text]) => [old + 1, next + 1, text] as const)]),
  ]) {
    applyDiffSyntax([entry]);
    expect(registry.size).toBe(0);
  }
});

it('stops at hunk gaps and highlights later steps independently', () => {
  const entry = fixture([
    [1, 1, '      - run: |'], [2, 2, '          echo one'],
    [20, 20, '          echo unknown'],
    [21, 21, '      - name: next'], [22, 22, '        run: |'], [23, 23, '          echo two'],
  ]);
  applyDiffSyntax([entry]);
  expect(words('built_in').filter((word) => word === 'echo')).toHaveLength(2);
  expect(words('plain').join('')).not.toContain('unknown');
});

it('keeps source-looking HTML as text and handles strings across native token nodes', () => {
  const entry = fixture([[1, 1, '      - run: |'], [2, 2, '          echo "<img src=x onerror=alert(1)>'], [3, 3, '          still quoted"']]);
  applyDiffSyntax([entry]);
  expect(entry.root.querySelector('img')).toBeNull();
  expect(words('string').join('')).toContain('<img src=x onerror=alert(1)>');
  expect(words('string').join('')).toContain('still quoted');
});

it('reuses unchanged ranges, follows replaced text nodes and clears only its own highlights', () => {
  registry.set('other-extension', new Set());
  const entry = fixture([[1, 1, '      - run: |'], [2, 2, '          echo "$VALUE"']]);
  applyDiffSyntax([entry]);
  const original = registry.get('geld-syntax-variable');
  applyDiffSyntax([entry]);
  expect(registry.get('geld-syntax-variable')).toBe(original);
  const source = entry.root.querySelectorAll('.pl-s')[1];
  if (source === undefined) throw new Error('Missing source line');
  source.textContent = '          echo "$NEXT"';
  applyDiffSyntax([entry]);
  expect(words('variable')).toContain('$NEXT');
  expect(words('variable')).not.toContain('$VALUE');
  applyDiffSyntax([]);
  expect([...registry.keys()]).toEqual(['other-extension']);
  applyDiffSyntax([entry]);
  removeDiffSyntax();
  expect([...registry.keys()]).toEqual(['other-extension']);
});

it('leaves native highlighting on browsers without the Highlight API', () => {
  vi.stubGlobal('Highlight', undefined);
  const entry = fixture([[1, 1, '      - run: |'], [2, 2, '          echo hello']]);
  const original = entry.root.innerHTML;
  expect(() => applyDiffSyntax([entry])).not.toThrow();
  expect(entry.root.innerHTML).toBe(original);
});

it('paints shared context according to the new side after a changed quote', () => {
  const entry = fixture([
    [1, 1, '      - run: |'],
    [2, 0, '          echo "old', 'deletion'],
    [0, 2, '          echo new', 'addition'],
    [3, 3, '          if true; then echo yes; fi'],
    [4, 0, '          end"', 'deletion'],
  ]);
  applyDiffSyntax([entry]);
  expect(words('keyword')).toContain('if');
  expect(words('string').join('')).not.toContain('if true');
});

it('keeps fixed ranges when GitHub temporarily detaches and reattaches a diff row', () => {
  const entry = fixture([[1, 1, '      - run: |'], [2, 2, '          echo "$VALUE"']]);
  applyDiffSyntax([entry]);
  const table = entry.root.firstChild;
  if (table === null) throw new Error('Missing diff table');
  entry.root.removeChild(table);
  entry.root.append(table);
  applyDiffSyntax([entry]);
  expect(words('variable')).toContain('$VALUE');
});

it('respects workflow and job shell defaults without leaking them into another job', () => {
  const text = [
    'defaults:', '  run:', '    shell: sh', 'jobs:',
    '  python:', '    defaults:', '      run:', '        shell: python',
    '    runs-on: ubuntu-latest', '    steps:', '      - run: |', '          echo skipped',
    '  linux:', '    runs-on: ubuntu-latest', '    steps:', '      - run: |', '          echo linux',
    '  windows:', '    runs-on: windows-latest', '    steps:', '      - shell: bash',
    '        run: |', '          echo windows',
  ];
  const entry = fixture(text.map((line, i) => [i + 1, i + 1, line]));
  applyDiffSyntax([entry]);
  expect(words('built_in').filter((word) => word === 'echo')).toHaveLength(2);
  expect(words('plain').join('')).not.toContain('skipped');
});

it('reads a job\'s runner and defaults wherever they stand, after its steps too', () => {
  const text = [
    'jobs:',
    '  windows:',
    '    steps:', '      - run: |', '          echo pwsh-one', '      - run: |', '          echo pwsh-two',
    '      - shell: bash', '        run: |', '          echo bash-step',
    '    runs-on: windows-latest',
    '  python:',
    '    steps:', '      - run: |', '          echo python-script',
    '    runs-on: ubuntu-latest',
    '    defaults:', '      run:', '        shell: python',
    '  linux:',
    '    steps:', '      - run: |', '          echo linux-script',
    '    runs-on: ubuntu-latest',
  ];
  const entry = fixture(text.map((line, i) => [i + 1, i + 1, line]));
  applyDiffSyntax([entry]);
  // Only the step that names bash, and the job with no other say, are Bash.
  expect(words('built_in').filter((word) => word === 'echo')).toHaveLength(2);
  const painted = words('plain').join('');
  for (const word of ['pwsh-one', 'pwsh-two', 'python-script']) expect(painted).not.toContain(word);
});

it('reads the workflow\'s defaults after its jobs too, and a job\'s own over them', () => {
  const text = [
    'jobs:',
    '  first:', '    runs-on: ubuntu-latest', '    steps:', '      - run: |', '          echo inherits',
    '  second:', '    runs-on: ubuntu-latest', '    defaults:', '      run:', '        shell: bash', '    steps:', '      - run: |', '          echo own',
    'defaults:', '  run:', '    shell: pwsh',
  ];
  const entry = fixture(text.map((line, i) => [i + 1, i + 1, line]));
  applyDiffSyntax([entry]);
  expect(words('built_in').filter((word) => word === 'echo')).toHaveLength(1);
  expect(words('plain').join('')).not.toContain('inherits');
});


it('keeps what a section after a gap reads to itself, since the gap may hide another job', () => {
  const entry = fixture([
    [1, 1, 'jobs:'], [2, 2, '  windows:'], [3, 3, '    runs-on: windows-latest'], [4, 4, '    steps:'],
    [5, 5, '      - run: |'], [6, 6, '          echo powershell'],
    // Hidden here: the end of that job and the next one's name.
    [30, 30, '    runs-on: ubuntu-latest'], [31, 31, '    steps:'], [32, 32, '      - run: |'], [33, 33, '          echo bash'],
  ]);
  applyDiffSyntax([entry]);
  expect(words('built_in').filter((word) => word === 'echo')).toHaveLength(1);
  expect(words('plain').join('')).not.toContain('powershell');
});

it('takes a default shell only from defaults.run.shell, never from an environment variable named shell', () => {
  const text = [
    'jobs:', '  linux:', '    runs-on: ubuntu-latest', '    env:', '      shell: python', '    steps:',
    '      - run: |', '          echo still-bash', '      - with:', '          script: |', '            shell: pwsh',
    '        run: |', '          echo also-bash',
    'env:', '  shell: python',
  ];
  const entry = fixture(text.map((line, i) => [i + 1, i + 1, line]));
  applyDiffSyntax([entry]);
  expect(words('built_in').filter((word) => word === 'echo')).toHaveLength(2);
});

it('reads quoted keys as the keys they are', () => {
  const text = ["'defaults':", '  "run":', "    'shell': pwsh", '"jobs":', '  linux:', "    'runs-on': ubuntu-latest", '    steps:', '      - "run": |', '          echo powershell', '      - "shell": bash', "        'run': |", '          echo bash'];
  const entry = fixture(text.map((line, i) => [i + 1, i + 1, line]));
  applyDiffSyntax([entry]);
  expect(words('built_in').filter((word) => word === 'echo')).toHaveLength(1);
  expect(words('plain').join('')).not.toContain('powershell');
});

it.each(['legacy', 'react'] as const)('fills a plain TypeScript diff and yields to native colors (%s)', (view) => {
  const rows: Row[] = [[0, 1, 'export const value: string = "hello";', 'addition']];
  const plain = fixture(rows, view, 'src/example.ts', false);
  const native = fixture(rows, view, 'src/native.ts');
  const before = plain.root.innerHTML;
  applyDiffSyntax([plain, native]);
  expect(words('keyword')).toEqual(['export', 'const']);
  expect(words('string')).toEqual(['"hello"']);
  expect(plain.root.innerHTML).toBe(before);
  const code = plain.root.querySelector('.blob-code-inner, .diff-text-inner');
  if (code === null) throw new Error('Missing code cell');
  code.innerHTML = '<span class="pl-k">export</span> const value: string = "hello";';
  applyDiffSyntax([plain, native]);
  expect(registry.size).toBe(0);
  expect(code.querySelector('.pl-k')?.textContent).toBe('export');
});

it('resets language context across gaps and honors each React split side', () => {
  const entry = fixture([
    [1, 0, '/* deleted comment', 'deletion'],
    [0, 1, 'const added = 1;', 'addition'],
    [5, 8, 'const separate = 2;'],
  ], 'react', 'src/example.js', false);
  const row = entry.root.querySelectorAll('tr')[2];
  if (row === undefined) throw new Error('Missing split row');
  const [leftNumber, rightNumber, rightCode] = row.cells;
  if (leftNumber === undefined || rightNumber === undefined || rightCode === undefined) throw new Error('Missing diff cells');
  const leftCode = rightCode.cloneNode(true);
  if (!(leftCode instanceof HTMLElement)) throw new Error('Missing left code cell');
  leftCode.setAttribute('data-diff-side', 'left');
  rightCode.setAttribute('data-diff-side', 'right');
  row.insertBefore(leftCode, rightNumber);
  applyDiffSyntax([entry]);
  expect(words('keyword')).toEqual(['const', 'const', 'const']);
  expect(words('comment')).toEqual(['/* deleted comment']);
});
