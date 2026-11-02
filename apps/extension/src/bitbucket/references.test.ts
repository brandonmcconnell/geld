// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@geld/core';
import type { ProviderReviewInput } from '@geld/review';
import { ProviderConversation } from '../providers/conversation';
import { referenceForSubject } from '../providers/references';
import type { ProviderAdapter, ProviderReviewPage, ProviderReviewSnapshot } from '../providers/types';
import { bitbucketAdapter } from './index';
import { describeBitbucketPage } from './page';
import { bitbucketReferenceAnchor, readBitbucketReferences } from './references';

vi.mock('wxt/browser', () => ({ browser: { runtime: { sendMessage: vi.fn(() => { throw new Error('Unexpected transport.'); }) } } }));
vi.mock('wxt/utils/storage', () => ({ storage: { defineItem: () => ({ getValue: async () => ({}), setValue: async () => undefined }) } }));

const url = 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/27';
const target = 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/22';
const sha = 'a'.repeat(40);
const subject = { provider: 'bitbucket', origin: 'https://bitbucket.org', repository: 'atlassian/bitbucket-upload-file', id: '27', headSha: sha } as const;
const stops: (() => void)[] = [];
const nativeHeader = '<div data-testid="pr-header"><a href="/atlassian/bitbucket-upload-file/src">bitbucket-upload-file</a><div data-qa="pr-branches-and-state-styles"></div><span>#27 • created</span></div>';
// Reduced original source hosts/text from retained PR27/PR22 captures. Positive reference anchors below are synthetic.
function fixture(body = '<p>Support API token</p><p>Tested uploading a file from one of my pipeline</p>'): void {
  document.body.innerHTML = `${nativeHeader}<section data-qa="pull-request-description"><div class="ak-renderer-document">${body}</div></section><main id="fixture-digest"></main>`;
}
function page(href = url): ProviderReviewPage {
  const value = describeBitbucketPage(new URL(href));
  if (value === null) throw new Error('Missing fixture review.');
  return value;
}
function original(): HTMLAnchorElement {
  const value = document.querySelector<HTMLAnchorElement>('[data-qa="pull-request-description"] a');
  if (value === null) throw new Error('Missing synthetic reference.');
  return value;
}
function positive(): void { fixture('<p>Support API token</p><p><a href="/atlassian/bitbucket-upload-file/pull-requests/22">Related PR22</a></p>'); }
beforeEach(() => { window.location.href = url;fixture();vi.stubGlobal('fetch', vi.fn(() => { throw new Error('References must not acquire metadata.'); })); });
afterEach(() => { for (const stop of stops.splice(0)) stop();vi.restoreAllMocks();vi.unstubAllGlobals(); });

it('keeps the retained link-free native PR27 description and PR22 comment fixture empty', () => {
  expect(readBitbucketReferences(page(), document)).toEqual([]);
  fixture('<p> </p>');
  window.location.href = url.replace('/27', '/22');document.querySelector('[data-qa="pr-branches-and-state-styles"] + span')?.replaceChildren('#22 • created');
  document.body.insertAdjacentHTML('beforeend', '<div id="comment-471253038" data-testid="comment"><div data-testid="comment-header"><a href="/atlassian/bitbucket-upload-file/pull-requests/22/_/diff#comment-471253038">Source</a></div><div data-testid="comment-content">Internal maintenance: Update tests to access token auth. </div></div>');
  expect(readBitbucketReferences(page(window.location.href), document)).toEqual([]);expect(fetch).not.toHaveBeenCalled();
});

it('indexes synthetic description PR links with explicit URL identity and no invented native IDs, title or state', () => {
  positive();original().title = 'Authored link title is not target metadata';
  const before = document.body.innerHTML;
  const entries = readBitbucketReferences(page(), document);
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({ direction: 'outgoing', label: 'Related PR22', title: null,
    target: { provider: 'bitbucket', identityBasis: 'canonical-url', origin: 'https://bitbucket.org', repository: 'atlassian/bitbucket-upload-file', number: '22', kind: 'pull-request', url: target }, source: { reviewUrl: url, anchor: null } });
  expect(entries[0]?.target).not.toHaveProperty('projectId');expect(entries[0]?.target).not.toHaveProperty('nativeId');
  expect(entries[0] !== undefined && referenceForSubject(entries[0], subject)).toBe(true);
  expect(bitbucketAdapter.readReferences).toBe(readBitbucketReferences);expect(bitbucketAdapter.referenceAnchor).toBe(bitbucketReferenceAnchor);
  expect(document.body.innerHTML).toBe(before);expect(fetch).not.toHaveBeenCalled();
});

