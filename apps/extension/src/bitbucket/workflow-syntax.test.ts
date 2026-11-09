// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseDocument } from 'yaml';
import { readBitbucketDiff } from './diff';
import { applyBitbucketWorkflowSyntax, removeBitbucketWorkflowSyntax } from './workflow-syntax';
import type { ProviderDiffEntry } from '../providers/types';

type Row = readonly [number | null, number | null, string, string];
const registry = new Map<string, Set<AbstractRange>>();

// Actual native installed public PR27 projection, run41337759558. These are source rows,
// not a claim that that historical browser run exercised shell highlighting.
// https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/27/diff
const publicRows: readonly Row[] = [
  [1, 1, "image:", " "],
  [2, 2, "  name: python:3.10", " "],
  [3, 3, "", " "],
  [4, null, "test: &test", "-"],
  [null, 4, "lint: &lint", "+"],
  [5, 5, "  parallel:", " "],
  [6, 6, "    - step:", " "],
  [7, null, "        name: Test", "-"],
  [null, 7, "        name: Lint", "+"],
  [8, 8, "        size: 4x", " "],
  [9, 9, "        runtime:", " "],
  [10, 10, "          cloud:", " "],
  [11, 11, "            atlassian-ip-ranges: true", " "],
  [12, 12, "        script:", " "],
  [13, null, "          - pip install -r requirements.txt", "-"],
  [14, 13, "          - pip install -r test/requirements.txt", " "],
  [15, null, "          - pytest -v test/test.py", "-"],
  [16, 14, "          - flake8 --ignore E501,E125", " "],
  [17, 15, "        services:", " "],
  [18, 16, "          - docker", " "],
  [29, 27, "          - pipe: atlassian/git-secrets-scan:3.0.0", " "],
  [30, 28, "", " "],
  [31, 29, "", " "],
  [null, 30, "check-next-release: &check-next-release", "+"],
  [null, 31, "  step:", "+"],
  [null, 32, "    name: Check next release", "+"],
  [null, 33, "    script:", "+"],
  [null, 34, "    - if [ ! -d \".changes/next-release\" ]; then echo \"Next release file missing, make sure to run 'semversioner add-change'\"; exit 1; fi", "+"],
  [null, 35, "", "+"],
  [null, 36, "", "+"],
  [32, 37, "release-dev: &release-dev", " "],
  [33, 38, "  step:", " "],
  [34, 39, "    name: Release development version", " "],
  [68, 73, "", " "],
  [69, 74, "pipelines:", " "],
  [70, 75, "  default:", " "],
  [71, null, "  - <<: *test", "-"],
  [null, 76, "  - <<: *lint", "+"],
  [null, 77, "  - <<: *check-next-release", "+"],
  [72, 78, "  - <<: *release-dev", " "],
  [73, 79, "  branches:", " "],
  [74, 80, "    master:", " "],
  [75, null, "    - <<: *test", "-"],
  [null, 81, "    - <<: *lint", "+"],
  [76, 82, "    - <<: *push", " "],
];

function fixture(rows: readonly Row[], path = 'bitbucket-pipelines.yml'): ProviderDiffEntry {
  let region = document.querySelector('[role="region"][aria-label="Diff"]');
  if (region === null) {
    region = document.createElement('div');
    region.setAttribute('role', 'region');
    region.setAttribute('aria-label', 'Diff');
    document.body.append(region);
  }
  region.replaceChildren();
  const root = document.createElement('div');
  const anchor = document.createElement('div');
  anchor.id = 'chg-' + path;
  const article = document.createElement('article');
  article.setAttribute('data-qa', 'branch-diff-file');
  root.append(anchor, article);
  region.append(root);
  for (const [old, next, text, kind] of rows) {
    const row = document.createElement('div');
    row.setAttribute('data-qa', 'code-line');
    const numbers = document.createElement('span');
    numbers.setAttribute('data-key', 'code-line-number');
    if (old !== null) numbers.setAttribute('data-old-line-number', String(old));
    if (next !== null) numbers.setAttribute('data-new-line-number', String(next));
    numbers.textContent = `${old ?? ''} ${next ?? ''}`;
    const marker = document.createElement('span');
    marker.textContent = kind;
    const code = document.createElement('span');
    code.setAttribute('data-line-type', kind);
    code.className = 'code-diff';
    // Native renderers may tokenize one source line into several immutable spans.
    for (const part of [text.slice(0, 7), text.slice(7)]) {
      const token = document.createElement('span');
      token.textContent = part;
      code.append(token);
    }
    row.append(numbers, marker, code);
    article.append(row);
  }
  const entry = readBitbucketDiff(document)?.entries.find((item) => item.root === root);
  if (entry === undefined) throw new Error('Native Bitbucket fixture was not recognized');
  return entry;
}

