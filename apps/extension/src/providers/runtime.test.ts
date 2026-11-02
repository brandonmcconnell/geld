// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { ContentScriptContext } from 'wxt/utils/content-script-context';
import { DEFAULT_SETTINGS, trustedReviewAccountsFor, withTrustedReviewAccount, withTrustedSummaryPublisher } from '@geld/core';
import type { GeldSettings, RepositoryIdentity } from '@geld/core';
import { buildProviderReviewItems, createNativePublication, META_VERSION, readProviderPublication, renderProviderSummary } from '@geld/review';
import type { GeldPrMeta, ProviderReviewComment, ProviderReviewInput } from '@geld/review';
import { settingsItem } from '../lib/storage';
import { providerReviewedItemsItem, whitespaceOptOutsItem } from '../lib/local-state';
import type { ProviderReviewedRecord, ProviderReviewedStorage } from '../lib/local-state';
import { createProviderBotTrust, createProviderReviewedServices, startProvider } from './runtime';
import { providerReviewWithTrustedAccounts, reviewedItemFingerprint } from './conversation';
import { ProviderController } from './controller';
import type { ProviderAdapter, ProviderPage, ProviderReviewPage, ProviderReviewSnapshot } from './types';

vi.mock('wxt/browser', () => ({ browser: { runtime: { id: 'provider-test', sendMessage: vi.fn(async () => undefined), onMessage: { addListener: vi.fn() } } } }));
vi.mock('wxt/utils/content-script-context', () => ({ ContentScriptContext: class {
  private readonly abort = new AbortController();
  onInvalidated(callback: () => void): void { this.abort.signal.addEventListener('abort', callback); }
  addEventListener(target: Window | Document, type: string, listener: EventListener, options: AddEventListenerOptions = {}): void {
    target.addEventListener(type, listener, { ...options, signal: this.abort.signal });
  }
  notifyInvalidated(): void { this.abort.abort(); }
} }));
vi.mock('wxt/utils/storage', () => {
  const values = new Map<string, unknown>();
  return { storage: {
    defineItem: (key: string, options: { readonly fallback?: unknown } = {}) => ({
      getValue: async () => values.get(key) ?? options.fallback,
      setValue: async (value: unknown) => { values.set(key, value); },
      watch: () => () => undefined,
    }),
    getItem: async () => null, setItem: async () => undefined, watch: () => () => undefined,
  } };
});

const repository: RepositoryIdentity = { provider: 'gitlab', origin: 'https://gitlab.com', path: 'group/subgroup/project' };
const url = `${repository.origin}/${repository.path}/-/merge_requests/42`;
const sha = 'a'.repeat(40);
const page: ProviderReviewPage = { provider: 'gitlab', repository, number: '42', kind: 'overview', url, diffPageUrl: `${url}/diffs`, diffUrl: `${url}.diff`, headSha: sha, version: sha };
const subject = { provider: repository.provider, origin: repository.origin, repository: repository.path, id: '42', headSha: sha };
function comment(id = '1', accountId = '12345'): ProviderReviewComment {
  return { id, anchor: `note_${id}`, url: `${url}#note_${id}`, body: '**Actionable comments posted: 0**', author: { id: accountId, login: 'project_123_bot', automated: true }, createdAt: '2026-11-01T12:00:00Z' };
}
function source(comments: readonly ProviderReviewComment[] = [comment()]): ProviderReviewSnapshot {
  return { input: { subject, threads: [], complete: false }, comments, events: [], complete: false, unavailable: [{ area: 'checks', reason: 'permission' }], approvalsRequired: null, approvalsLeft: null, actions: [] };
}
function fixture(snapshot = source(), store?: Pick<typeof settingsItem, 'update'>) {
  let active: ProviderPage | null = page;
  let observed: ProviderReviewSnapshot | null = snapshot;
  let retired = false;
  const updated = vi.fn<(settings: GeldSettings) => void>();
  const save = createProviderBotTrust({ page: () => active, snapshot: () => observed, retired: () => retired, updated, ...(store === undefined ? {} : { settings: store }) });
  return { save, updated, navigate: (next: ProviderPage | null) => { active = next; }, snapshot: (next: ProviderReviewSnapshot | null) => { observed = next; }, retire: () => { retired = true; } };
}
function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let finish = (): void => undefined;
  const promise = new Promise<void>((resolve) => { finish = resolve; });
  return { promise, resolve: () => finish() };
}

