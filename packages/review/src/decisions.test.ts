import { describe, expect, it } from 'vitest';
import { candidatePairs, classificationRequests, doneFrom, doneKey, laneKey, lanesFrom, pairKey, sameProblemGroups, sameProblemRequest, withSameProblem } from './decisions';
import { isEvaluationModel, jevEndpoint, jevModelIn, parseJevResponse } from './jev';
import type { ConsolidateInputItem } from './prompts';

const item = (id: string, path: string, title = `Finding ${id}`): ConsolidateInputItem => ({ id, title, path, sources: [`c-${id}`], excerpts: [`${title} said at length`], wantFix: false });

describe('jev', () => {
  it('recognises evaluation models under every name a gateway uses', () => {
    expect(isEvaluationModel('typesafe-ai/jev')).toBe(true);
    expect(isEvaluationModel('jev-latest')).toBe(true);
    expect(isEvaluationModel('jev-1.13.0')).toBe(true);
    expect(isEvaluationModel('anthropic/claude-sonnet-4.5')).toBe(false);
    expect(isEvaluationModel('openai/gpt-4.1-mini')).toBe(false);
    expect(jevModelIn([{ id: 'openai/gpt-4.1' }, { id: 'typesafe-ai/jev' }])).toBe('typesafe-ai/jev');
    expect(jevModelIn([{ id: 'openai/gpt-4.1' }])).toBeNull();
  });

  it('posts to the compatibility prefix on a gateway and to the plain path at TypeSafe', () => {
    expect(jevEndpoint('https://ai-gateway.vercel.sh')).toBe('https://ai-gateway.vercel.sh/typesafe/v1/systemone');
    expect(jevEndpoint('https://api.typesafe.ai')).toBe('https://api.typesafe.ai/v1/systemone');
  });

  it('parses the three answer kinds and rejects anything else', () => {
    const parsed = parseJevResponse({
      model: 'jev-1.13.0',
      answers: {
        a: { type: 'noul', noul: 0.95 },
        b: { type: 'choice', choice: 'billing', confidence: 0.8, probabilities: { billing: 0.87, technical: 0.13 } },
        c: { type: 'score', score: 1.04, confidence: 0.94, probabilities: { '0': 0, '1': 0.96, '2': 0.04 } },
      },
    });
    expect(parsed?.model).toBe('jev-1.13.0');
    expect(parsed?.answers.a).toEqual({ type: 'noul', noul: 0.95 });
    expect(parsed?.answers.b).toMatchObject({ type: 'choice', choice: 'billing' });
    expect(parseJevResponse({ choices: [] })).toBeNull();
    expect(parseJevResponse({ answers: { a: { type: 'noul', noul: 'yes' } } })).toBeNull();
  });
});

describe('same-problem decisions', () => {
  it('asks every pair of a small round and only same-file pairs of a large one', () => {
    const small = [item('a', 'x.ts'), item('b', 'y.ts'), item('c', 'x.ts')];
    expect(candidatePairs(small)).toHaveLength(3);
    const large = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id, index) => item(id, index < 4 ? 'x.ts' : `${id}.ts`));
    const pairs = candidatePairs(large);
    expect(pairs).toHaveLength(6);
    expect(pairs.every((pair) => pair.a < 'e' && pair.b < 'e')).toBe(true);
  });

  it('builds one request with the items as state and a noul question per pair', () => {
    const request = sameProblemRequest('typesafe-ai/jev', [item('a', 'x.ts'), item('b', 'x.ts')]);
    expect(request?.model).toBe('typesafe-ai/jev');
    expect(request?.state).toContain('[a] (x.ts) Finding a');
    expect(Object.keys(request?.questions ?? {})).toEqual([pairKey('a', 'b')]);
    expect(sameProblemRequest('typesafe-ai/jev', [item('a', 'x.ts')])).toBeNull();
  });

  it('groups items joined by confident yes answers and narrows the prose request to them', () => {
    const items = [item('a', 'x.ts'), item('b', 'x.ts'), item('c', 'x.ts'), item('d', 'x.ts')];
    const groups = sameProblemGroups(items, {
      [pairKey('a', 'b')]: { type: 'noul', noul: 0.91 },
      [pairKey('b', 'c')]: { type: 'noul', noul: 0.75 },
      [pairKey('a', 'c')]: { type: 'noul', noul: 0.2 },
      [pairKey('c', 'd')]: { type: 'noul', noul: 0.4 },
    });
    expect(groups.map((group) => [...group].sort())).toEqual([['a', 'b', 'c']]);
    const narrowed = withSameProblem(items, groups);
    expect(narrowed.map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
    expect(narrowed[0]?.sameProblemAs).toEqual(['b', 'c']);
  });
});

describe('classification decisions', () => {
  it('puts comments and threads into one structured state with a question each, in batches', () => {
    const comments = Array.from({ length: 30 }, (_, index) => ({ id: `c${index}`, author: index % 2 ? 'devin-ai-integration[bot]' : 'alice', bot: index % 2 === 1, text: `Comment ${index}` }));
    const threads = [{ id: 't1', path: 'a.ts', first: { author: 'bugbot[bot]', text: 'Null check missing' }, replies: [{ author: 'alice', text: 'Fixed in abc123' }] }];
    const requests = classificationRequests('typesafe-ai/jev', comments, threads);
    expect(requests).toHaveLength(2);
    const first = requests[0];
    expect(typeof first?.state).toBe('object');
    expect(Object.keys(first?.questions ?? {})).toHaveLength(24);
    expect(first?.questions[laneKey('c0')]?.type).toBe('choice');
    const second = requests[1];
    expect(second?.questions[doneKey('t1')]?.type).toBe('noul');
    expect(classificationRequests('typesafe-ai/jev', [], [])).toEqual([]);
  });

  it('keeps only confident lanes and thresholds thread state at 0.9', () => {
    const lanes = lanesFrom({
      [laneKey('a')]: { type: 'choice', choice: 'status', confidence: 0.9, probabilities: {} },
      [laneKey('b')]: { type: 'choice', choice: 'finding', confidence: 0.4, probabilities: {} },
      [laneKey('c')]: { type: 'choice', choice: 'nonsense', confidence: 0.99, probabilities: {} },
    });
    expect([...lanes.entries()]).toEqual([['a', 'status']]);
    const done = doneFrom({ [doneKey('t1')]: { type: 'noul', noul: 0.95 }, [doneKey('t2')]: { type: 'noul', noul: 0.05 }, [doneKey('t3')]: { type: 'noul', noul: 0.6 } });
    expect(done.get('t1')?.verdict).toBe('yes');
    expect(done.get('t2')?.verdict).toBe('no');
    expect(done.get('t3')?.verdict).toBe('unclear');
  });
});
