import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@geld/core';
import type { GeldSettings } from '@geld/core';
import { buildProviderReviewItems, providerReviewKey } from '@geld/review';
import type { ProviderReviewComment, ProviderReviewInput, ProviderReviewSubject } from '@geld/review';
import type { AiRunRecord } from '../lib/local-state';
import type { AiCompleteRequest, AiEvaluateRequest } from '../lib/messages';
import { ProviderAiTriage } from './ai';
import type { ProviderAiDependencies, ProviderAiState } from './ai';

vi.mock('wxt/browser', () => ({ browser: { runtime: { sendMessage: vi.fn(() => { throw new Error('Unexpected real transport'); }) } } }));
vi.mock('wxt/utils/storage', () => ({ storage: { defineItem: () => ({ getValue: async () => ({}), setValue: async () => undefined }) } }));

const subject: ProviderReviewSubject = { provider: 'gitlab', origin: 'https://gitlab.com', repository: 'group/subgroup/project', id: '42', headSha: 'a'.repeat(40) };
const url = 'https://gitlab.com/group/subgroup/project/-/merge_requests/42';

function comment(id = '1', body = 'The cache leaks credentials.', human = false): ProviderReviewComment {
  return { id, anchor: `note_${id}`, url: `${url}#note_${id}`, author: { id: human ? '33' : '22', login: human ? 'alice' : 'project-review-bot', automated: !human }, body, createdAt: '2026-11-01T12:00:00Z' };
}

function review(comments: readonly ProviderReviewComment[] = [comment()]): ProviderReviewInput {
  return { subject, bots: [{ id: 'greptile', authorId: '22' }], threads: [{ id: 'a'.repeat(40), anchor: `discussion_${'a'.repeat(40)}`, url: `${url}#note_1`, path: 'cache.ts', line: 12, resolved: false, outdated: false, comments }] };
}

function settings(overrides: Partial<GeldSettings> = {}): GeldSettings {
  return { ...DEFAULT_SETTINGS, aiEnabled: true, aiBaseUrl: 'https://gateway.example/v1', aiModel: 'writer', aiJev: false, ...overrides };
}

function promptIds(message: AiCompleteRequest): readonly string[] {
  const data: unknown = JSON.parse(message.messages[1]?.content ?? '{}');
  if (typeof data !== 'object' || data === null) return [];
  const items: unknown = Reflect.get(data, 'items');
  if (!Array.isArray(items)) return [];
  return items.flatMap((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const id: unknown = Reflect.get(entry, 'id');
    return typeof id === 'string' ? [id] : [];
  });
}

function response(message: AiCompleteRequest | AiEvaluateRequest): unknown {
  if (message.type === 'geld:ai-evaluate') return { ok: true, model: 'jev', answers: Object.fromEntries(Object.keys(message.request.questions).map((key) => [key, { type: 'noul', noul: 0.98 }])) };
  return { ok: true, model: 'writer', text: message.schemaName === 'geld_summary' ? JSON.stringify({ tldr: 'Credential handling needs attention.' }) : JSON.stringify({ items: promptIds(message).map((id) => ({ id, title: 'Prevent the credential leak', context: 'Use a separate cache per identity.' })) }) };
}

function fixture(overrides: Partial<ProviderAiDependencies> = {}, initial: Readonly<Record<string, AiRunRecord>> = {}) {
  let runs = initial;
  const send = vi.fn(async (message: AiCompleteRequest | AiEvaluateRequest): Promise<unknown> => response(message));
  const write = vi.fn(async (value: Readonly<Record<string, AiRunRecord>>) => { runs = value; });
  const states: ProviderAiState[] = [];
  const dependencies: ProviderAiDependencies = { readKey: async () => 'device-only-key', permission: async () => null, readRuns: async () => runs, writeRuns: write, send, jevRoute: async () => null, now: () => '2026-11-01T13:00:00Z', ...overrides };
  const triage = new ProviderAiTriage((state) => { states.push(state); }, dependencies);
  return { triage, send, write, states, dependencies, runs: () => runs };
}