it('deduplicates overview aliases while retaining the exact first original and excludes other source areas', () => {
  positive();const first = original();
  first.insertAdjacentHTML('afterend', '<a href="/atlassian/bitbucket-upload-file/pull-requests/22/_/overview">Same PR</a><a href="https://bitbucket.org/other/repository/pull-requests/34/overview">Cross-repository PR</a>');
  document.body.insertAdjacentHTML('beforeend', '<div data-testid="comment-content"><a href="/other/repository/pull-requests/35">Comment link is outside this slice</a></div><table><tr data-qa="pull-request-row"><td><a href="/other/repository/pull-requests/36">Native list title</a></td></tr></table>');
  const entries = readBitbucketReferences(page(), document);expect(entries.map((entry) => entry.target.number)).toEqual(['22', '34']);
  const reference = entries[0];if (reference === undefined) throw new Error('Missing reference.');
  expect(bitbucketReferenceAnchor(reference, page(), document)).toBe(first);expect(first.getAttribute('href')).toBe('/atlassian/bitbucket-upload-file/pull-requests/22');
});

it.each(['https://other.example/atlassian/bitbucket-upload-file/pull-requests/22', 'https://bitbucket.org.evil.example/a/b/pull-requests/22', 'https://user:password@bitbucket.org/a/b/pull-requests/22', 'http://bitbucket.org/a/b/pull-requests/22', 'javascript:alert(1)', '/a/b/pull-requests/0', '/a/b/pull-requests/22?tab=overview', '/a/b/pull-requests/22#comment-123', '/a/b%2fc/pull-requests/22', '/a/b/%2e%2e/b/pull-requests/22', '/a/b/../b/pull-requests/22', '/a/b/issues/22', '/a/b/commits/abcdef123456', '/a/b/pull-requests/22/diff'])('leaves unsupported or unsafe synthetic destination%s as an ordinary body link', (href) => {
  positive();original().setAttribute('href', href);expect(readBitbucketReferences(page(), document)).toEqual([]);
});

it.each(['1', '9007199254740993', '0', '01', '-1', '1e3'])('preserves native route syntax for synthetic numeric component%s without numeric coercion or existence claims', (number) => {
  positive();const href = `https://bitbucket.org/a/b/pull-requests/${number}`;original().href = href;
  const nativeRoute = describeBitbucketPage(new URL(href));const entries = readBitbucketReferences(page(), document);
  expect(entries).toHaveLength(nativeRoute === null ? 0 : 1);
  if (nativeRoute !== null) {
    const entry = entries[0];if (entry === undefined) throw new Error('Missing syntactic reference.');
    expect(entry.target.number).toBe(nativeRoute.number);expect(entry.target.number).toBe(number);expect(referenceForSubject(entry, subject)).toBe(true);expect(entry.title).toBeNull();
  }
  expect(fetch).not.toHaveBeenCalled();
});

it('ignores owned copies and interactive source controls and declines oversized anchor inventories', () => {
  fixture('<p>Support API token</p><div data-geld-ui><a href="/a/b/pull-requests/22">Owned</a></div><div role="tooltip"><a href="/a/b/pull-requests/23">Popup</a></div><form><a href="/a/b/pull-requests/24">Composer</a></form><a role="button" href="/a/b/pull-requests/25">Action</a>');
  expect(readBitbucketReferences(page(), document)).toEqual([]);
  fixture(`<p>${Array.from({ length: 201 }, (_, id) => `<a href="/a/b/pull-requests/${id + 1}">Synthetic PR</a>`).join('')}</p>`);
  expect(readBitbucketReferences(page(), document)).toEqual([]);expect(fetch).not.toHaveBeenCalled();
});

it.each(['number', 'repository', 'duplicate-header', 'duplicate-description', 'route', 'diff-tab'])('rejects stale or ambiguous native source%s', (kind) => {
  positive();
  if (kind === 'number') document.querySelector('[data-qa="pr-branches-and-state-styles"] + span')?.replaceChildren('#28 • created');
  if (kind === 'repository') document.querySelector('[data-testid="pr-header"] a')?.setAttribute('href', '/other/repository/src');
  if (kind === 'duplicate-header') document.body.insertAdjacentHTML('beforeend', nativeHeader);
  if (kind === 'duplicate-description') document.body.insertAdjacentHTML('beforeend', '<section data-qa="pull-request-description"><div class="ak-renderer-document"></div></section>');
  if (kind === 'route') window.location.href = url.replace('/27', '/28');
  if (kind === 'diff-tab') window.location.href = `${url}/diff`;
  expect(readBitbucketReferences(page(), document)).toEqual([]);
});