beforeEach(async () => { await settingsItem.setValue(DEFAULT_SETTINGS); await providerReviewedItemsItem.setValue({}); });
afterEach(() => { vi.restoreAllMocks(); });

describe('explicit provider account trust', () => {
  it('saves an observed ordinary automated account even when unrelated review data is unavailable', async () => {
    const f = fixture();
    await settingsItem.patch({ showBadge: false });
    await f.save(source().input, comment(), 'coderabbit');
    const stored = await settingsItem.getValue();
    expect(trustedReviewAccountsFor(stored.trustedReviewAccounts, repository)).toEqual([{ repository, botId: 'coderabbit', authorId: '12345' }]);
    expect(stored.showBadge).toBe(false);
    expect(f.updated).toHaveBeenCalledWith(stored);
  });

  it('merges simultaneous explicit choices using the latest shared settings object', async () => {
    const first = comment();
    const second = comment('2', '99999');
    const f = fixture(source([first, second]));
    await Promise.all([f.save(source().input, first, 'coderabbit'), f.save(source().input, second, 'greptile')]);
    const stored = await settingsItem.getValue();
    expect(trustedReviewAccountsFor(stored.trustedReviewAccounts, repository).map((binding) => [binding.botId, binding.authorId])).toEqual([['coderabbit', '12345'], ['greptile', '99999']]);
  });

  it('accepts an actual thread account with the same durable-id checks', async () => {
    const actual = comment();
    const original = source([]);
    const input: ProviderReviewInput = { ...original.input, threads: [{ id: 'a'.repeat(40), anchor: `discussion_${'a'.repeat(40)}`, url: actual.url, resolved: false, outdated: false, comments: [actual] }] };
    const f = fixture({ ...original, input });
    await f.save(input, actual, 'greptile');
    expect((await settingsItem.getValue()).trustedReviewAccounts).toEqual(['gitlab.com/group/subgroup/project greptile 12345']);
  });

  it('does not trust a forged candidate flag, GitHub alias or review-looking body', async () => {
    const actual = { ...comment(), author: { ...comment().author, login: 'coderabbitai[bot]', automated: false } };
    const f = fixture(source([actual]));
    await expect(f.save(source().input, { ...actual, author: { ...actual.author, automated: true } }, 'coderabbit')).rejects.toThrow('observed native automated');
    expect((await settingsItem.getValue()).trustedReviewAccounts).toEqual([]);
  });

  it.each(['copilot', 'codex', 'future-service'])('refuses unsupported, unverified and unknown service %s', async (botId) => {
    const f = fixture();
    await expect(f.save(source().input, comment(), botId)).rejects.toThrow('not supported');
    expect((await settingsItem.getValue()).trustedReviewAccounts).toEqual([]);
  });

  it('rejects unobserved comments, malformed durable ids and external source links', async () => {
    const unseen = fixture();
    await expect(unseen.save(source().input, comment('2'), 'coderabbit')).rejects.toThrow('observed native automated');
    const malformed = comment('1', 'coderabbitai');
    await expect(fixture(source([malformed])).save(source().input, malformed, 'coderabbit')).rejects.toThrow('durable id');
    const external = { ...comment(), url: 'https://evil.example/#note_1' };
    await expect(fixture(source([external])).save(source().input, external, 'coderabbit')).rejects.toThrow('durable id');
    expect((await settingsItem.getValue()).trustedReviewAccounts).toEqual([]);
  });

  it('isolates same-name repositories, review numbers and stale head snapshots', async () => {
    const f = fixture();
    f.navigate({ ...page, repository: { ...repository, path: 'other/project' } });
    await expect(f.save(source().input, comment(), 'coderabbit')).rejects.toThrow('review changed');
    f.navigate({ ...page, number: '43' });
    await expect(f.save(source().input, comment(), 'coderabbit')).rejects.toThrow('review changed');
    f.navigate(page);
    f.snapshot({ ...source(), input: { ...source().input, subject: { ...subject, headSha: 'b'.repeat(40) } } });
    await expect(f.save(source().input, comment(), 'coderabbit')).rejects.toThrow('review changed');
    expect((await settingsItem.getValue()).trustedReviewAccounts).toEqual([]);
  });

  it('rechecks navigation after a queued write and prevents retired scripts from granting trust', async () => {
    const gate = deferred();
    const f = fixture(source(), { update: async (updater) => { await gate.promise; return settingsItem.update(updater); } });
    const saving = f.save(source().input, comment(), 'coderabbit');
    f.navigate(null);
    gate.resolve();
    await expect(saving).rejects.toThrow('review changed');
    expect(f.updated).not.toHaveBeenCalled();
    const stopped = fixture();
    stopped.retire();
    await expect(stopped.save(source().input, comment(), 'coderabbit')).rejects.toThrow('review changed');
    expect((await settingsItem.getValue()).trustedReviewAccounts).toEqual([]);
  });

  it('normalizes a Bitbucket UUID for storage while preserving the observed native source spelling', async () => {
    const repository: RepositoryIdentity = { provider: 'bitbucket', origin: 'https://bitbucket.org', path: 'workspace/repo' };
    const url = `${repository.origin}/${repository.path}/pull-requests/5`;
    const authorId = '{AABBCCDD-1234-5678-ABCD-AABBCCDDEEFF}';
    const actual = { ...comment(), anchor: 'comment-1', url: `${url}#comment-1`, author: { id: authorId, login: 'native-account', automated: true } };
    const input: ProviderReviewInput = { subject: { provider: 'bitbucket', origin: repository.origin, repository: repository.path, id: '5', headSha: sha }, threads: [] };
    const f = fixture({ ...source([actual]), input });
    f.navigate({ ...page, provider: 'bitbucket', repository, number: '5', url });
    await f.save(input, actual, 'coderabbit');
    expect(trustedReviewAccountsFor((await settingsItem.getValue()).trustedReviewAccounts, repository)[0]?.authorId).toBe('aabbccdd-1234-5678-abcd-aabbccddeeff');
    expect(actual.author.id).toBe(authorId);
  });
});