describe('explicit provider AI triage', () => {
  it('loads and overlays without making any request until run is explicitly called', async () => {
    const f = fixture();
    const input = review();
    await f.triage.load(input, [], settings());
    expect(f.send).not.toHaveBeenCalled();
    expect(f.write).not.toHaveBeenCalled();
    expect(f.triage.state.kind).toBe('idle');
    await f.triage.run(input, [], settings());
    expect(f.send).toHaveBeenCalledTimes(2);
    expect(f.triage.state.kind).toBe('ready');
    expect(f.triage.state.summary?.tldr).toContain('Credential');
    expect(f.triage.apply(buildProviderReviewItems(input))[0]?.title).toBe('Prevent the credential leak');
    const serialized = JSON.stringify(f.runs());
    expect(serialized).not.toContain('device-only-key');
    expect(serialized).not.toContain('The cache leaks credentials.');
    expect(serialized).not.toContain('apiKey');
    expect(f.states.some((state) => state.kind === 'running')).toBe(true);
  });

  it.each([
    { name: 'disabled', options: { aiEnabled: false }, dependencies: {}, error: 'Enable AI' },
    { name: 'key missing', options: {}, dependencies: { readKey: async () => '  ' }, error: 'on this device' },
    { name: 'permission denied', options: {}, dependencies: { permission: async () => 'Gateway permission denied' }, error: 'permission denied' },
    { name: 'writing model missing', options: { aiModel: '' }, dependencies: {}, error: 'writing model' },
  ])('does not send when $name', async ({ options, dependencies, error }) => {
    const f = fixture(dependencies);
    await f.triage.run(review(), [], settings(options));
    expect(f.send).not.toHaveBeenCalled();
    expect(f.triage.state.kind).toBe('error');
    expect(f.triage.state.error).toContain(error);
    expect(f.runs()).toEqual({});
  });

  it('preserves human words and mixed threads, and requires durable identity rather than bot aliases', async () => {
    const human = review([comment('1', 'Please keep my precise wording?', true)]);
    const mixed = review([comment(), comment('2', 'I disagree with this interpretation.', true)]);
    const collision = review([{ ...comment(), author: { id: '44', login: 'greptileai', automated: true } }]);
    for (const input of [human, mixed, collision]) {
      const f = fixture();
      const original = buildProviderReviewItems(input);
      await f.triage.run(input, [], settings());
      expect(f.triage.apply(original)).toEqual(original);
      expect(f.send.mock.calls.every(([message]) => message.type === 'geld:ai-complete' && message.schemaName === 'geld_summary')).toBe(true);
    }
  });

  it('reuses unchanged sources, survives reload, and invalidates an edited body at the same anchor', async () => {
    const f = fixture();
    const input = review();
    await f.triage.run(input, [], settings());
    await f.triage.run(input, [], settings());
    expect(f.send).toHaveBeenCalledTimes(2);
    const reloaded = new ProviderAiTriage(() => undefined, f.dependencies);
    await reloaded.load(input, [], settings());
    expect(reloaded.apply(buildProviderReviewItems(input))[0]?.rewritten).toBe(true);
    expect(reloaded.state.stale).toBe(false);
    const edited = review([comment('1', 'The credentials are encrypted now, but the TTL is wrong.')]);
    await reloaded.load(edited, [], settings());
    expect(reloaded.apply(buildProviderReviewItems(edited))[0]?.rewritten).not.toBe(true);
    expect(reloaded.state.summary).toBeUndefined();
    expect(reloaded.state.stale).toBe(true);
    await reloaded.run(edited, [], settings());
    expect(f.send).toHaveBeenCalledTimes(4);
    expect(f.send.mock.calls[2]?.[0].type === 'geld:ai-complete' && f.send.mock.calls[2]?.[0].messages[1]?.content).toContain('TTL is wrong');
  });

  it('keeps source rewrites after a push while requiring a current-head summary', async () => {
    const f = fixture();
    await f.triage.run(review(), [], settings());
    const pushed = { ...review(), subject: { ...subject, headSha: 'b'.repeat(40) } };
    await f.triage.load(pushed, [], settings());
    expect(f.triage.apply(buildProviderReviewItems(pushed))[0]?.rewritten).toBe(true);
    expect(f.triage.state.summary).toBeUndefined();
    await f.triage.run(pushed, [], settings());
    expect(f.send).toHaveBeenCalledTimes(3);
    expect(Object.keys(f.runs())).toEqual([providerReviewKey(subject)]);
  });

  it('uses Bitbucket review identity and native comment anchors without GitHub aliases', async () => {
    const bitbucketUrl = 'https://bitbucket.org/workspace/repository/pull-requests/42';
    const native = { ...comment('12'), anchor: 'comment-12', url: `${bitbucketUrl}#comment-12` };
    const input: ProviderReviewInput = { subject: { ...subject, provider: 'bitbucket', origin: 'https://bitbucket.org', repository: 'workspace/repository' }, bots: [{ id: 'greptile', authorId: '22' }], threads: [{ id: '12', anchor: native.anchor, url: native.url, path: 'cache.ts', line: 12, resolved: false, outdated: false, comments: [native] }] };
    const f = fixture();
    await f.triage.run(input, [], settings());
    expect(f.triage.state.kind).toBe('ready');
    expect(f.triage.state.key).toBe(providerReviewKey(input.subject));
    const message = f.send.mock.calls[0]?.[0];
    expect(message?.type === 'geld:ai-complete' && message.messages[1]?.content).toContain('comment-12');
    expect(JSON.stringify(f.send.mock.calls)).not.toContain('discussion_r');
    expect(f.triage.apply(buildProviderReviewItems(input))[0]?.sources[0]?.anchor).toBe('comment-12');
  });

  it.each(['reset', 'head', 'cancel'])('ignores late replies after %s and sends no later summary', async (change) => {
    let finish: (value: unknown) => void = () => undefined;
    const send = vi.fn((message: AiCompleteRequest | AiEvaluateRequest) => new Promise<unknown>((resolve) => { finish = () => resolve(response(message)); }));
    const f = fixture({ send });
    const running = f.triage.run(review(), [], settings());
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    if (change === 'reset') f.triage.reset();
    else if (change === 'cancel') f.triage.cancel();
    else await f.triage.load({ ...review(), subject: { ...subject, headSha: 'c'.repeat(40) } }, [], settings());
    finish(null);
    await running;
    expect(send).toHaveBeenCalledTimes(1);
    expect(f.write).not.toHaveBeenCalled();
    expect(f.triage.state.kind).not.toBe('running');
  });

  it('deduplicates concurrent explicit clicks', async () => {
    const f = fixture();
    await Promise.all([f.triage.run(review(), [], settings()), f.triage.run(review(), [], settings())]);
    expect(f.send).toHaveBeenCalledTimes(2);
  });

  it('merges scoped provider runs with existing GitHub runs and caps the shared history at forty', async () => {
    const initial: Record<string, AiRunRecord> = {};
    for (let index = 0; index < 39; index += 1) initial[`github:owner:repo:${index}`] = { ranAt: `2026-10-${String(index % 28 + 1).padStart(2, '0')}T12:00:00Z`, rewrites: [] };
    initial['github:keep:repo:1'] = { ranAt: '2026-11-01T12:30:00Z', rewrites: [{ id: 'old-github-item', title: 'Keep the existing GitHub result' }] };
    const f = fixture({}, initial);
    const another = new ProviderAiTriage(() => undefined, f.dependencies);
    const hosted = { ...review(), subject: { ...subject, origin: 'https://gitlab.example', repository: 'other/subgroup/project' }, threads: review().threads.map((thread) => ({ ...thread, url: thread.url.replace('gitlab.com/group/', 'gitlab.example/other/'), comments: thread.comments.map((entry) => ({ ...entry, url: entry.url.replace('gitlab.com/group/', 'gitlab.example/other/') })) })) };
    await Promise.all([f.triage.run(review(), [], settings()), another.run(hosted, [], settings())]);
    expect(Object.keys(f.runs())).toHaveLength(40);
    expect(f.runs()['github:keep:repo:1']).toEqual(initial['github:keep:repo:1']);
    expect(Object.keys(f.runs()).filter((key) => key.startsWith('gitlab@'))).toHaveLength(2);
  });

  it('keeps an earlier successful record when a later request fails', async () => {
    const f = fixture();
    await f.triage.run(review(), [], settings());
    const successful = f.runs()[providerReviewKey(subject)];
    const broken = new ProviderAiTriage(() => undefined, { ...f.dependencies, send: async () => ({ ok: false, reason: 'Gateway unavailable' }) });
    const pushed = { ...review(), subject: { ...subject, headSha: 'c'.repeat(40) } };
    await broken.run(pushed, [], settings());
    const cached = f.runs()[providerReviewKey(subject)];
    expect(cached?.rewrites).toEqual(successful?.rewrites);
    expect(cached?.summary).toEqual(successful?.summary);
    expect(cached?.error).toBe('Gateway unavailable');
    expect(broken.state.kind).toBe('error');
    expect(broken.state.summary).toBeUndefined();
  });

  it('uses the shared thread rubric for semantic addressed state and preserves native state', async () => {
    const f = fixture({ jevRoute: async () => ({ baseUrl: 'https://gateway.example/v1', apiKey: 'device-only-key', model: 'jev' }) });
    const input = review([comment(), comment('2', 'Fixed in commit abcdef1 with a separate identity cache.', true)]);
    await f.triage.run(input, [], settings({ aiJev: true }));
    const item = f.triage.apply(buildProviderReviewItems(input))[0];
    expect(item?.status).toBe('addressed');
    expect(item?.title).toBe(buildProviderReviewItems(input)[0]?.title);
    expect(item?.addressed?.evidence[0]).toContain('native resolution is unchanged');
    const request = f.send.mock.calls[0]?.[0];
    expect(request?.type === 'geld:ai-evaluate' && JSON.stringify(request.request.questions)).toContain('no later reply disputes it');
    for (const state of ['resolved', 'outdated']) {
      const native = { ...input, threads: input.threads.map((thread) => ({ ...thread, resolved: state === 'resolved', outdated: state === 'outdated' })) };
      await f.triage.load(native, [], settings({ aiJev: true }));
      expect(f.triage.apply(buildProviderReviewItems(native))[0]?.status).toBe(state);
    }
  });

  it('rejects incomplete structured output without pretending it completed triage', async () => {
    const f = fixture({ send: async () => ({ ok: true, model: 'writer', text: '{"items":[]}' }) });
    await f.triage.run(review(), [], settings());
    expect(f.triage.state.kind).toBe('error');
    expect(f.triage.state.error).toContain('omitted review items');
    expect(f.runs()[providerReviewKey(subject)]?.rewrites).toEqual([]);
    expect(f.runs()[providerReviewKey(subject)]?.error).toContain('omitted review items');
    const reloaded = new ProviderAiTriage(() => undefined, f.dependencies);
    await reloaded.load(review(), [], settings());
    expect(reloaded.state.kind).toBe('error');
    expect(reloaded.state.stale).toBe(true);
  });
});
