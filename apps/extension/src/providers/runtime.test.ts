// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { ContentScriptContext } from 'wxt/utils/content-script-context';
import { DEFAULT_SETTINGS, trustedReviewAccountsFor } from '@geld/core';
import type { GeldSettings, RepositoryIdentity } from '@geld/core';
import type { ProviderReviewComment, ProviderReviewInput } from '@geld/review';
import { settingsItem } from '../lib/storage';
import { createProviderBotTrust, startProvider } from './runtime';
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

beforeEach(async () => { await settingsItem.setValue(DEFAULT_SETTINGS); });
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