it.each(['anchor-remount', 'root-remount', 'href', 'label'])('rejects a stale synthetic anchor binding after%s until a fresh source read', (change) => {
  positive();const first = original();const reference = readBitbucketReferences(page(), document)[0];if (reference === undefined) throw new Error('Missing reference.');
  if (change === 'anchor-remount') first.replaceWith(first.cloneNode(true));
  if (change === 'root-remount') { const root = first.closest('.ak-renderer-document');root?.replaceWith(root.cloneNode(true)); }
  if (change === 'href') first.setAttribute('href', `${target}/overview`);
  if (change === 'label') first.textContent = 'Updated source label';
  expect(bitbucketReferenceAnchor(reference, page(), document)).toBeNull();
  const refreshed = readBitbucketReferences(page(), document)[0];if (refreshed === undefined) throw new Error('Missing refreshed reference.');
  expect(bitbucketReferenceAnchor(refreshed, page(), document)).toBe(original());
});

async function conversationFixture(): Promise<{ readonly conversation: ProviderConversation; readonly reference: HTMLAnchorElement; readonly scroll: ReturnType<typeof vi.fn>; readonly button: HTMLButtonElement; readonly fetchReview: ReturnType<typeof vi.fn>; readonly active: ProviderReviewPage }> {
  positive();const reference = original();
  vi.spyOn(reference, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 10, 100, 20));
  const scroll = vi.fn();vi.spyOn(reference, 'scrollIntoView').mockImplementation(scroll);
  const mount = document.getElementById('fixture-digest');if (mount === null) throw new Error('Missing panel mount.');
  const input: ProviderReviewInput = { subject, threads: [], checks: [], reviewers: [] };
  const snapshot: ProviderReviewSnapshot = { input, comments: [], events: [], complete: true, unavailable: [], approvalsRequired: null, approvalsLeft: null, actions: [] };
  const fetchReview = vi.fn(async () => snapshot);
  const adapter: ProviderAdapter = { ...bitbucketAdapter, reviewHost: () => mount, fetchReview };
  const changed = vi.fn();const conversation = new ProviderConversation(adapter, changed);stops.push(() => conversation.clear());
  const active = page();const settings = { ...DEFAULT_SETTINGS, quickReview: false, aiEnabled: false, compactTimeline: 'minimal', collapseDescription: true } as const;
  conversation.apply(active, settings);await vi.waitFor(() => expect(changed).toHaveBeenCalled());conversation.apply(active, settings);
  const button = document.querySelector<HTMLButtonElement>('[data-geld-reference] button');if (button === null) throw new Error('Missing reference source action.');
  return { conversation, reference, scroll, button, fetchReview, active };
}

it('reveals and focuses the exact synthetic original through the shared collapsed-description flow without acquiring target metadata', async () => {
  const fixture = await conversationFixture();const before = fixture.reference.outerHTML;const parent = fixture.reference.parentElement;
  expect(fixture.reference.closest('[data-geld-provider-description-hidden]')).not.toBeNull();
  fixture.button.click();
  expect(fixture.reference.closest('[data-geld-provider-description-hidden]')).toBeNull();expect(document.activeElement).toBe(fixture.reference);
  expect(fixture.scroll).toHaveBeenCalledOnce();expect(fixture.reference.parentElement).toBe(parent);expect(fixture.reference.outerHTML).toBe(before);
  expect(fixture.fetchReview).toHaveBeenCalledOnce();expect(fetch).not.toHaveBeenCalled();
  fixture.conversation.clear();expect(document.querySelector('[data-geld-provider-description-hidden]')).toBeNull();expect(fixture.reference.outerHTML).toBe(before);
});

it.each(['route', 'removed', 'hidden', 'replaced'])('shared source reveal refuses%s synthetic native context', async (kind) => {
  const fixture = await conversationFixture();
  if (kind === 'route') window.location.href = url.replace('/27', '/28');
  if (kind === 'removed') fixture.reference.remove();
  if (kind === 'hidden') fixture.reference.hidden = true;
  if (kind === 'replaced') fixture.reference.replaceWith(fixture.reference.cloneNode(true));
  fixture.button.click();expect(fixture.scroll).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
});
