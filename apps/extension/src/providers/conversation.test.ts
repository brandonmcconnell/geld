// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, withTrustedReviewAccount } from '@geld/core';
import type { GeldSettings, RepositoryIdentity } from '@geld/core';
import type { ProviderReviewComment, ProviderReviewInput } from '@geld/review';
import type { AiRunRecord } from '../lib/local-state';
import type { AiCompleteRequest, AiEvaluateRequest } from '../lib/messages';
import { ProviderConversation, providerReviewWithTrustedAccounts } from './conversation';
import type { ProviderConversationServices } from './conversation';
import type { ProviderAdapter, ProviderReviewPage, ProviderReviewSnapshot } from './types';

vi.mock('wxt/browser', () => ({ browser: { runtime: { sendMessage: vi.fn(() => { throw new Error('Unexpected real transport'); }) } } }));
vi.mock('wxt/utils/storage', () => ({ storage: { defineItem: () => ({ getValue: async () => ({}), setValue: async () => undefined }) } }));

const repository: RepositoryIdentity = { provider: 'gitlab', origin: 'https://gitlab.com', path: 'group/subgroup/project' };
const url = `${repository.origin}/${repository.path}/-/merge_requests/42`;
const sha = 'a'.repeat(40);
const page: ProviderReviewPage = { provider: 'gitlab', repository, number: '42', kind: 'overview', url, diffPageUrl: `${url}/diffs`, diffUrl: `${url}.diff`, headSha: sha, version: sha };
const subject = { provider: repository.provider, origin: repository.origin, repository: repository.path, id: '42', headSha: sha };

function comment(body = 'The credentials can leak from the shared cache.'): ProviderReviewComment {
  return { id: '1', anchor: 'note_1', url: `${url}#note_1`, body, author: { id: '12345', login: 'project_123_review_account', automated: true }, createdAt: '2026-11-01T12:00:00Z' };
}

function snapshot(comments: readonly ProviderReviewComment[] = []): ProviderReviewSnapshot {
  const first = comment();
  return { input: { subject, closed: false, threads: [{ id: 'a'.repeat(40), anchor: `discussion_${'a'.repeat(40)}`, url: first.url, path: 'cache.ts', line: 5, resolved: false, outdated: false, comments: [first] }], checks: [], reviewers: [] }, comments, events: [], complete: true, unavailable: [], approvalsRequired: null, approvalsLeft: null, actions: [] };
}

function aiResponse(message: AiCompleteRequest | AiEvaluateRequest): unknown {
  if (message.type === 'geld:ai-evaluate') return { ok: false, reason: 'Unexpected decision request' };
  if (message.schemaName === 'geld_summary') return { ok: true, model: 'writer', text: '{"tldr":"Credential handling needs attention."}' };
  const value: unknown = JSON.parse(message.messages[1]?.content ?? '{}');
  const entries: unknown = typeof value === 'object' && value !== null ? Reflect.get(value, 'items') : null;
  const items = Array.isArray(entries) ? entries.flatMap((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const id: unknown = Reflect.get(entry, 'id');
    return typeof id === 'string' ? [{ id, title: 'Isolate the credential cache' }] : [];
  }) : [];
  return { ok: true, model: 'writer', text: JSON.stringify({ items }) };
}

const cleanup: (() => void)[] = [];
afterEach(() => { for (const stop of cleanup.splice(0)) stop(); document.body.replaceChildren(); });