function reviewedSource(): ProviderReviewSnapshot {
  const first = comment();
  const second = { ...comment('2', '99999'), body: 'Another independent finding.' };
  return { ...source([]), input: { subject, complete: true, threads: [
    { id: 'a'.repeat(40), anchor: `discussion_${'a'.repeat(40)}`, url: first.url, path: 'first.ts', line: 5, resolved: false, outdated: false, comments: [first] },
    { id: 'b'.repeat(40), anchor: `discussion_${'b'.repeat(40)}`, url: second.url, path: 'second.ts', line: 50, resolved: false, outdated: false, comments: [second] },
  ] } };
}

function reviewedFixture(initial = reviewedSource(), storage?: ProviderReviewedStorage) {
  let active: ProviderPage | null = page;
  let observed: ProviderReviewSnapshot | null = initial;
  let retired = false;
  const services = createProviderReviewedServices({ page: () => active, snapshot: () => observed, retired: () => retired, ...(storage === undefined ? {} : { storage }) });
  const read = services.readReviewed;
  const save = services.saveReviewed;
  if (read === undefined || save === undefined) throw new Error('Reviewed services missing');
  return { read, save, navigate: (next: ProviderPage | null) => { active = next; }, snapshot: (next: ProviderReviewSnapshot | null) => { observed = next; }, retire: () => { retired = true; } };
}

