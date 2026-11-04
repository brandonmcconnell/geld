// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiffEntry } from './model';
import { applyWorkflowSyntax, removeWorkflowSyntax } from './workflow-syntax';

type Row = readonly [number, number, string, ('context' | 'addition' | 'deletion')?];
const registry = new Map<string, Set<AbstractRange>>();

function fixture(rows: readonly Row[], view: 'legacy' | 'react' = 'legacy', path = '.github/workflows/release.yml'): DiffEntry {
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
      cell.innerHTML = '<span class="blob-code-inner" data-code-marker=" "><span class="pl-s"></span></span>';
    } else {
      cell.className = 'diff-text-cell';
      cell.setAttribute('data-line-anchor', `diff-file${kind === 'deletion' ? 'L' : 'R'}${next || old}`);
      cell.innerHTML = `<code class="diff-text ${kind}"><span class="diff-text-marker">+</span><div class="diff-text-inner"><span class="pl-s"></span></div></code>`;
    }
    const source = cell.querySelector('.pl-s');
    if (source !== null) source.textContent = text;
  }
  document.body.append(root);
  return { root, path, anchor: 'diff-file', stats: null };
}

function words(scope: string): string[] {
  return [...(registry.get(`geld-shell-${scope}`) ?? [])].map((range) => {
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
  removeWorkflowSyntax();
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
      applyWorkflowSyntax([entry]);
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
      applyWorkflowSyntax([entry]);
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
  applyWorkflowSyntax([entry]);
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
    applyWorkflowSyntax([entry]);
    expect(registry.size).toBe(0);
  }
});

it('stops at hunk gaps and highlights later steps independently', () => {
  const entry = fixture([
    [1, 1, '      - run: |'], [2, 2, '          echo one'],
    [20, 20, '          echo unknown'],
    [21, 21, '      - name: next'], [22, 22, '        run: |'], [23, 23, '          echo two'],
  ]);
  applyWorkflowSyntax([entry]);
  expect(words('built_in').filter((word) => word === 'echo')).toHaveLength(2);
  expect(words('plain').join('')).not.toContain('unknown');
});

it('keeps source-looking HTML as text and handles strings across native token nodes', () => {
  const entry = fixture([[1, 1, '      - run: |'], [2, 2, '          echo "<img src=x onerror=alert(1)>'], [3, 3, '          still quoted"']]);
  applyWorkflowSyntax([entry]);
  expect(entry.root.querySelector('img')).toBeNull();
  expect(words('string').join('')).toContain('<img src=x onerror=alert(1)>');
  expect(words('string').join('')).toContain('still quoted');
});

it('reuses unchanged ranges, follows replaced text nodes and clears only its own highlights', () => {
  registry.set('other-extension', new Set());
  const entry = fixture([[1, 1, '      - run: |'], [2, 2, '          echo "$VALUE"']]);
  applyWorkflowSyntax([entry]);
  const original = registry.get('geld-shell-variable');
  applyWorkflowSyntax([entry]);
  expect(registry.get('geld-shell-variable')).toBe(original);
  const source = entry.root.querySelectorAll('.pl-s')[1];
  if (source === undefined) throw new Error('Missing source line');
  source.textContent = '          echo "$NEXT"';
  applyWorkflowSyntax([entry]);
  expect(words('variable')).toContain('$NEXT');
  expect(words('variable')).not.toContain('$VALUE');
  applyWorkflowSyntax([]);
  expect([...registry.keys()]).toEqual(['other-extension']);
  applyWorkflowSyntax([entry]);
  removeWorkflowSyntax();
  expect([...registry.keys()]).toEqual(['other-extension']);
});

it('leaves native highlighting on browsers without the Highlight API', () => {
  vi.stubGlobal('Highlight', undefined);
  const entry = fixture([[1, 1, '      - run: |'], [2, 2, '          echo hello']]);
  const original = entry.root.innerHTML;
  expect(() => applyWorkflowSyntax([entry])).not.toThrow();
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
  applyWorkflowSyntax([entry]);
  expect(words('keyword')).toContain('if');
  expect(words('string').join('')).not.toContain('if true');
});

it('keeps fixed ranges when GitHub temporarily detaches and reattaches a diff row', () => {
  const entry = fixture([[1, 1, '      - run: |'], [2, 2, '          echo "$VALUE"']]);
  applyWorkflowSyntax([entry]);
  const table = entry.root.firstChild;
  if (table === null) throw new Error('Missing diff table');
  entry.root.removeChild(table);
  entry.root.append(table);
  applyWorkflowSyntax([entry]);
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
  applyWorkflowSyntax([entry]);
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
  applyWorkflowSyntax([entry]);
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
  applyWorkflowSyntax([entry]);
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
  applyWorkflowSyntax([entry]);
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
  applyWorkflowSyntax([entry]);
  expect(words('built_in').filter((word) => word === 'echo')).toHaveLength(2);
});

it('reads quoted keys as the keys they are', () => {
  const text = ["'defaults':", '  "run":', "    'shell': pwsh", '"jobs":', '  linux:', "    'runs-on': ubuntu-latest", '    steps:', '      - "run": |', '          echo powershell', '      - "shell": bash', "        'run': |", '          echo bash'];
  const entry = fixture(text.map((line, i) => [i + 1, i + 1, line]));
  applyWorkflowSyntax([entry]);
  expect(words('built_in').filter((word) => word === 'echo')).toHaveLength(1);
  expect(words('plain').join('')).not.toContain('powershell');
});
