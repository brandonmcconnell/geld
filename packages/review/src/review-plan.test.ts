import { describe, expect, it } from 'vitest';
import type { PlanFile, PlanHunk, PlanInput, ReviewProgress, StepProposal } from './review-plan';
import {
  carryProgress,
  cleanCommitTitle,
  definedSymbols,
  finishBody,
  hashText,
  kindFor,
  nextPendingStep,
  normalizePlan,
  planDelta,
  planSignatures,
  remapProposals,
  reviewComplete,
  rulesPlan,
  rulesProposals,
  stemOf,
  stepDisplayState,
} from './review-plan';

function hunk(index: number, added: readonly string[], removed: readonly string[] = [], newStart = 1): PlanHunk {
  return { index, header: `@@ -${newStart},${removed.length} +${newStart},${added.length} @@`, oldStart: newStart, oldLines: removed.length, newStart, newLines: added.length, added, removed, signature: hashText(`${index}:${added.join('|')}:${removed.join('|')}`) };
}

function file(path: string, hunks: readonly PlanHunk[], extra: Partial<PlanFile> = {}): PlanFile {
  return { path, status: 'modified', binary: false, hidden: null, hunks, ...extra };
}

const TESTS = { id: 'tests', title: 'Tests' };

const input: PlanInput = {
  title: 'Debounce the search box',
  body: null,
  headSha: 'a'.repeat(40),
  commits: [
    { sha: '1'.repeat(40), message: 'feat: add debounce helper', files: ['src/lib/debounce.ts', 'src/lib/debounce.test.ts'] },
    { sha: '2'.repeat(40), message: 'Debounce search input', files: ['src/search/SearchBox.tsx', 'src/search/search.css'] },
    { sha: '3'.repeat(40), message: 'chore: bump deps', files: ['package.json', 'pnpm-lock.yaml'] },
  ],
  files: [
    file('src/lib/debounce.ts', [hunk(0, ['export function debounce<T>(fn: T, ms: number) {', '  return fn;', '}'])], { status: 'added' }),
    file('src/lib/debounce.test.ts', [hunk(0, ["it('debounces', () => {})"])], { status: 'added', hidden: TESTS }),
    file('src/search/SearchBox.tsx', [hunk(0, ['const onChange = debounce(search, 250);']), hunk(1, ['<Spinner hidden={!waiting} />'], [], 40)]),
    file('src/search/search.css', [hunk(0, ['.search-spinner { opacity: 0 }'])]),
    file('src/results/ResultsList.tsx', [hunk(0, ['const rows = useResults();'])]),
    file('package.json', [hunk(0, ['"lodash": "5"'], ['"lodash": "4"'])]),
    file('pnpm-lock.yaml', [], { hidden: { id: 'generated', title: 'Generated' } }),
    file('docs/img.png', [], { status: 'added', binary: true }),
  ],
  findings: [{ id: 'item-1', path: 'src/search/SearchBox.tsx', line: 40 }],
};

describe('rules producer', () => {
  it('groups by commit, symbol and path and titles steps from commit messages', () => {
    const plan = rulesPlan(input, '2026-10-07T00:00:00Z');
    const titles = plan.steps.map((step) => step.title);
    // debounce.ts and SearchBox.tsx share the `debounce` symbol, so the two commits' groups merge under the first commit's title.
    const debounce = plan.steps.find((step) => step.touches.some((ref) => ref.path === 'src/lib/debounce.ts'));
    expect(debounce).toBeDefined();
    expect(debounce?.title).toBe('add debounce helper');
    expect(debounce?.touches.map((ref) => `${ref.path}#${ref.hunk}`)).toEqual(['src/lib/debounce.ts#0', 'src/search/SearchBox.tsx#0', 'src/search/SearchBox.tsx#1', 'src/search/search.css#0']);
    // The test file follows the file it names.
    expect(debounce?.supporting.map((ref) => ref.path)).toEqual(['src/lib/debounce.test.ts']);
    expect(debounce?.kind).toBe('feature');
    // The finding on line 40 of SearchBox.tsx falls inside its second hunk.
    expect(debounce?.findings).toEqual(['item-1']);
    expect(titles).toContain('bump deps');
    expect(plan.steps.find((step) => step.title === 'bump deps')?.kind).toBe('chore');
    // The lockfile is hidden and names nothing, so it closes the plan as a Generated step.
    expect(plan.steps[plan.steps.length - 1]?.title).toBe('Generated');
    expect(plan.steps[plan.steps.length - 1]?.kind).toBe('generated');
    // A lone file keeps its own step named for it; a binary file is a whole-file ref.
    expect(titles).toContain('Update ResultsList.tsx');
    expect(plan.steps.find((step) => step.title === 'Add img.png')?.touches).toEqual([{ path: 'docs/img.png', hunk: 0 }]);
    // Every visible hunk is in exactly one step.
    const seen = plan.steps.flatMap((step) => step.touches.map((ref) => `${ref.path}#${ref.hunk}`));
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.sort()).toEqual(['docs/img.png#0', 'package.json#0', 'src/lib/debounce.ts#0', 'src/results/ResultsList.tsx#0', 'src/search/SearchBox.tsx#0', 'src/search/SearchBox.tsx#1', 'src/search/search.css#0']);
    expect(plan.unassigned).toEqual([]);
    expect(plan.producer).toBe('rules');
  });

  it('makes one step of a tiny pull request', () => {
    const tiny: PlanInput = { ...input, commits: [], files: [file('a.ts', [hunk(0, ['x'])])], findings: [] };
    const plan = rulesPlan(tiny, 'now');
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]?.title).toBe('Update a.ts');
  });

  it('splits an oversized step by file', () => {
    const big = Array.from({ length: 450 }, (_, index) => `line ${index}`);
    const large: PlanInput = {
      ...input,
      commits: [{ sha: 'x'.repeat(40), message: 'Huge change', files: ['a.ts', 'b.ts'] }],
      files: [file('a.ts', [hunk(0, big)]), file('b.ts', [hunk(0, big)])],
      findings: [],
    };
    const proposals: StepProposal[] = [{ key: 'one', title: 'Huge change', kind: 'feature', gist: null, touches: [{ path: 'a.ts', hunk: 0 }, { path: 'b.ts', hunk: 0 }], dependsOn: [], watch: [] }];
    const plan = normalizePlan(large, proposals, { producer: 'ai', model: 'm', madeAt: 'now' });
    expect(plan.steps.map((step) => step.title)).toEqual(['Huge change · a.ts', 'Huge change · b.ts']);
    expect(plan.steps[1]?.dependsOn).toEqual([plan.steps[0]?.id]);
    // The rules producer never joins two such files in the first place.
    expect(rulesProposals(large)).toHaveLength(2);
  });
});