function yaml(source: string, path?: string): ProviderDiffEntry {
  return fixture(source.split('\n').map((text, index) => [index + 1, index + 1, text, ' ']), path);
}

// Exact public new30–37 source copied into a self-contained declaration grammar fixture.
// Renumbering this excerpt is a synthetic context test, not public installed eligibility proof.
function declaration(): ProviderDiffEntry {
  return yaml(publicRows.filter((row) => row[1] !== null && row[1] >= 30 && row[1] <= 37).map((row) => row[2]).join('\n'));
}

function ranges(scope: string): readonly AbstractRange[] { return [...registry.get('geld-bitbucket-shell-' + scope) ?? []]; }
function words(scope: string): string[] {
  return ranges(scope).map((range) => {
    const live = document.createRange();
    live.setStart(range.startContainer, range.startOffset);
    live.setEnd(range.endContainer, range.endOffset);
    return live.toString();
  });
}
function allWords(): string { return [...registry.keys()].filter((key) => key.startsWith('geld-bitbucket-shell-')).flatMap((key) => words(key.slice('geld-bitbucket-shell-'.length))).join(''); }

beforeEach(() => {
  registry.clear();
  vi.stubGlobal('CSS', { highlights: registry });
  vi.stubGlobal('Highlight', class extends Set<AbstractRange> {});
  vi.stubGlobal('StaticRange', class { constructor(init: StaticRangeInit) { Object.assign(this, init); } });
});
afterEach(() => {
  removeBitbucketWorkflowSyntax();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('Bitbucket native Pipelines shell', () => {
  it('keeps the actual default public projection native after its unknown gap, preserving all nodes', () => {
    const entry = fixture(publicRows);
    const html = entry.root.innerHTML;
    const nodes = [...entry.root.querySelectorAll('*')];
    const texts = [...entry.root.querySelectorAll('[data-line-type]')].flatMap((node) => [...node.childNodes]);
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const activate = vi.spyOn(HTMLElement.prototype, 'click');
    applyBitbucketWorkflowSyntax([entry]);
    expect(allWords()).toBe(''); // Earlier step is incomplete; later declarations have tainted prefix context.
    expect(entry.root.innerHTML).toBe(html);
    expect([...entry.root.querySelectorAll('*')]).toEqual(nodes);
    expect([...entry.root.querySelectorAll('[data-line-type]')].flatMap((node) => [...node.childNodes])).toEqual(texts);
    expect(fetch).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
  });

  it('colors the exact public declaration source only when a complete native prefix context is supplied', () => {
    const entry = declaration();
    const before = entry.root.innerHTML;
    applyBitbucketWorkflowSyntax([entry]);
    expect(words('keyword').join('')).toContain('ifthenfi');
    expect(words('built_in')).toEqual(expect.arrayContaining(['echo', 'exit']));
    expect(allWords()).toContain('Next release file missing');
    expect(allWords()).not.toContain('script:');
    expect(entry.root.innerHTML).toBe(before);
  });

  it('joins adjacent command strings and literal blocks, separately from after-script', () => {
    const entry = yaml(`pipelines:
  default:
    - step:
        script:
          - if true; then
          - |
              echo "$VERSION"
              # shell comment
          - fi
        after-script:
          - echo "$AFTER"
    - step:
        name: Next`);
    applyBitbucketWorkflowSyntax([entry]);
    expect(words('keyword')).toEqual(expect.arrayContaining(['if', 'then', 'fi']));
    expect(words('variable')).toEqual(expect.arrayContaining(['$VERSION', '$AFTER']));
    expect(words('comment')).toContain('# shell comment');
    for (const scope of ['keyword', 'built_in', 'string', 'plain']) {
      for (const range of ranges(scope)) {
        expect(range.startContainer.parentElement?.closest('[data-line-type]')).not.toBeNull();
        expect(range.startContainer).toBe(range.endContainer);
      }
    }
    expect(allWords()).not.toContain('script:');
  });

  it('reads the entire step before selecting a later explicit Linux Shell runner', () => {
    const entry = yaml(`definitions:
  steps:
    - step:
        script:
          - echo "$KNOWN"
        runs-on:
          - self.hosted
          - linux.shell
    - step:
        name: End`);
    applyBitbucketWorkflowSyntax([entry]);
    expect(words('variable')).toContain('$KNOWN');
  });

  it('accepts the official Linux Shell quoted labels without enabling quoted command decoding', () => {
    // https://support.atlassian.com/bitbucket-cloud/docs/set-up-runners-for-linux-shell/
    // The documented labels are literal strings, commonly quoted; no command-source map is needed.
    const entry = yaml(`pipelines:
  default:
    - step:
        runs-on:
          - 'self.hosted'
          - 'linux.shell'
        script:
          - 'echo $QUOTED_COMMAND'
          - echo "$KNOWN"
    - step:
        name: End`);
    applyBitbucketWorkflowSyntax([entry]);
    expect(words('variable')).toEqual(['$KNOWN']);
    expect(allWords()).not.toContain('QUOTED_COMMAND');
    expect(allWords()).not.toContain('linux.shell');
  });

  it('accepts exact decoded double-quoted Linux Shell labels', () => {
    const entry = yaml(`pipelines:
  default:
    - step:
        runs-on: ["self.hosted", "linux.shell"]
        script:
          - echo "$KNOWN"
    - step:
        name: End`);
    applyBitbucketWorkflowSyntax([entry]);
    expect(words('variable')).toEqual(['$KNOWN']);
  });

  for (const selection of [
    'runs-on: [self.hosted, windows]',
    'runs-on: [self.hosted, macos]',
    'runs-on: [self.hosted, linux]',
    'runs-on: *unknown',
    'runs-on: [self.hosted, \'windows\']',
    'runs-on: [self.hosted, linux.shell, \'${{ RUNNER }}\']',
    'runs-on: [self.hosted, linux.shell, !!str custom]',
    'runs-on: [self.hosted, linux.shell, *unknown]',
    '<<: *unknown',
  ]) it(`keeps unknown/inherited/unsupported execution native: ${selection}`, () => {
    const entry = yaml(`pipelines:
  default:
    - step:
        script:
          - echo "$SKIP"
        ${selection}
    - step:
        name: End`);
    applyBitbucketWorkflowSyntax([entry]);
    expect(allWords()).toBe('');
  });

  it('skips quoted/folded/alias/Pipe forms and does not color their variables or inherit shell state', () => {
    const entry = yaml(`pipelines:
  default:
    - step:
        script:
          - "echo $QUOTED"
          - 'echo $SINGLE'
          - >
              echo $FOLDED
          - *unknown
          - pipe: vendor/pipe:1
            variables:
              COMMAND: echo $PIPE
          - echo "$ACTUAL"
    - step:
        name: End`);
    applyBitbucketWorkflowSyntax([entry]);
    expect(words('variable')).toEqual(['$ACTUAL']);
    expect(allWords()).not.toMatch(/QUOTED|SINGLE|FOLDED|PIPE|pipe:/);
  });

  it('refuses variable/schema-looking step mappings and unrelated or nested file paths', () => {
    for (const [path, source] of [
      ['README.md', 'pipelines:\n  default:\n    - step:\n        script:\n          - echo "$README"\n    - step:\n        name: End'],
      ['fixtures/bitbucket-pipelines.yml', 'demo: &demo\n  step:\n    script:\n      - echo "$FIXTURE"\nend: true'],
      ['bitbucket-pipelines.yml', 'variables:\n  fake:\n    step:\n      script:\n        - echo "$VAR"\nend: true'],
      ['bitbucket-pipelines.yml', 'variables: &variables\n  step:\n    script:\n      - echo "$ANCHORED_VAR"\nend: true'],
    ]) {
      const entry = yaml(source ?? '', path);
      applyBitbucketWorkflowSyntax([entry]);
      expect(allWords()).toBe('');
    }
  });

  it.each(["'", '"'])('never extracts root-looking scripts from a valid multiline %s scalar', (quote) => {
    // YAML permits zero-indent continuation lines in a top-level quoted scalar. Regex-splitting
    // the apparent fake: and next: lines would incorrectly manufacture a complete anchored step.
    const source = `${quote}native text
fake: &fake
  step:
    script:
      - echo $FORGED
next: true
${quote}`;
    expect(parseDocument(source).errors).toEqual([]);
    const entry = yaml(source);
    const before = entry.root.innerHTML;
    applyBitbucketWorkflowSyntax([entry]);
    expect(allWords()).toBe('');
    expect(entry.root.innerHTML).toBe(before);
  });

  it('keeps quoted mapping values native while finding an actual later declaration through the full YAML grammar', () => {
    const source = `description: "native text
 fake: &fake
   step:
     script:
       - echo $FORGED
 next: true
 "
real: &real
  step:
    script:
      - echo $REAL
end: true`;
    expect(parseDocument(source).errors).toEqual([]);
    applyBitbucketWorkflowSyntax([yaml(source)]);
    expect(words('variable')).toEqual(['$REAL']);
    expect(allWords()).not.toContain('FORGED');
  });

  it('rejects a missing-hunk quoted context without the native file prefix', () => {
    // The hidden native prefix may be the opening quote of the valid scalar above. Apparent
    // top-level anchor syntax alone cannot prove that this fragment is a mapping document.
    const entry = fixture([
      [10, 10, 'fake: &fake', ' '], [11, 11, '  step:', ' '],
      [12, 12, '    script:', ' '], [13, 13, '      - echo $FORGED', ' '],
      [14, 14, 'next: true', ' '],
    ]);
    applyBitbucketWorkflowSyntax([entry]);
    expect(allWords()).toBe('');
  });

  it('taints apparent complete declarations after a hidden quote opener despite a parseable visible mapping', () => {
    const rows: readonly Row[] = [
      [1, 1, 'image: python:3.10', ' '], [2, 2, '', ' '],
      // Native3 may open a string. Never assume a projection with that line removed is its source.
      [4, 4, 'fake: &fake', ' '], [5, 5, '  step:', ' '], [6, 6, '    script:', ' '],
      [7, 7, '      - if true; then echo nope; fi', ' '], [8, 8, 'next: literal', ' '],
      // Native9 is also absent; later pipeline syntax cannot certify earlier lexical context.
      [10, 10, 'pipelines:', ' '], [11, 11, '  default: []', ' '],
    ];
    expect(parseDocument(rows.map((row) => row[2]).join('\n')).errors).toEqual([]);
    const entry = fixture(rows);
    const before = entry.root.innerHTML;
    applyBitbucketWorkflowSyntax([entry]);
    expect(allWords()).toBe('');
    expect(entry.root.innerHTML).toBe(before);
  });

  it('refuses a step whose declaration ancestry crosses a hunk gap', () => {
    const entry = fixture([
      [1, 1, 'demo: &demo', ' '], [10, 10, '  step:', ' '],
      [11, 11, '    script:', ' '], [12, 12, '      - echo $UNKNOWN', ' '],
      [13, 13, 'next: true', ' '],
    ]);
    applyBitbucketWorkflowSyntax([entry]);
    expect(allWords()).toBe('');
  });

  it('does not infer a complete step at end of hunk or across an unseen later runner', () => {
    const entry = fixture([
      [1, 1, 'demo: &demo', ' '], [2, 2, '  step:', ' '], [3, 3, '    script:', ' '],
      [4, 4, '      - echo "$UNKNOWN"', ' '], [12, 12, 'next: true', ' '],
    ]);
    applyBitbucketWorkflowSyntax([entry]);
    expect(allWords()).toBe('');
  });

  it('tokenizes both sides independently and paints common context only from the new program', () => {
    const entry = fixture([
      [1, 1, 'demo: &demo', ' '], [2, 2, '  step:', ' '], [3, 3, '    script:', ' '],
      [4, null, '      - echo "old', '-'], [null, 4, '      - echo new', '+'],
      [5, 5, '      - if true; then echo "$NEW"; fi', ' '],
      [6, null, '      - old"', '-'], [null, 6, '      - echo end', '+'],
      [7, 7, 'next: true', ' '],
    ]);
    applyBitbucketWorkflowSyntax([entry]);
    expect(words('keyword')).toContain('if');
    expect(words('string').join('')).toContain('old');
    expect(words('variable')).toContain('$NEW');
    const shared = entry.root.querySelectorAll('[data-line-type]')[5];
    const sharedStrings = ranges('string').filter((range) => shared?.contains(range.startContainer));
    expect(sharedStrings).toHaveLength(2); // New-side quote delimiters, never the old unterminated string.
    expect(sharedStrings.every((range) => range.endOffset - range.startOffset === 1)).toBe(true);
  });

  it('refreshes replaced source nodes, reuses unchanged ranges and prunes unmounted roots', () => {
    const entry = declaration();
    applyBitbucketWorkflowSyntax([entry]);
    const initial = ranges('keyword')[0];
    applyBitbucketWorkflowSyntax([entry]);
    expect(ranges('keyword')[0]).toBe(initial);
    const row = entry.root.querySelector('[data-new-line-number="5"]')?.parentElement;
    const source = row?.querySelector('[data-line-type]');
    if (source === null || source === undefined) throw new Error('Actual source row missing');
    const oldText = source.firstChild;
    source.replaceChildren(document.createTextNode('    - echo "$REPLACED"'));
    applyBitbucketWorkflowSyntax([entry]);
    expect(words('variable')).toEqual(['$REPLACED']);
    expect([...registry.values()].flatMap((group) => [...group]).some((range) => range.startContainer === oldText)).toBe(false);
    entry.root.remove();
    applyBitbucketWorkflowSyntax([entry]);
    expect(allWords()).toBe('');
    document.querySelector('[role="region"]')?.append(entry.root);
    applyBitbucketWorkflowSyntax([entry]);
    expect(words('variable')).toEqual(['$REPLACED']);
  });

  it('clears only its own registry entries on teardown and missing highlight APIs', () => {
    const foreign = new Set<AbstractRange>();
    registry.set('native-find', foreign);
    registry.set('geld-shell-string', foreign);
    applyBitbucketWorkflowSyntax([declaration()]);
    expect(words('keyword').join('')).toContain('ifthenfi');
    vi.stubGlobal('StaticRange', undefined);
    applyBitbucketWorkflowSyntax([]);
    expect([...registry.keys()]).toEqual(['native-find', 'geld-shell-string']);
    removeBitbucketWorkflowSyntax();
    expect(registry.get('native-find')).toBe(foreign);
    expect(registry.get('geld-shell-string')).toBe(foreign);
  });

  it('leaves malformed or duplicate execution keys native', () => {
    for (const source of [
      'demo: &demo\n  step:\n    script:\n      - echo "$DUPLICATE"\n    script:\n      - echo "$OTHER"\nnext: true',
      'demo: &demo\n  step:\n    script: [\nnext: true',
    ]) {
      const entry = yaml(source);
      const before = entry.root.innerHTML;
      expect(() => applyBitbucketWorkflowSyntax([entry])).not.toThrow();
      expect(allWords()).toBe('');
      expect(entry.root.innerHTML).toBe(before);
    }
  });

  it.each(['CSS', 'Highlight', 'StaticRange'])('does nothing without the %s API', (api) => {
    const entry = declaration();
    const before = entry.root.innerHTML;
    vi.stubGlobal(api, undefined);
    expect(() => applyBitbucketWorkflowSyntax([entry])).not.toThrow();
    expect(entry.root.innerHTML).toBe(before);
    expect(allWords()).toBe('');
  });

  it('bounds oversized programs without parsing or replacing native HTML-looking source', () => {
    const entry = yaml(`demo: &demo
  step:
    script:
      - echo ${'x'.repeat(100_001)}
next: true`);
    applyBitbucketWorkflowSyntax([entry]);
    expect(allWords()).toBe('');
    const safe = yaml(`safe: &safe
  step:
    script:
      - echo '<img src=x onerror=alert(1)>'
next: true`);
    const before = safe.root.innerHTML;
    applyBitbucketWorkflowSyntax([safe]);
    expect(words('built_in')).toContain('echo');
    expect(safe.root.querySelector('img')).toBeNull();
    expect(safe.root.innerHTML).toBe(before);
  });
});