function fixture(source = snapshot(), services: ProviderConversationServices = {}, overrides: Partial<GeldSettings> = {}, adapterOverrides: Partial<ProviderAdapter> = {}) {
  const host = document.createElement('main');
  document.body.append(host);
  let currentPage: ProviderReviewPage | null = page;
  let currentSettings: GeldSettings = { ...DEFAULT_SETTINGS, prOverview: true, aiEnabled: true, aiModel: 'writer', aiBaseUrl: 'https://gateway.example/v1', aiJev: false, ...overrides };
  let active = true;
  let runs: Readonly<Record<string, AiRunRecord>> = {};
  const send = vi.fn(async (message: AiCompleteRequest | AiEvaluateRequest): Promise<unknown> => aiResponse(message));
  const fetchReview = vi.fn(async () => source);
  const adapter: ProviderAdapter = { id: 'gitlab', describe: () => currentPage, readDiff: () => null, headerTargets: () => [], listRows: () => [], fetchDiff: async () => ({ files: [], revision: sha, complete: true }), reviewHost: () => host, fetchReview, ...adapterOverrides };
  const changed = vi.fn(() => { queueMicrotask(() => { if (active) conversation.apply(currentPage, currentSettings); }); });
  const conversation = new ProviderConversation(adapter, changed, { ...services, aiDependencies: { readKey: async () => 'device-only-key', permission: async () => null, readRuns: async () => runs, writeRuns: async (next) => { runs = next; }, jevRoute: async () => null, send, now: () => '2026-11-01T13:00:00Z', ...services.aiDependencies } });
  cleanup.push(() => { active = false; conversation.clear(); });
  conversation.apply(currentPage, currentSettings);
  return { host, conversation, send, changed, fetchReview, runs: () => runs,
    apply: (nextPage: ProviderReviewPage | null = currentPage, nextSettings = currentSettings): void => { currentPage = nextPage; currentSettings = nextSettings; conversation.apply(currentPage, currentSettings); },
  };
}