describe('local reviewed source and navigation guards', () => {
  it('validates device reviewed marks against the same original sources after excluding a trusted machine note', async () => {
    const native: ProviderReviewInput = { ...reviewedSource().input, threads: reviewedSource().input.threads.map((thread) => ({ ...thread, stateKnown: true })) };
    const items = buildProviderReviewItems(native);
    const meta: GeldPrMeta = { v: META_VERSION, generatedAt: '2026-11-01T12:01:00Z', headSha: sha, producer: { kind: 'action', version: '0.1.0', ai: false }, items, bots: [], reviewers: [], fold: { comments: [], events: [] }, nativePublication: await createNativePublication(native, items) };
    const publisher: ProviderReviewComment = { ...comment('99', '77'), author: { id: '77', login: 'personal-ci-owner' }, body: renderProviderSummary(meta, native.subject) };
    const snapshot: ProviderReviewSnapshot = { ...source([]), sourceCoverage: { comments: 'complete', threads: 'complete' }, input: { ...native, threads: native.threads.map((thread, index) => index === 0 ? { ...thread, url: publisher.url, comments: [publisher, ...thread.comments] } : thread) } };
    const original = JSON.stringify(snapshot);
    const trusted = { ...DEFAULT_SETTINGS, trustedSummaryPublishers: withTrustedSummaryPublisher([], repository, publisher.author.id) };
    await settingsItem.setValue(trusted);
    const result = await readProviderPublication({ input: snapshot.input, comments: snapshot.comments, sourceCoverage: snapshot.sourceCoverage, trustedPublisherIds: ['77'] });
    expect(result.status).toBe('current');
    const item = result.items[0];
    if (item === undefined) throw new Error('Missing published native finding');
    const fingerprint = await reviewedItemFingerprint(result.input, item, result.comments);
    const f = reviewedFixture(snapshot);
    await f.save(result.input, item, fingerprint, true);
    expect(await f.read(result.input)).toEqual({ [item.id]: fingerprint });
    expect(JSON.stringify(snapshot)).toBe(original);
    const stored = JSON.stringify(await providerReviewedItemsItem.getValue());
    expect(stored).not.toContain(publisher.body);
    expect(stored).not.toContain(publisher.author.login);
    await settingsItem.setValue(DEFAULT_SETTINGS);
    expect(await f.read(result.input)).toEqual({});
    await expect(f.save(result.input, item, fingerprint, true)).rejects.toThrow(/changed|sources/);
  });

  it('persists only fingerprints in actual local storage and keeps native unresolved state unchanged', async () => {
    const snapshot = reviewedSource();
    const before = JSON.stringify(snapshot.input);
    const input = providerReviewWithTrustedAccounts(snapshot.input, snapshot.comments, DEFAULT_SETTINGS, snapshot.complete);
    const item = buildProviderReviewItems(input)[0];
    if (item === undefined) throw new Error('Missing native item');
    const fingerprint = await reviewedItemFingerprint(input, item, snapshot.comments);
    const f = reviewedFixture(snapshot);
    expect(await f.read(input)).toEqual({});
    await f.save(input, item, fingerprint, true);
    expect(await f.read(input)).toEqual({ [item.id]: fingerprint });
    const persisted = JSON.stringify(await providerReviewedItemsItem.getValue());
    expect(persisted).toContain(fingerprint);
    expect(persisted).not.toContain(comment().body);
    expect(JSON.stringify(snapshot.input)).toBe(before);
    await f.save(input, item, fingerprint, false);
    expect(await f.read(input)).toEqual({});
  });

  it('uses the latest trusted-input clustering and preserves simultaneous markers', async () => {
    const snapshot = reviewedSource();
    const trustedReviewAccounts = withTrustedReviewAccount([], repository, 'coderabbit', '12345');
    await settingsItem.patch({ trustedReviewAccounts });
    const input = providerReviewWithTrustedAccounts(snapshot.input, snapshot.comments, await settingsItem.getValue(), snapshot.complete);
    const items = buildProviderReviewItems(input);
    expect(items).toHaveLength(2);
    const f = reviewedFixture(snapshot);
    await Promise.all(items.map(async (item) => f.save(input, item, await reviewedItemFingerprint(input, item, snapshot.comments), true)));
    expect(Object.keys(await f.read(input)).sort()).toEqual(items.map((item) => item.id).sort());
    expect(snapshot.input.bots).toBeUndefined();
    expect(snapshot.input.threads.every((thread) => !thread.resolved)).toBe(true);
  });

  it('does not hydrate a marker after the native source body or thread state changes at the same head', async () => {
    const snapshot = reviewedSource();
    const item = buildProviderReviewItems(snapshot.input)[0];
    if (item === undefined) throw new Error('Missing native item');
    const fingerprint = await reviewedItemFingerprint(snapshot.input, item, snapshot.comments);
    const f = reviewedFixture(snapshot);
    await f.save(snapshot.input, item, fingerprint, true);
    const changed = { ...snapshot, input: { ...snapshot.input, threads: snapshot.input.threads.map((thread, index) => index === 0 ? { ...thread, resolved: true, comments: thread.comments.map((comment) => ({ ...comment, body: 'Edited source at the same head.' })) } : thread) } };
    f.snapshot(changed);
    expect(await f.read(changed.input)).toEqual({});
    await expect(f.save(snapshot.input, item, fingerprint, true)).rejects.toThrow('item changed');
  });

  it.each(['navigation', 'head', 'source', 'retirement'])('refuses %s changes while a local write is waiting for storage', async (change) => {
    const snapshot = reviewedSource();
    const item = buildProviderReviewItems(snapshot.input)[0];
    if (item === undefined) throw new Error('Missing native item');
    const fingerprint = await reviewedItemFingerprint(snapshot.input, item, snapshot.comments);
    const gate = deferred();
    const writing = vi.fn<(value: Readonly<Record<string, ProviderReviewedRecord>>) => Promise<void>>(async () => undefined);
    const getValue = vi.fn(async () => { await gate.promise; return {}; });
    const f = reviewedFixture(snapshot, { getValue, setValue: writing });
    const saving = f.save(snapshot.input, item, fingerprint, true);
    await vi.waitFor(() => expect(getValue).toHaveBeenCalled());
    if (change === 'navigation') f.navigate({ ...page, number: '43' });
    if (change === 'head') f.snapshot({ ...snapshot, input: { ...snapshot.input, subject: { ...subject, headSha: 'b'.repeat(40) } } });
    if (change === 'source') f.snapshot({ ...snapshot, input: { ...snapshot.input, threads: snapshot.input.threads.map((thread) => ({ ...thread, outdated: true })) } });
    if (change === 'retirement') f.retire();
    gate.resolve();
    await expect(saving).rejects.toThrow(/changed|sources/);
    expect(writing).not.toHaveBeenCalled();
  });
});

