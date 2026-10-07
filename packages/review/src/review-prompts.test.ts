import { describe, expect, it } from 'vitest';
import type { PlanFile, PlanHunk, PlanInput } from './review-plan';
import { hashText, normalizePlan, rulesPlan, rulesProposals } from './review-plan';
import { diffDetailFor, hunkHandles, parsePlanOutput, parseStoryOutput, planUserPrompt, storyUserPrompt } from './review-prompts';

function hunk(index: number, added: readonly string[], removed: readonly string[] = []): PlanHunk {
  return { index, header: `@@ -1,${removed.length} +1,${added.length} @@`, oldStart: 1, oldLines: removed.length, newStart: 1, newLines: added.length, added, removed, signature: hashText(`${index}:${added.join('|')}`) };
}

function file(path: string, hunks: readonly PlanHunk[], extra: Partial<PlanFile> = {}): PlanFile {
  return { path, status: 'modified', binary: false, hidden: null, hunks, ...extra };
}

const input: PlanInput = {
  title: 'Add retries',
  body: 'Retries failed fetches three times.',
  headSha: 'a'.repeat(40),
  commits: [{ sha: '1'.repeat(40), message: 'Add retry loop\n\nDetails', files: ['src/fetch.ts'] }],
  files: [file('src/fetch.ts', [hunk(0, ['for (let i = 0; i < 3; i++) {']), hunk(1, ['x'.repeat(400)])]), file('src/fetch.test.ts', [hunk(0, ['it()'])], { hidden: { id: 'tests', title: 'Tests' } })],
  findings: [{ id: 'f1', path: 'src/fetch.ts', line: 1 }],
};

describe('plan prompt', () => {
  it('numbers visible hunks, lists hidden files by path and carries the candidates', () => {
    const handles = hunkHandles(input);
    expect([...handles.keys()]).toEqual(['h1', 'h2']);
    expect(handles.get('h2')).toEqual({ path: 'src/fetch.ts', hunk: 1 });
    const prompt = planUserPrompt(input, { candidates: rulesProposals(input) });
    const payload: unknown = JSON.parse(prompt);
    expect(payload).toMatchObject({ title: 'Add retries', description: 'Retries failed fetches three times.', commits: ['Add retry loop'], detail: 'every changed line', hiddenFiles: ['src/fetch.test.ts'], openFindings: ['src/fetch.ts:1'] });
    if (typeof payload !== 'object' || payload === null || !('hunks' in payload) || !('candidates' in payload)) throw new Error('shape');
    expect(payload.hunks).toHaveLength(2);
    expect(payload.hunks).toMatchObject([{ handle: 'h1', file: 'src/fetch.ts', lines: ['+for (let i = 0; i < 3; i++) {'] }, { handle: 'h2' }]);
    // Long lines are cut so minified output cannot take the budget.
    const second = Array.isArray(payload.hunks) ? payload.hunks[1] : null;
    expect(JSON.stringify(second)).toContain('…');
    expect(payload.candidates).toMatchObject([{ key: 'r1', title: 'Add retry loop', hunks: ['h1', 'h2'] }]);
    expect(diffDetailFor(input)).toBe('full');
  });

  it('names previous steps and new hunks on a replan', () => {
    const plan = rulesPlan(input, 'now');
    const prompt = planUserPrompt(input, { candidates: [], previous: { plan, newHandles: ['h2'] } });
    expect(prompt).toContain('"previousSteps"');
    expect(prompt).toContain('"newHunks"');
    expect(prompt).toContain(plan.steps[0]?.id ?? 'missing');
  });

  it('parses the model answer into proposals, dropping handles it did not give', () => {
    const handles = hunkHandles(input);
    const text = '```json\n{"steps":[{"key":"s1","title":"Add the retry loop.","kind":"feature","gist":"Retries three times","hunks":["h1","h9"],"dependsOn":["s2","s1"],"watch":[" no cap "]},{"key":"s2","title":"Nothing","kind":"weird","gist":"","hunks":["h2"],"dependsOn":[],"watch":[]},{"key":"s3","title":"Empty","kind":"other","gist":"","hunks":["h7"],"dependsOn":[],"watch":[]}]}\n```';
    const parsed = parsePlanOutput(text, handles);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toEqual([
      { key: 's1', title: 'Add the retry loop', kind: 'feature', gist: 'Retries three times', touches: [{ path: 'src/fetch.ts', hunk: 0 }], dependsOn: ['s2'], watch: ['no cap'] },
      { key: 's2', title: 'Nothing', kind: 'other', gist: null, touches: [{ path: 'src/fetch.ts', hunk: 1 }], dependsOn: [], watch: [] },
    ]);
    const plan = normalizePlan(input, parsed.value, { producer: 'ai', model: 'm', madeAt: 'now' });
    // s1 depends on s2, so s2 reads first; the hidden test file follows fetch.ts into the step that owns its first hunk.
    expect(plan.steps.map((step) => step.title)).toEqual(['Nothing', 'Add the retry loop']);
    expect(plan.steps.flatMap((step) => step.supporting.map((ref) => ref.path))).toEqual(['src/fetch.test.ts']);
    expect(parsePlanOutput('not json', handles)).toMatchObject({ ok: false });
    expect(parsePlanOutput('{"steps":"no"}', handles)).toMatchObject({ ok: false });
  });
});

describe('story prompt', () => {
  it('carries the plan, the step and its hunks', () => {
    const plan = rulesPlan(input, 'now');
    const step = plan.steps[0];
    if (step === undefined) throw new Error('expected a step');
    const payload: unknown = JSON.parse(storyUserPrompt(input, plan, step));
    expect(payload).toMatchObject({ pullRequest: 'Add retries', step: 1, title: step.title, touches: ['src/fetch.ts (2 hunks)'], supporting: ['src/fetch.test.ts'] });
    if (typeof payload !== 'object' || payload === null || !('hunks' in payload)) throw new Error('shape');
    expect(payload.hunks).toHaveLength(2);
  });

  it('parses a story, trimming and capping watch items', () => {
    const parsed = parseStoryOutput('{"story":" It retries. ","why":"","watch":["a","","b","c","d"]}');
    expect(parsed).toEqual({ ok: true, value: { story: 'It retries.', why: null, watch: ['a', 'b', 'c'] } });
    expect(parseStoryOutput('{"story":""}')).toMatchObject({ ok: false });
  });
});