describe('provider conversation integrations', () => {
  it('loads without spending and runs AI only after the triage button is clicked', async () => {
    const trustedReviewAccounts = withTrustedReviewAccount([], repository, 'greptile', '12345');
    const f = fixture(snapshot(), {}, { trustedReviewAccounts });
    await vi.waitFor(() => expect(f.host.querySelector('[data-geld-ai-run]')).not.toBeNull());
    expect(f.send).not.toHaveBeenCalled();
    expect(f.host.querySelector('.geld-provider-review__body')?.textContent).toBe(comment().body);
    f.host.querySelector<HTMLButtonElement>('[data-geld-ai-run]')?.click();
    await vi.waitFor(() => expect(f.host.querySelector('[data-geld-ai-summary]')?.textContent).toContain('Credential handling needs attention.'));
    expect(f.send).toHaveBeenCalledTimes(2);
    expect(f.host.querySelector('[data-geld-item] > summary')?.textContent).toContain('Isolate the credential cache');
    expect(f.host.querySelector('.geld-provider-review__body')?.textContent).toBe(comment().body);
    expect(f.fetchReview).toHaveBeenCalledTimes(1);
  });

  it('saves a native identity only after selection and confirmation, then uses the saved settings', async () => {
    const topLevel = { ...comment('**Actionable comments posted: 0**'), id: '2', anchor: 'note_2', url: `${url}#note_2` };
    const source = { ...snapshot([topLevel]), input: { ...snapshot().input, threads: [] } };
    const saveTrustedBot = vi.fn(async (_input: ProviderReviewInput, _comment: ProviderReviewComment, _botId: string) => undefined);
    const f = fixture(source, { saveTrustedBot });
    await vi.waitFor(() => expect(f.host.querySelector('.geld-provider-reviewer-identity')).not.toBeNull());
    expect(saveTrustedBot).not.toHaveBeenCalled();
    const choices = [...f.host.querySelectorAll<HTMLButtonElement>('.geld-provider-reviewer-identity button')];
    expect(choices.some((button) => button.textContent?.includes('Copilot'))).toBe(false);
    choices.find((button) => button.textContent === 'CodeRabbit')?.click();
    expect(saveTrustedBot).not.toHaveBeenCalled();
    choices.find((button) => button.textContent === 'Trust')?.click();
    await vi.waitFor(() => expect(saveTrustedBot).toHaveBeenCalledWith(expect.objectContaining({ complete: true }), topLevel, 'coderabbit'));
    f.apply(page, { ...DEFAULT_SETTINGS, prOverview: true, trustedReviewAccounts: withTrustedReviewAccount([], repository, 'coderabbit', '12345') });
    expect(f.host.querySelector('.geld-provider-reviewer-identity')).toBeNull();
    expect(f.host.querySelector('[data-geld-review-bot="coderabbit"]')?.textContent).toContain('No findings');
    expect(f.send).not.toHaveBeenCalled();
  });

  it('shows configuration failures without calling the gateway', async () => {
    const f = fixture(snapshot(), { aiDependencies: { readKey: async () => '' } });
    await vi.waitFor(() => expect(f.host.querySelector('[data-geld-ai-run]')).not.toBeNull());
    f.host.querySelector<HTMLButtonElement>('[data-geld-ai-run]')?.click();
    await vi.waitFor(() => expect(f.host.querySelector('[role="alert"]')?.textContent).toContain('on this device'));
    expect(f.send).not.toHaveBeenCalled();
  });

  it('does not hydrate AI while disabled and hides cached output until it is enabled again', async () => {
    const readRuns = vi.fn(async () => ({}));
    const disabled = fixture(snapshot(), { aiDependencies: { readRuns } }, { aiEnabled: false });
    await vi.waitFor(() => expect(disabled.host.querySelector('.geld-provider-review')).not.toBeNull());
    expect(readRuns).not.toHaveBeenCalled();
    expect(disabled.host.querySelector('[data-geld-ai-run]')).toBeNull();
    const trustedReviewAccounts = withTrustedReviewAccount([], repository, 'greptile', '12345');
    const f = fixture(snapshot(), {}, { trustedReviewAccounts });
    await vi.waitFor(() => expect(f.host.querySelector('[data-geld-ai-run]')).not.toBeNull());
    f.host.querySelector<HTMLButtonElement>('[data-geld-ai-run]')?.click();
    await vi.waitFor(() => expect(f.host.querySelector('[data-geld-ai-summary]')).not.toBeNull());
    const activeSettings = { ...DEFAULT_SETTINGS, prOverview: true, aiEnabled: true, aiModel: 'writer', aiBaseUrl: 'https://gateway.example/v1', aiJev: false, trustedReviewAccounts };
    f.apply(page, { ...activeSettings, aiEnabled: false });
    expect(f.host.querySelector('[data-geld-ai-summary]')).toBeNull();
    expect(f.host.querySelector('[data-geld-item] > summary')?.textContent).toContain('The credentials can leak');
    f.apply(page, activeSettings);
    await vi.waitFor(() => expect(f.host.querySelector('[data-geld-ai-summary]')).not.toBeNull());
    expect(f.send).toHaveBeenCalledTimes(2);
  });

  it('clears the previous review and cannot adopt a late AI result after navigation', async () => {
    let finish: (value: unknown) => void = () => undefined;
    const send = vi.fn((message: AiCompleteRequest | AiEvaluateRequest) => new Promise<unknown>((resolve) => { finish = () => resolve(aiResponse(message)); }));
    const f = fixture(snapshot(), { aiDependencies: { send } }, { trustedReviewAccounts: withTrustedReviewAccount([], repository, 'greptile', '12345') });
    await vi.waitFor(() => expect(f.host.querySelector('[data-geld-ai-run]')).not.toBeNull());
    f.host.querySelector<HTMLButtonElement>('[data-geld-ai-run]')?.click();
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    f.apply(null);
    expect(f.host.querySelector('.geld-provider-review')).toBeNull();
    finish(null);
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(f.runs()).toEqual({});
    expect(send).toHaveBeenCalledTimes(1);
    const changed = f.changed.mock.calls.length;
    f.apply(null);
    f.apply(null);
    expect(f.changed).toHaveBeenCalledTimes(changed);
  });

  it('derives only supported exact repository bindings and keeps observed Bitbucket UUID spelling', () => {
    const source = snapshot();
    const trusted = { ...DEFAULT_SETTINGS, trustedReviewAccounts: withTrustedReviewAccount([], repository, 'coderabbit', '12345') };
    const bound = providerReviewWithTrustedAccounts(source.input, [], trusted, false);
    expect(bound.bots).toEqual([{ id: 'coderabbit', authorId: '12345', login: comment().author.login }]);
    expect(bound.complete).toBe(false);
    expect(bound.closed).toBe(false);
    expect(providerReviewWithTrustedAccounts(source.input, [], { ...trusted, trustedReviewAccounts: withTrustedReviewAccount([], { ...repository, path: 'other/project' }, 'coderabbit', '12345') }, true).bots).toEqual([]);
    expect(providerReviewWithTrustedAccounts(source.input, [], { ...trusted, trustedReviewAccounts: withTrustedReviewAccount([], repository, 'copilot', '12345') }, true).bots).toEqual([]);
    const nativeId = '{ABCDEFAB-1234-5678-90AB-ABCDEFABCDEF}';
    const bb: ProviderReviewInput = { subject: { ...subject, provider: 'bitbucket', origin: 'https://bitbucket.org', repository: 'workspace/repo' }, threads: [], checks: [{ authorId: nativeId, name: 'Check', sha, status: 'completed', conclusion: 'success' }] };
    const bbSettings = { ...DEFAULT_SETTINGS, trustedReviewAccounts: withTrustedReviewAccount([], { provider: 'bitbucket', origin: 'https://bitbucket.org', path: 'workspace/repo' }, 'bugbot', nativeId.toLowerCase()) };
    expect(providerReviewWithTrustedAccounts(bb, [], bbSettings, true).bots?.[0]?.authorId).toBe(nativeId);
  });

  it('compacts only represented eligible native roots, preserves framework children, and restores settings and remounts', async () => {
    let native = document.createElement('article');
    native.id = 'note_1';
    const originalButton = document.createElement('button');
    const activated = vi.fn();
    originalButton.addEventListener('click', activated);
    native.append(originalButton);
    const mixed = document.createElement('article');
    mixed.id = 'note_9';
    const composer = document.createElement('article');
    composer.append(document.createElement('textarea'));
    document.body.append(native, mixed, composer);
    const f = fixture(snapshot(), {}, { aiEnabled: false }, { conversationRoots: () => [{ root: native, anchors: ['note_1'], kind: 'comment' }, { root: mixed, anchors: ['note_1', 'note_9'], kind: 'comment' }, { root: composer, anchors: ['note_1'], kind: 'comment' }] });
    await vi.waitFor(() => expect(native.hasAttribute('data-geld-provider-compact-hidden')).toBe(true));
    expect(mixed.hasAttribute('data-geld-provider-compact-hidden')).toBe(false);
    expect(composer.hasAttribute('data-geld-provider-compact-hidden')).toBe(false);
    expect(native.firstElementChild).toBe(originalButton);
    originalButton.click();
    expect(activated).toHaveBeenCalledTimes(1);
    document.querySelector<HTMLButtonElement>('.geld-provider-original button')?.click();
    expect(native.hasAttribute('data-geld-provider-compact-hidden')).toBe(false);
    const replacement = document.createElement('article');
    replacement.id = native.id;
    native.replaceWith(replacement);
    native = replacement;
    f.apply();
    expect(native.hasAttribute('data-geld-provider-compact-hidden')).toBe(false);
    expect(document.querySelectorAll('.geld-provider-original')).toHaveLength(1);
    f.apply(page, { ...DEFAULT_SETTINGS, aiEnabled: false, compactTimeline: 'off' });
    expect(document.querySelector('.geld-provider-original')).toBeNull();
    expect(native.hasAttribute('data-geld-provider-compact-hidden')).toBe(false);
  });

  it('reveals the native source before activating its exposed thread controls', async () => {
    const native = document.createElement('article'); native.id = 'note_1'; document.body.append(native);
    const action = vi.fn(async () => { expect(native.hasAttribute('data-geld-provider-compact-hidden')).toBe(false); return true; });
    const f = fixture({ ...snapshot(), sourceActions: () => [{ kind: 'resolve', label: 'Resolve natively', available: true, activate: action }] }, {}, { aiEnabled: false }, { conversationRoots: () => [{ root: native, anchors: ['note_1'], kind: 'comment' }] });
    await vi.waitFor(() => expect(native.hasAttribute('data-geld-provider-compact-hidden')).toBe(true));
    [...f.host.querySelectorAll<HTMLButtonElement>('[data-geld-source="note_1"] button')].find((button) => button.textContent === 'Resolve natively')?.click();
    await vi.waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(native.hasAttribute('data-geld-provider-compact-hidden')).toBe(false);
  });

  it('keeps push/state activity visible and only folds explicitly low-signal represented activity', async () => {
    const roots = ['99', '100', '101'].map((id) => { const root = document.createElement('article'); root.id = `note_${id}`; document.body.append(root); return root; });
    const source: ProviderReviewSnapshot = { ...snapshot(), events: roots.map((root, index) => ({ id: root.id, url: `${url}#${root.id}`, author: comment().author, createdAt: comment().createdAt, body: 'Native activity', kind: index === 0 ? 'activity' : index === 1 ? 'push' : 'state', lowSignal: true })) };
    fixture(source, {}, { aiEnabled: false }, { conversationRoots: () => roots.map((root) => ({ root, anchors: [root.id], kind: 'activity' })) });
    await vi.waitFor(() => expect(roots[0]?.hasAttribute('data-geld-provider-compact-hidden')).toBe(true));
    expect(roots[1]?.hasAttribute('data-geld-provider-compact-hidden')).toBe(false);
    expect(roots[2]?.hasAttribute('data-geld-provider-compact-hidden')).toBe(false);
  });

  it('collapses the native description after its first paragraph only in minimal mode and restores every node', async () => {
    const description = document.createElement('div');
    description.innerHTML = '<h2>Description</h2><p>First native paragraph.</p><section><p>More native content.</p></section>';
    document.body.append(description);
    const heading = description.firstElementChild;
    const first = description.querySelector('p');
    const more = description.querySelector('section');
    const f = fixture(snapshot(), {}, { aiEnabled: false, compactTimeline: 'compact', collapseDescription: true }, { descriptionHost: () => description });
    await vi.waitFor(() => expect(f.host.querySelector('.geld-provider-review')).not.toBeNull());
    expect(more?.hasAttribute('data-geld-provider-description-hidden')).toBe(false);
    f.apply(page, { ...DEFAULT_SETTINGS, aiEnabled: false, compactTimeline: 'minimal', collapseDescription: true });
    expect(more?.hasAttribute('data-geld-provider-description-hidden')).toBe(true);
    expect(first?.hasAttribute('data-geld-provider-description-hidden')).toBe(false);
    expect(description.firstElementChild).toBe(heading);
    document.querySelector<HTMLButtonElement>('.geld-provider-description-toggle')?.click();
    expect(more?.hasAttribute('data-geld-provider-description-hidden')).toBe(false);
    expect(document.querySelector('.geld-provider-description-toggle')?.getAttribute('aria-expanded')).toBe('true');
    f.apply(page, { ...DEFAULT_SETTINGS, aiEnabled: false, compactTimeline: 'off', collapseDescription: true });
    expect(document.querySelector('.geld-provider-description-toggle')).toBeNull();
    expect(description.querySelector('[data-geld-provider-description-hidden]')).toBeNull();
    expect(description.firstElementChild).toBe(heading);
  });
});