describe('provider runtime cache routing', () => {
  it('clears the active controller cache while retired copies leave the response to their replacement', async () => {
    vi.spyOn(ProviderController.prototype, 'start').mockImplementation(() => undefined);
    const clear = vi.spyOn(ProviderController.prototype, 'clearDiffCache').mockResolvedValue(undefined);
    const adapter: ProviderAdapter = { id: 'gitlab', describe: () => null, readDiff: () => null, headerTargets: () => [], listRows: () => [], fetchDiff: async () => ({ files: [], complete: true, revision: sha }) };
    const first = new ContentScriptContext('provider-first', { noScriptStartedPostMessage: true });
    const second = new ContentScriptContext('provider-second', { noScriptStartedPostMessage: true });
    try {
      await startProvider(first, adapter);
      const oldListener = vi.mocked(browser.runtime.onMessage.addListener).mock.calls.at(-1)?.[0];
      await startProvider(second, adapter);
      const activeListener = vi.mocked(browser.runtime.onMessage.addListener).mock.calls.at(-1)?.[0];
      if (oldListener === undefined || activeListener === undefined) throw new Error('Runtime listener missing');
      const oldResponse = vi.fn();
      const activeResponse = vi.fn();
      expect(oldListener({ type: 'geld:clear-diff-cache' }, {}, oldResponse)).toBeUndefined();
      expect(activeListener({ type: 'geld:clear-diff-cache' }, {}, activeResponse)).toBe(true);
      await vi.waitFor(() => expect(activeResponse).toHaveBeenCalledWith(true));
      expect(clear).toHaveBeenCalledTimes(1);
      expect(oldResponse).not.toHaveBeenCalled();
    } finally { first.notifyInvalidated(); second.notifyInvalidated(); }
  });
});

