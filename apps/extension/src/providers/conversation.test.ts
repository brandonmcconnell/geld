// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, withTrustedReviewAccount } from '@geld/core';
import type { GeldSettings, RepositoryIdentity } from '@geld/core';
import { buildProviderReviewItems } from '@geld/review';
import type { ProviderReviewComment, ProviderReviewInput } from '@geld/review';
import type { AiRunRecord } from '../lib/local-state';
import type { AiCompleteRequest, AiEvaluateRequest } from '../lib/messages';
import { ProviderConversation, providerReviewWithTrustedAccounts, reviewedItemFingerprint } from './conversation';
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
  it('refreshes live native requirement facts without another review request or inferred approval totals', async () => {
    let passed = true;
    const source: ProviderReviewSnapshot = { ...snapshot(), get requirements(): NonNullable<ProviderReviewSnapshot['requirements']> { return [{ id: 'native-minimum-approvals', label: 'Minimum approvals', state: passed ? 'passed' : 'unknown' }]; } };
    const f = fixture(source, {}, { aiEnabled: false });
    await vi.waitFor(() => expect(f.host.querySelector('[data-geld-review-key="requirements"]')?.textContent).toContain('Passed'));
    expect(f.fetchReview).toHaveBeenCalledOnce();
    passed = false;
    f.apply();
    expect(f.host.querySelector('[data-geld-review-key="requirements"]')?.textContent).toContain('Unknown');
    expect(f.fetchReview).toHaveBeenCalledOnce();
    expect(f.host.textContent).not.toMatch(/\d+\/\d+ approvals/);
  });

  it('uses a provider refresh cadence without polling anonymous review sources every minute', async () => {
    vi.useFakeTimers();
    try {
      const f = fixture(snapshot(), {}, { aiEnabled: false }, { reviewRefreshMs: () => 30 * 60_000 });
      await vi.advanceTimersByTimeAsync(0);
      expect(f.fetchReview).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(60_000);
      f.apply();
      await vi.advanceTimersByTimeAsync(0);
      expect(f.fetchReview).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(29 * 60_000);
      f.apply();
      await vi.advanceTimersByTimeAsync(0);
      expect(f.fetchReview).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });

  it('keeps a long provider cooldown after a review fetch fails', async () => {
    vi.useFakeTimers();
    try {
      const fetchReview = vi.fn<NonNullable<ProviderAdapter['fetchReview']>>()
        .mockRejectedValueOnce(Object.assign(new Error('Rate limited'), { retryAfterMs: 60 * 60_000 }))
        .mockResolvedValue(snapshot());
      const f = fixture(snapshot(), {}, { aiEnabled: false }, { fetchReview });
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(30 * 60_000);
      f.apply();
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchReview).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(30 * 60_000 + 2000);
      f.apply();
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchReview).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });

  it('passes verified native author presentation through without replacing original source links', async () => {
    const source = { ...snapshot(), authorPresentation: () => ({ authorId: comment().author.id, displayName: 'Native reviewer', profileUrl: 'https://gitlab.com/native-reviewer', avatar: { src: 'https://gitlab.com/uploads/avatar.png', width: 24, height: 24, borderRadius: '50%' }, badges: [{ label: 'Maintainer', className: 'gl-badge' }] }) };
    const f = fixture(source, {}, { aiEnabled: false });
    await vi.waitFor(() => expect(f.host.querySelector('[data-geld-source="note_1"] .geld-provider-review__byline')?.textContent).toContain('Native reviewer'));
    expect(f.host.querySelector('[data-geld-source="note_1"] .geld-provider-review__byline')?.textContent).toContain('Maintainer');
    expect(f.host.querySelector<HTMLImageElement>('[data-geld-source="note_1"] img')?.style.width).toBe('24px');
    expect(f.host.querySelector('[data-geld-source="note_1"] a[href$="#note_1"]')).not.toBeNull();
  });

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

  it('reveals an existing native source across review tabs while preserving modified link navigation', async () => {
    const previous = window.location.href;
    window.location.href = url;
    try {
      const native = document.createElement('article');
      native.id = 'note_1';
      document.body.append(native);
      const bounds = [new DOMRect(0, 10, 100, 20)];
      vi.spyOn(native, 'getClientRects').mockReturnValue(Object.assign(bounds, { item: (index: number) => bounds[index] ?? null }));
      const scroll = vi.spyOn(native, 'scrollIntoView').mockImplementation(() => undefined);
      const original = snapshot();
      const source = { ...original, input: { ...original.input, threads: original.input.threads.map((thread) => ({ ...thread, comments: thread.comments.map((entry) => ({ ...entry, url: `${url}/diffs#note_1` })) })) } };
      const f = fixture(source, {}, { aiEnabled: false }, { describe: (target) => target.origin === repository.origin && [new URL(url).pathname, new URL(`${url}/diffs`).pathname].includes(target.pathname) ? { ...page, kind: target.pathname.endsWith('/diffs') ? 'diff' : 'overview' } : null, conversationRoots: () => [{ root: native, anchors: ['note_1'], kind: 'comment' }] });
      await vi.waitFor(() => expect(native.hasAttribute('data-geld-provider-compact-hidden')).toBe(true));
      const anchor = f.host.querySelector<HTMLAnchorElement>('[data-geld-source="note_1"] a[href$="/diffs#note_1"]');
      if (anchor === null) throw new Error('Missing native source link.');
      const modified = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
      anchor.dispatchEvent(modified);
      expect(modified.defaultPrevented).toBe(false);
      expect(scroll).not.toHaveBeenCalled();
      window.location.href = url;
      const click = new MouseEvent('click', { bubbles: true, cancelable: true });
      anchor.dispatchEvent(click);
      expect(click.defaultPrevented).toBe(true);
      expect(native.hasAttribute('data-geld-provider-compact-hidden')).toBe(false);
      expect(scroll).toHaveBeenCalledTimes(1);
    } finally { window.location.href = previous; }
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

  it('persists an explicit local review mark and restores it on reload without changing native state', async () => {
    let saved: Readonly<Record<string, string>> = {};
    const source = snapshot();
    const saveReviewed = vi.fn<NonNullable<ProviderConversationServices['saveReviewed']>>(async (_input, item, fingerprint, reviewed) => {
      const next = { ...saved };
      if (reviewed) next[item.id] = fingerprint; else delete next[item.id];
      saved = next;
    });
    const services = { readReviewed: async () => saved, saveReviewed };
    const f = fixture(source, services, { aiEnabled: false });
    await vi.waitFor(() => expect(f.host.querySelector('[data-geld-local-reviewed]')).not.toBeNull());
    expect(saveReviewed).not.toHaveBeenCalled();
    f.host.querySelector<HTMLButtonElement>('[data-geld-local-reviewed]')?.click();
    await vi.waitFor(() => expect(f.host.querySelector('[data-geld-review-group="done"]')).not.toBeNull());
    expect(saveReviewed).toHaveBeenCalledTimes(1);
    expect(Object.values(saved)[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(f.host.querySelector('[data-geld-local-review-notice]')?.textContent).toContain('Native status: Open');
    expect(source.input.threads[0]?.resolved).toBe(false);
    expect(f.send).not.toHaveBeenCalled();
    const reloaded = fixture(source, services, { aiEnabled: false });
    await vi.waitFor(() => expect(reloaded.host.querySelector('[data-geld-local-reviewed]')?.getAttribute('aria-pressed')).toBe('true'));
    reloaded.host.querySelector<HTMLButtonElement>('[data-geld-local-reviewed]')?.click();
    await vi.waitFor(() => expect(reloaded.host.querySelector('[data-geld-local-reviewed]')?.getAttribute('aria-pressed')).toBe('false'));
    expect(saved).toEqual({});
    expect(reloaded.host.querySelector('[data-geld-review-group="open"]')).not.toBeNull();
  });

  it('rejects stored marks for an edited source or new head even if the storage reader returns an old fingerprint', async () => {
    const source = snapshot();
    const [original] = buildProviderReviewItems(source.input);
    if (original === undefined) throw new Error('Missing original item.');
    const fingerprint = await reviewedItemFingerprint(source.input, original, []);
    const services = { readReviewed: async () => ({ [original.id]: fingerprint }), saveReviewed: vi.fn(async () => undefined) };
    const edited = { ...source, input: { ...source.input, threads: source.input.threads.map((thread) => ({ ...thread, comments: thread.comments.map((entry) => ({ ...entry, body: 'An edited finding at the same native anchor.', updatedAt: '2026-11-01T14:00:00Z' })) })) } };
    const pushed = { ...source, input: { ...source.input, subject: { ...source.input.subject, headSha: 'b'.repeat(40) } } };
    for (const changed of [edited, pushed]) {
      const f = fixture(changed, services, { aiEnabled: false });
      await vi.waitFor(() => expect(f.host.querySelector('[data-geld-local-reviewed]')).not.toBeNull());
      expect(f.host.querySelector('[data-geld-local-reviewed]')?.getAttribute('aria-pressed')).toBe('false');
      expect(f.host.querySelector('[data-geld-review-group="done"]')).toBeNull();
    }
    expect(services.saveReviewed).not.toHaveBeenCalled();
  });

  it('does not adopt a late local mark or load after navigation', async () => {
    let finishSave: () => void = () => undefined;
    const saveReviewed = vi.fn(async () => new Promise<void>((resolve) => { finishSave = resolve; }));
    const f = fixture(snapshot(), { readReviewed: async () => ({}), saveReviewed }, { aiEnabled: false });
    await vi.waitFor(() => expect(f.host.querySelector('[data-geld-local-reviewed]')).not.toBeNull());
    f.host.querySelector<HTMLButtonElement>('[data-geld-local-reviewed]')?.click();
    await vi.waitFor(() => expect(saveReviewed).toHaveBeenCalledTimes(1));
    f.apply(null);
    finishSave();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(f.host.querySelector('.geld-provider-review')).toBeNull();
    let finishLoad: (value: Readonly<Record<string, string>>) => void = () => undefined;
    const reader = vi.fn(() => new Promise<Readonly<Record<string, string>>>((resolve) => { finishLoad = resolve; }));
    const pending = fixture(snapshot(), { readReviewed: reader, saveReviewed }, { aiEnabled: false });
    await vi.waitFor(() => expect(reader).toHaveBeenCalledTimes(1));
    pending.apply(null);
    const changed = pending.changed.mock.calls.length;
    finishLoad({});
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(pending.changed).toHaveBeenCalledTimes(changed);
    expect(pending.host.querySelector('.geld-provider-review')).toBeNull();
  });

  it('retains a successful mark and shows the storage error when undo fails', async () => {
    const source = snapshot();
    const [item] = buildProviderReviewItems(source.input);
    if (item === undefined) throw new Error('Missing original item.');
    const fingerprint = await reviewedItemFingerprint(source.input, item, []);
    const f = fixture(source, { readReviewed: async () => ({ [item.id]: fingerprint }), saveReviewed: async () => { throw new Error('Device storage is unavailable.'); } }, { aiEnabled: false });
    await vi.waitFor(() => expect(f.host.querySelector('[data-geld-local-reviewed]')?.getAttribute('aria-pressed')).toBe('true'));
    f.host.querySelector<HTMLButtonElement>('[data-geld-local-reviewed]')?.click();
    await vi.waitFor(() => expect(f.host.querySelector('[role="alert"]')?.textContent).toContain('Device storage is unavailable.'));
    expect(f.host.querySelector('[data-geld-local-reviewed]')?.getAttribute('aria-pressed')).toBe('true');
    expect(f.host.querySelector<HTMLButtonElement>('[data-geld-local-reviewed]')?.disabled).toBe(false);
  });

  it('does not carry a pending local mark onto a newly pushed head with the same item id', async () => {
    let latest = snapshot();
    let finish: () => void = () => undefined;
    const saveReviewed = vi.fn(async () => new Promise<void>((resolve) => { finish = resolve; }));
    const f = fixture(latest, { readReviewed: async () => ({}), saveReviewed }, { aiEnabled: false }, { fetchReview: async () => latest });
    await vi.waitFor(() => expect(f.host.querySelector('[data-geld-local-reviewed]')).not.toBeNull());
    const itemId = f.host.querySelector('[data-geld-local-reviewed]')?.getAttribute('data-geld-local-reviewed');
    f.host.querySelector<HTMLButtonElement>('[data-geld-local-reviewed]')?.click();
    await vi.waitFor(() => expect(saveReviewed).toHaveBeenCalledTimes(1));
    latest = { ...latest, input: { ...latest.input, subject: { ...latest.input.subject, headSha: 'c'.repeat(40) } } };
    f.apply({ ...page, headSha: latest.input.subject.headSha, version: latest.input.subject.headSha });
    await vi.waitFor(() => expect(f.host.querySelector('[data-geld-local-reviewed]')?.getAttribute('data-geld-local-reviewed')).toBe(itemId));
    expect(f.host.querySelector('[data-geld-local-reviewed]')?.getAttribute('aria-pressed')).toBe('false');
    finish();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(f.host.querySelector('[data-geld-local-reviewed]')?.getAttribute('aria-pressed')).toBe('false');
    expect(f.host.querySelector('[data-geld-review-group="done"]')).toBeNull();
  });
});

describe('local reviewed source fingerprints', () => {
  it('ignores AI wording and state while binding head, edited bodies, ordered replies and native resolution', async () => {
    const source = snapshot().input;
    const [item] = buildProviderReviewItems(source);
    if (item === undefined) throw new Error('Missing original item.');
    const original = await reviewedItemFingerprint(source, item, []);
    expect(await reviewedItemFingerprint(source, { ...item, title: 'AI wording', context: 'AI explanation', rewritten: true, status: 'done-manual' }, [])).toBe(original);
    const reply = { ...comment('A later human reply.'), id: '2', anchor: 'note_2', url: `${url}#note_2`, author: { id: '67890', login: 'a-person', automated: false } };
    const changed: ProviderReviewInput[] = [
      { ...source, subject: { ...source.subject, headSha: 'b'.repeat(40) } },
      { ...source, threads: source.threads.map((thread) => ({ ...thread, comments: thread.comments.map((entry) => ({ ...entry, body: 'Edited at the same anchor.' })) })) },
      { ...source, threads: source.threads.map((thread) => ({ ...thread, resolved: true })) },
      { ...source, threads: source.threads.map((thread) => ({ ...thread, outdated: true })) },
      { ...source, threads: source.threads.map((thread) => ({ ...thread, comments: thread.comments.map((entry) => ({ ...entry, updatedAt: '2026-11-01T14:00:00Z' })) })) },
      { ...source, threads: source.threads.map((thread) => ({ ...thread, comments: [...thread.comments, reply] })) },
    ];
    for (const input of changed) {
      const [native] = buildProviderReviewItems(input);
      if (native === undefined) throw new Error('Missing changed item.');
      expect(await reviewedItemFingerprint(input, native, [])).not.toBe(original);
    }
    await expect(reviewedItemFingerprint(source, { ...item, sources: [...item.sources].map((entry) => ({ ...entry, url: 'https://evil.example/source' })) }, [])).rejects.toThrow('sources changed');
  });

  it('does not invalidate an item for an unrelated thread edit and retains source order in its hash', async () => {
    const source = snapshot().input;
    const other = { ...comment('Unrelated thread.'), id: '9', anchor: 'note_9', url: `${url}#note_9` };
    const unrelated = { ...source.threads[0], id: 'b'.repeat(40), anchor: `discussion_${'b'.repeat(40)}`, url: other.url, path: 'other.ts', line: 99, resolved: false, outdated: false, comments: [other] };
    const complete: ProviderReviewInput = { ...source, threads: [...source.threads, unrelated] };
    const item = buildProviderReviewItems(complete).find((entry) => entry.path === 'cache.ts');
    if (item === undefined) throw new Error('Missing original item.');
    const before = await reviewedItemFingerprint(complete, item, []);
    const edited: ProviderReviewInput = { ...complete, threads: complete.threads.map((thread) => thread.id === unrelated.id ? { ...thread, comments: [{ ...other, body: 'Unrelated edited body.' }] } : thread) };
    const afterItem = buildProviderReviewItems(edited).find((entry) => entry.id === item.id);
    if (afterItem === undefined) throw new Error('Missing original item after unrelated edit.');
    expect(await reviewedItemFingerprint(edited, afterItem, [])).toBe(before);
    const reply = { ...comment('Reply.'), id: '2', anchor: 'note_2', url: `${url}#note_2` };
    const ordered = { ...source, threads: source.threads.map((thread) => ({ ...thread, comments: [...thread.comments, reply] })) };
    const reversed = { ...source, threads: source.threads.map((thread) => ({ ...thread, comments: [reply, ...thread.comments] })) };
    const [first] = buildProviderReviewItems(ordered);
    const [second] = buildProviderReviewItems(reversed);
    if (first === undefined || second === undefined) throw new Error('Missing ordered source items.');
    expect(await reviewedItemFingerprint(ordered, first, [])).not.toBe(await reviewedItemFingerprint(reversed, second, []));
  });
});
