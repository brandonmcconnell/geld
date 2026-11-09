import { describe, expect, it } from 'vitest';
import { answersComplete, candidatePairs, classificationRequests, doneFrom, doneKey, laneKey, lanesFrom, pairKey, previewStatusesFrom, previewStatusKey, sameProblemGroups, sameProblemRequest, withSameProblem } from './decisions';
import { decisionModelsIn, decisionModelsPath, decisionRoute, defaultDecisionModel, evaluateDecision, isEvaluationModel, isJevModel, servesDecisions, jevModelFor, jevModelIn, openAiDecisionsBody, parseJevResponse, parseOpenAiDecisions } from './jev';
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
    expect(isEvaluationModel('perplexity/pplx-decider-v1.2', 'decision')).toBe(true);
  });

  it('picks Jev from a list holding other decision models, the unpinned id first', () => {
    // Vercel's /v1/models, Nov 2026: every decision model is typed `evaluation`, sorted by id.
    const vercel = [
      { id: 'baseten/elephant-1', type: 'evaluation' },
      { id: 'openai/gpt-4.1', type: 'language' },
      { id: 'perplexity/pplx-decider-v1.2', type: 'evaluation' },
      { id: 'typesafe-ai/jev-1.13.0', type: 'evaluation' },
      { id: 'typesafe-ai/jev', type: 'evaluation' },
      { id: 'typesafe-ai/jev-1.14.0', type: 'evaluation' },
    ];
    expect(jevModelIn(vercel)).toBe('typesafe-ai/jev');
    expect(jevModelIn(vercel.filter((model) => model.id !== 'typesafe-ai/jev'))).toBe('typesafe-ai/jev-1.13.0');
    expect(jevModelIn(vercel.filter((model) => !model.id.startsWith('typesafe-ai/')))).toBeNull();
    expect(jevModelFor('https://ai-gateway.vercel.sh', vercel.slice(0, 3))).toBe('typesafe-ai/jev');
  });

  it('routes each gateway and model to the format it speaks', () => {
    expect(decisionRoute('https://api.typesafe.ai', 'jev-latest')).toEqual({ url: 'https://api.typesafe.ai/v1/systemone', wire: 'typesafe' });
    expect(decisionRoute('https://openrouter.ai/api', 'typesafe/jev-latest')).toEqual({ url: 'https://openrouter.ai/api/alpha/decisions', wire: 'typesafe' });
    expect(decisionRoute('https://openrouter.ai/api', 'perplexity/pplx-decider-v1.2')).toEqual({ url: 'https://openrouter.ai/api/alpha/decisions', wire: 'typesafe' });
    expect(decisionRoute('https://ai-gateway.vercel.sh', 'typesafe-ai/jev')).toEqual({ url: 'https://ai-gateway.vercel.sh/typesafe/v1/systemone', wire: 'typesafe' });
    expect(decisionRoute('https://ai-gateway.vercel.sh', 'liquid/d1')).toEqual({ url: 'https://ai-gateway.vercel.sh/v1/decisions', wire: 'openai' });
    expect(decisionRoute('https://api.openai.com', 'gpt-6-luna')).toEqual({ url: 'https://api.openai.com/v1/decisions', wire: 'openai' });
  });

  it('lists decision models where each gateway keeps them, and picks one when the reader does not', () => {
    const vercel = [
      { id: 'baseten/elephant-1', type: 'evaluation' },
      { id: 'openai/gpt-4.1', type: 'language' },
      { id: 'typesafe-ai/jev', type: 'evaluation' },
    ];
    expect(decisionModelsIn(vercel).map((model) => model.id)).toEqual(['baseten/elephant-1', 'typesafe-ai/jev']);
    expect(decisionModelsIn([{ id: 'typesafe/jev-latest' }, { id: 'openai/gpt-4.1' }]).map((model) => model.id)).toEqual(['typesafe/jev-latest']);
    expect(decisionModelsPath('https://openrouter.ai/api')).toBe('/v1/models?output_modalities=decisions');
    expect(decisionModelsPath('https://ai-gateway.vercel.sh')).toBeNull();
    expect(defaultDecisionModel('https://ai-gateway.vercel.sh', vercel)).toBe('typesafe-ai/jev');
    expect(defaultDecisionModel('https://api.openai.com', [{ id: 'gpt-6-luna' }])).toBe('gpt-6-luna');
    expect(defaultDecisionModel('https://gw.example.com', [{ id: 'acme/decide-1', type: 'decision' }])).toBe('acme/decide-1');
    expect(defaultDecisionModel('https://bedrock-mantle.us-east-1.api.aws', [{ id: 'openai.gpt-oss-120b' }])).toBeNull();
  });

  it('speaks OpenAI\'s Decisions format and reads its answers back under Geld\'s ids', () => {
    const { body, names } = openAiDecisionsBody({
      model: 'liquid/d1',
      state: { comments: [{ id: 'c:1', text: 'LGTM' }] },
      questions: {
        'done:t:1': { type: 'noul', instructions: 'Is `thread` resolved?', criteria: { true: 'The replies say it is fixed', false: 'It is still open' } },
        'lane:c:1': { type: 'choice', instructions: 'What is `comment`?', criteria: { trigger: 'Asks a bot to run', discussion: 'Anything else' } },
        'rank:x': { type: 'score', instructions: 'How severe?', criteria: ['low', 'high'] },
      },
    });
    expect(body.input).toBe('{"comments":[{"id":"c:1","text":"LGTM"}]}');
    expect(body.questions).toEqual([
      { type: 'predicate', name: 'q0', instructions: 'Is `thread` resolved?\nYes means: The replies say it is fixed\nNo means: It is still open' },
      { type: 'choice', name: 'q1', instructions: 'What is `comment`?', choices: [{ value: 'trigger', description: 'Asks a bot to run' }, { value: 'discussion', description: 'Anything else' }] },
      { type: 'score', name: 'q2', instructions: 'How severe?', levels: [{ label: 'low' }, { label: 'high' }] },
    ]);
    const parsed = parseOpenAiDecisions(
      {
        model: 'liquid/d1',
        answers: [
          { type: 'predicate', name: 'q0', probability: 0.93 },
          { type: 'choice', name: 'q1', choice: 'discussion', confidence: 0.8, probabilities: [{ value: 'trigger', probability: 0.1 }, { value: 'discussion', probability: 0.9 }] },
          { type: 'refusal', name: 'q2' },
        ],
      },
      names,
    );
    expect(parsed?.answers).toEqual({
      'done:t:1': { type: 'noul', noul: 0.93 },
      'lane:c:1': { type: 'choice', choice: 'discussion', confidence: 0.8, probabilities: { trigger: 0.1, discussion: 0.9 } },
    });
    expect(parseOpenAiDecisions({ answers: 'no' }, names)).toBeNull();
  });

  it('knows the Jev model of gateways that do not list it', () => {
    expect(jevModelFor('https://openrouter.ai/api', [{ id: 'openai/gpt-4.1' }])).toBe('typesafe/jev-latest');
    expect(jevModelFor('https://ai-gateway.vercel.sh', [{ id: 'openai/gpt-4.1' }, { id: 'typesafe-ai/jev' }])).toBe('typesafe-ai/jev');
    expect(jevModelFor('https://gw.example.com', [{ id: 'openai/gpt-4.1' }])).toBeNull();
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

describe('preview status decisions', () => {
  it('asks a choice with every preview state plus unknown, and takes the answer as given', () => {
    const [request] = classificationRequests('typesafe-ai/jev', [], [], [{ id: 'p1', host: 'vercel', project: 'dashboard', text: '| dashboard | Visit Preview | Sep 17 |' }]);
    const question = request?.questions[previewStatusKey('p1')];
    expect(question?.type).toBe('choice');
    expect(question?.type === 'choice' ? Object.keys(question.criteria).sort() : []).toEqual(['building', 'failed', 'ready', 'skipped', 'unknown']);
    const statuses = previewStatusesFrom({
      [previewStatusKey('p1')]: { type: 'choice', choice: 'ready', confidence: 0.55, probabilities: { ready: 0.55 } },
      [previewStatusKey('p2')]: { type: 'choice', choice: 'unknown', confidence: 0.9, probabilities: { unknown: 0.9 } },
      [previewStatusKey('p3')]: { type: 'choice', choice: 'nonsense', confidence: 0.9, probabilities: {} },
    });
    expect([...statuses.entries()]).toEqual([['p1', 'ready'], ['p2', 'unknown']]);
  });
});

it('calls the given fetch on its own, as a browser requires of its native fetch', async () => {
  const nativeLike = function (this: unknown, url: string): Promise<Response> {
    if (this !== undefined && this !== globalThis) return Promise.reject(new TypeError("Failed to execute 'fetch' on 'WorkerGlobalScope': Illegal invocation"));
    return Promise.resolve(Response.json(url.endsWith('/v1/decisions') ? { answers: [{ type: 'predicate', name: 'q0', probability: 0.7 }] } : { answers: { a: { type: 'noul', noul: 0.9 } } }));
  };
  const request = { model: 'typesafe-ai/jev', state: 'Fixture', questions: { a: { type: 'noul' as const, instructions: 'Yes?' } } };
  expect(await evaluateDecision({ fetch: nativeLike, baseUrl: 'https://ai-gateway.vercel.sh', apiKey: 'synthetic', request })).toEqual({ ok: true, model: '', answers: { a: { type: 'noul', noul: 0.9 } } });
  expect(await evaluateDecision({ fetch: nativeLike, baseUrl: 'https://ai-gateway.vercel.sh', apiKey: 'synthetic', request: { ...request, model: 'liquid/d1' } })).toEqual({ ok: true, model: '', answers: { a: { type: 'noul', noul: 0.7 } } });
});

it('keeps only OpenRouter catalog models that answer on its Decisions API', () => {
  expect(servesDecisions({ endpoints: ['/api/alpha/decisions'] })).toBe(true);
  expect(servesDecisions({ endpoints: ['/api/alpha/decisions', '/api/alpha/extractions'] })).toBe(true);
  expect(servesDecisions({ endpoints: ['/api/alpha/extractions'] })).toBe(false);
  expect(servesDecisions({})).toBe(true);
});

it('tells Jev apart under every spelling, so its answers keep their cache key', () => {
  for (const id of ['typesafe-ai/jev', 'typesafe/jev-latest', '~typesafe/jev-latest', 'jev-latest', 'typesafe-ai/jev-1.14.0']) expect(isJevModel(id)).toBe(true);
  for (const id of ['liquid/d1', 'gpt-6-luna', 'openai/gpt-6-luna-decisions']) expect(isJevModel(id)).toBe(false);
});

it('does not take a half-answered check as an answer', () => {
  const request = { model: 'liquid/d1', state: 's', questions: { a: { type: 'noul' as const, instructions: 'A?' }, b: { type: 'noul' as const, instructions: 'B?' } } };
  expect(answersComplete(request, { a: { type: 'noul', noul: 0.1 }, b: { type: 'noul', noul: 0.2 } })).toBe(true);
  expect(answersComplete(request, { a: { type: 'noul', noul: 0.1 } })).toBe(false);
  expect(answersComplete(request, {})).toBe(false);
});