describe('normalizePlan', () => {
  it('drops duplicate hunks from later steps, gathers omissions and orders by dependsOn', () => {
    const proposals: StepProposal[] = [
      { key: 'b', title: 'Use the helper', kind: 'feature', gist: 'Wires it in', touches: [{ path: 'src/search/SearchBox.tsx', hunk: 0 }, { path: 'src/lib/debounce.ts', hunk: 0 }], dependsOn: ['a'], watch: ['x', 'y', 'z', 'too many'] },
      { key: 'a', title: 'Add the helper', kind: 'feature', gist: null, touches: [{ path: 'src/lib/debounce.ts', hunk: 0 }, { path: 'src/search/search.css', hunk: 0 }, { path: 'nope.ts', hunk: 3 }], dependsOn: [], watch: [] },
    ];
    const plan = normalizePlan(input, proposals, { producer: 'ai', model: 'm', madeAt: 'now' });
    expect(plan.steps.map((step) => step.title)).toEqual(['Add the helper', 'Use the helper', 'Everything else', 'Generated']);
    const [helper, use, rest] = plan.steps;
    // `b` came first and claimed debounce.ts, so `a` keeps only search.css; `b` still reads after `a` by dependsOn.
    expect(helper?.touches).toEqual([{ path: 'src/search/search.css', hunk: 0 }]);
    expect(use?.touches).toEqual([{ path: 'src/lib/debounce.ts', hunk: 0 }, { path: 'src/search/SearchBox.tsx', hunk: 0 }]);
    expect(use?.supporting.map((ref) => ref.path)).toEqual(['src/lib/debounce.test.ts']);
    expect(use?.dependsOn).toEqual([helper?.id]);
    expect(use?.watch).toHaveLength(3);
    expect(rest?.touches.map((ref) => ref.path)).toEqual(['src/search/SearchBox.tsx', 'src/results/ResultsList.tsx', 'package.json', 'docs/img.png']);
    expect(plan.unassigned).toHaveLength(4);
    expect(plan.producer).toBe('ai');
    expect(plan.model).toBe('m');
  });

  it('keeps a step id across plans while its first hunk is the same change', () => {
    const first = rulesPlan(input, 'now');
    const edited: PlanInput = {
      ...input,
      headSha: 'b'.repeat(40),
      files: input.files.map((entry) => (entry.path === 'src/results/ResultsList.tsx' ? file(entry.path, [hunk(0, ['const rows = useResults({ fresh: true });'])]) : entry)),
    };
    const second = rulesPlan(edited, 'later');
    const before = first.steps.find((step) => step.title === 'add debounce helper');
    const after = second.steps.find((step) => step.title === 'add debounce helper');
    expect(after?.id).toBe(before?.id);
    expect(first.steps.find((step) => step.title === 'Update ResultsList.tsx')?.id).not.toBe(second.steps.find((step) => step.title === 'Update ResultsList.tsx')?.id);
    expect(first.id).not.toBe(second.id);
    const delta = planDelta(planSignatures(first), edited);
    expect(delta.added).toHaveLength(1);
    expect(delta.removed).toHaveLength(1);
  });

  it('lays an earlier plan over a later diff by hunk signature', () => {
    const first = rulesPlan(input, 'now');
    // A push: ResultsList gained a second hunk and the search CSS moved down the file (same change, new position).
    const pushed: PlanInput = {
      ...input,
      headSha: 'c'.repeat(40),
      files: input.files.map((entry) => {
        if (entry.path === 'src/results/ResultsList.tsx') return file(entry.path, [...entry.hunks, hunk(1, ['export {};'], [], 90)]);
        if (entry.path === 'src/search/search.css') return file(entry.path, [{ ...entry.hunks[0]!, newStart: 30, oldStart: 30, header: '@@ -30,0 +30,1 @@' }]);
        return entry;
      }),
    };
    const remapped = normalizePlan(pushed, remapProposals(first, pushed), { producer: first.producer, model: first.model, madeAt: first.madeAt });
    const debounce = remapped.steps.find((step) => step.title === 'add debounce helper');
    expect(debounce?.id).toBe(first.steps.find((step) => step.title === 'add debounce helper')?.id);
    expect(debounce?.touches).toContainEqual({ path: 'src/search/search.css', hunk: 0 });
    // The hunk the plan never saw ends in the trailing step; the step it joins reads as changed by fingerprint.
    expect(remapped.steps.find((step) => step.title === 'Everything else')?.touches).toEqual([{ path: 'src/results/ResultsList.tsx', hunk: 1 }]);
    const results = remapped.steps.find((step) => step.title === 'Update ResultsList.tsx');
    expect(results?.fingerprint).toBe(first.steps.find((step) => step.title === 'Update ResultsList.tsx')?.fingerprint);
  });
});