describe('provider runtime whitespace link custody', () => {
  const diff = `${url}/diffs`;
  const adapter: ProviderAdapter = { id: 'gitlab', describe: () => null, readDiff: () => null, headerTargets: () => [], listRows: () => [], fetchDiff: async () => ({ files: [], complete: true, revision: sha }) };
  const prepare = (link: HTMLAnchorElement, type: string): void => { link.dispatchEvent(new Event(type, { bubbles: true })); };
  const makeLink = (href = `${diff}?diff_id=812#note_12`): HTMLAnchorElement => {
    const link = document.createElement('a');
    link.setAttribute('href', href);
    document.body.append(link);
    return link;
  };

  it.each(['pointerover', 'focusin', 'click'])('keeps a saved URL opt-out after a previously prepared link receives %s', async (type) => {
    vi.spyOn(ProviderController.prototype, 'start').mockImplementation(() => undefined);
    vi.spyOn(whitespaceOptOutsItem, 'getValue').mockResolvedValue({});
    const save = vi.spyOn(whitespaceOptOutsItem, 'setValue');
    await settingsItem.setValue({ ...DEFAULT_SETTINGS, hideWhitespace: true });
    document.body.replaceChildren();
    window.location.href = `${diff}?w=1`;
    const ctx = new ContentScriptContext(`provider-links-${type}`, { noScriptStartedPostMessage: true });
    try {
      await startProvider(ctx, adapter);
      const link = makeLink();
      const original = link.getAttribute('href');
      prepare(link, type);
      expect(new URL(link.href).searchParams.get('w')).toBe('1');
      window.history.replaceState(null, '', `${diff}?w=0`);
      window.dispatchEvent(new Event('wxt:locationchange'));
      await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
      expect(Object.keys(save.mock.calls[0]?.[0] ?? {})).toHaveLength(1);
      prepare(link, type);
      expect(link.href).toBe(`${diff}?diff_id=812&w=0#note_12`);
      window.history.replaceState(null, '', link.href);
      window.dispatchEvent(new Event('wxt:locationchange'));
      await Promise.resolve();
      expect(save).toHaveBeenCalledTimes(1);
      ctx.notifyInvalidated();expect(link.getAttribute('href')).toBe(original);
    } finally { ctx.notifyInvalidated(); }
  });

  it('connects qualified native intent to storage and link custody without turning the unchanged URL into opt-in', async () => {
    vi.spyOn(ProviderController.prototype, 'start').mockImplementation(() => undefined);
    vi.spyOn(ProviderController.prototype, 'updateSettings').mockImplementation(() => undefined);
    vi.spyOn(whitespaceOptOutsItem, 'getValue').mockResolvedValue({});
    const save = vi.spyOn(whitespaceOptOutsItem, 'setValue');
    const watchers: Array<(settings: GeldSettings) => void> = [];
    vi.spyOn(settingsItem, 'watch').mockImplementation((callback) => { watchers.push(callback);return () => undefined; });
    const enabled = { ...DEFAULT_SETTINGS, hideWhitespace: true };await settingsItem.setValue(enabled);
    document.body.replaceChildren();window.location.href = `${diff}?w=1`;
    const choices: Array<(url: URL, show: boolean) => void> = [];
    const nativeAdapter: ProviderAdapter = { ...adapter, createNativeView: (_doc, _changed, record) => {
      choices.push(record);return { update: () => undefined, suspended: () => false, sourceUnavailable: () => false, stop: () => undefined };
    } };
    const ctx = new ContentScriptContext('provider-native-intent', { noScriptStartedPostMessage: true });
    try {
      await startProvider(ctx, nativeAdapter);const link = makeLink();const original = link.getAttribute('href');prepare(link, 'pointerover');
      expect(new URL(link.href).searchParams.get('w')).toBe('1');
      // Adapter protocol callback only. Native trusted-event qualification runs in its own DOM tests.
      const record = choices[0];if (record === undefined) throw new Error('Missing native view callback');
      record(new URL(window.location.href), true);await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
      expect(link.getAttribute('href')).toBe(original);watchers[0]?.(structuredClone(enabled));
      prepare(link, 'focusin');expect(new URL(link.href).searchParams.get('w')).toBe('0');expect(save).toHaveBeenCalledTimes(1);
      ctx.notifyInvalidated();expect(link.getAttribute('href')).toBe(original);
    } finally { ctx.notifyInvalidated(); }
  });

  it('restores only exact owned hrefs when settings disable or runtime retirement ends custody', async () => {
    vi.spyOn(ProviderController.prototype, 'start').mockImplementation(() => undefined);
    vi.spyOn(ProviderController.prototype, 'updateSettings').mockImplementation(() => undefined);
    vi.spyOn(whitespaceOptOutsItem, 'getValue').mockResolvedValue({});
    const watchers: Array<(settings: GeldSettings) => void> = [];
    vi.spyOn(settingsItem, 'watch').mockImplementation((callback) => { watchers.push(callback); return () => undefined; });
    const enabled = { ...DEFAULT_SETTINGS, hideWhitespace: true };
    await settingsItem.setValue(enabled);
    document.body.replaceChildren();
    window.location.href = `${diff}?w=1`;
    const ctx = new ContentScriptContext('provider-link-retirement', { noScriptStartedPostMessage: true });
    try {
      await startProvider(ctx, adapter);
      const unchanged = makeLink();
      const changed = makeLink();
      const native = makeLink(`${diff}?w=1&diff_id=913#note_14`);
      prepare(unchanged, 'pointerover');
      prepare(changed, 'focusin');
      prepare(native, 'click');
      const concurrent = `${diff}?w=1&diff_id=999#native-change`;
      changed.setAttribute('href', concurrent);
      watchers[0]?.({ ...enabled, enabled: false });
      expect(unchanged.href).toBe(`${diff}?diff_id=812#note_12`);
      expect(changed.getAttribute('href')).toBe(concurrent);
      expect(native.href).toBe(`${diff}?w=1&diff_id=913#note_14`);
      watchers[0]?.(enabled);
      prepare(unchanged, 'focusin');
      expect(new URL(unchanged.href).searchParams.get('w')).toBe('1');
      ctx.notifyInvalidated();
      expect(unchanged.href).toBe(`${diff}?diff_id=812#note_12`);
      expect(changed.getAttribute('href')).toBe(concurrent);
      expect(native.href).toBe(`${diff}?w=1&diff_id=913#note_14`);
      prepare(unchanged, 'click');
      expect(unchanged.href).toBe(`${diff}?diff_id=812#note_12`);
    } finally { ctx.notifyInvalidated(); }
  });

  it('releases a surviving native relative href on an actual SPA route event before preparing the new destination', async () => {
    vi.spyOn(ProviderController.prototype, 'start').mockImplementation(() => undefined);
    vi.spyOn(whitespaceOptOutsItem, 'getValue').mockResolvedValue({});
    await settingsItem.setValue({ ...DEFAULT_SETTINGS, hideWhitespace: true });
    document.body.replaceChildren();
    window.location.href = `${diff}?w=1`;
    const ctx = new ContentScriptContext('provider-link-route', { noScriptStartedPostMessage: true });
    try {
      await startProvider(ctx, adapter);
      const original = '?diff_id=812#note_12';
      const link = makeLink(original);
      prepare(link, 'pointerover');
      expect(new URL(link.href).pathname).toContain('/42/');
      window.history.replaceState(null, '', `${diff.replace('/42/', '/43/')}?w=1`);
      window.dispatchEvent(new Event('wxt:locationchange'));
      expect(link.getAttribute('href')).toBe(original);
      expect(new URL(link.href).pathname).toContain('/43/');
      prepare(link, 'focusin');
      expect(new URL(link.href).pathname).toContain('/43/');
      expect(new URL(link.href).searchParams.get('diff_id')).toBe('812');
      expect(new URL(link.href).searchParams.get('w')).toBe('1');
      expect(new URL(link.href).hash).toBe('#note_12');
    } finally { ctx.notifyInvalidated(); }
  });
});