describe('progress', () => {
  it('reads states, carries marks across plans and finds the next step', () => {
    const plan = rulesPlan(input, 'now');
    const [first, second] = plan.steps;
    if (first === undefined || second === undefined) throw new Error('expected steps');
    const progress: ReviewProgress = { planId: plan.id, steps: { [first.id]: { state: 'accepted', at: 'now', fingerprint: first.fingerprint } }, current: first.id };
    expect(stepDisplayState(first, progress)).toBe('accepted');
    expect(stepDisplayState(second, progress)).toBe('pending');
    expect(nextPendingStep(plan, progress)?.id).toBe(second.id);
    expect(reviewComplete(plan, progress)).toBe(false);
    const changed: ReviewProgress = { ...progress, steps: { [first.id]: { state: 'accepted', at: 'now', fingerprint: 'other' } } };
    expect(stepDisplayState(first, changed)).toBe('changed');
    expect(nextPendingStep(plan, changed)?.id).toBe(first.id);
    const carried = carryProgress(progress, { ...plan, id: 'next', steps: plan.steps.slice(0, 1) });
    expect(carried.planId).toBe('next');
    expect(Object.keys(carried.steps)).toEqual([first.id]);
    const done = { planId: plan.id, steps: Object.fromEntries(plan.steps.map((step) => [step.id, { state: 'flagged' as const, at: 'now', note: 'hm', fingerprint: step.fingerprint }])), current: null };
    expect(reviewComplete(plan, done)).toBe(true);
    expect(finishBody(plan, done)).toContain(`Reviewed in ${plan.steps.length} steps with Geld.`);
    expect(finishBody(plan, done)).toContain(`- **${first.title}**: hm`);
  });
});

describe('words', () => {
  it('finds file stems through test and snapshot suffixes', () => {
    expect(stemOf('src/search.ts')).toBe('search');
    expect(stemOf('src/Button.test.tsx')).toBe('button');
    expect(stemOf('__snapshots__/Foo.tsx.snap')).toBe('foo');
    expect(stemOf('tests/test_api.py')).toBe('api');
    expect(stemOf('pkg/api_test.go')).toBe('api');
    expect(stemOf('Search.stories.tsx')).toBe('search');
  });

  it('cleans commit titles and reads kinds', () => {
    expect(cleanCommitTitle('feat(search): Debounce the box (#123)\n\nbody')).toBe('Debounce the box');
    expect(kindFor(['Fix crash on empty query'], [])).toBe('fix');
    expect(kindFor([], ['README.md', 'docs/guide.mdx'])).toBe('docs');
    expect(kindFor([], ['tsconfig.json', '.eslintrc'])).toBe('chore');
    expect(kindFor([], ['src/a.ts'])).toBe('other');
  });

  it('spots defined symbols in a few languages', () => {
    const names = definedSymbols(['export function debounce() {}', 'class SearchBox {', 'def fetch_rows():', 'pub fn parse(', '.search-spinner {', 'const x = 1;', '--geld-gap: 4px;']);
    expect([...names]).toEqual(['debounce', 'SearchBox', 'fetch_rows', 'parse', 'search-spinner', '--geld-gap']);
  });
});
