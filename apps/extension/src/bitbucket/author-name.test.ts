// @vitest-environment happy-dom
import { bitbucketAdapter } from './index';
import { describeBitbucketPage } from './page';
import { beginBitbucketAuthorPresentation } from './author-presentation';
import { renderProviderReviewPanel } from '../providers/review-panel';
import type { ProviderReviewComment, ProviderReviewSubject } from '@geld/review';
import type { BitbucketReviewSnapshot } from './review';
import { BitbucketClient } from './api';
import { fetchBitbucketReview } from './review';
import type { BitbucketApiAuthorPresentation } from './author-name';
import { ProviderConversation } from '../providers/conversation';
import { DEFAULT_SETTINGS } from '@geld/core';

vi.mock('wxt/utils/storage', () => ({ storage: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => undefined), watch: () => () => undefined,
  defineItem: () => ({ getValue: async () => ({}), setValue: async () => undefined, watch: () => () => undefined }) } }));

const URL = 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/22';
const UUID = '{c3cbd4fd-2494-4a26-a4db-ea02e2cdb5ee}';
const HEAD = 'a'.repeat(40);
const DATE = '2024-02-13T15:46:48Z';

// Documented native API shapes. Missing nickname, conflicts and alternate names are synthetic variations.
function rawComment(name = 'Oleksandr Kyrdan') {
  return { id: 471253038, user: { uuid: UUID, display_name: name }, parent: null,
    content: { raw: 'Please check the response before reading it.' }, created_on: DATE, updated_on: DATE, deleted: false,
    inline: { path: 'src/a.ts', to: 3, from: null, outdated: false }, resolution: null,
    links: { html: { href: `${URL}/_/diff#comment-471253038` } } };
}

function fixture(comments: readonly unknown[] = [rawComment()], head = HEAD) {
  let reads = 0;
  const fetcher: typeof fetch = async (input) => {
    reads += 1;
    const url = new globalThis.URL(input instanceof Request ? input.url : String(input));
    const value = url.pathname.endsWith('/pullrequests/22')
      ? { id: 22, title: 'Review', state: 'OPEN', source: { commit: { hash: head } }, destination: { commit: { hash: 'b'.repeat(40) } }, participants: [] }
      : { values: url.pathname.endsWith('/comments') ? comments : [] };
    return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
  };
  return { fetcher, reads: () => reads };
}

function page() {
  const value = describeBitbucketPage(new globalThis.URL(URL));
  if (value === null) throw new Error('Missing review fixture');
  return value;
}

async function snapshot(comments: readonly unknown[] = [rawComment()]): Promise<BitbucketReviewSnapshot & { readonly apiAuthorPresentation: BitbucketApiAuthorPresentation }> {
  const response = fixture(comments);
  const value = await fetchBitbucketReview(page(), new AbortController().signal, new BitbucketClient(page(), response.fetcher));
  if (value.apiAuthorPresentation === undefined) throw new Error('Missing API presentation');
  return { ...value, apiAuthorPresentation: value.apiAuthorPresentation };
}

function source(value: BitbucketReviewSnapshot): ProviderReviewComment {
  const comment = value.input.threads[0]?.comments[0] ?? value.comments[0];
  if (comment === undefined) throw new Error('Missing normalized source');
  return comment;
}

function mounted() {
  // Header shape reduced from retained public PR22, without invented avatar dimensions or role badges.
  document.body.innerHTML = '<div id="comment-471253038" data-testid="comment"><h3><span data-testid="comment-header"><span><span>Oleksandr Kyrdan</span></span><span><a href="#comment-471253038">Time</a></span></span></h3><div data-testid="comment-content">Body</div></div>';
}

beforeEach(() => { window.location.href = URL;document.body.replaceChildren(); });
afterEach(() => { window.dispatchEvent(new Event('pagehide'));vi.unstubAllGlobals();vi.restoreAllMocks(); });

it('renders the native API display name through real parsing, normalization, adapter binding and panel rendering without a mounted comment', async () => {
  const response = fixture();vi.stubGlobal('fetch', response.fetcher);
  const read = bitbucketAdapter.fetchReview;
  if (read === undefined) throw new Error('Missing adapter');
  const value = await read(page(), new AbortController().signal, document);
  const comment = value.input.threads[0]?.comments[0];
  if (comment === undefined || value.authorPresentation === undefined) throw new Error('Missing normalized source');
  expect(comment.author).toEqual({ id: UUID, login: UUID });
  const host = document.createElement('div');document.body.append(host);
  const panel = renderProviderReviewPanel(host, value.input, { comments: value.comments, authorPresentation: value.authorPresentation });
  const article = panel.element.querySelector('[data-geld-source-id="471253038"]');
  expect(article?.querySelector('[data-geld-author-name]')?.textContent).toBe('Oleksandr Kyrdan');
  expect(article?.querySelector('[data-geld-author-avatar], [data-geld-author-badge], [data-geld-author-profile]')).toBeNull();
  expect(article?.querySelector<HTMLAnchorElement>('a')?.href).toBe(comment.url);
  expect(value.input.bots).toEqual([]);expect(comment.author.automated).toBeUndefined();
  expect(response.reads()).toBe(6);
  for (let index = 0; index < 200; index += 1) expect(value.authorPresentation(comment)).toEqual({ authorId: UUID, displayName: 'Oleksandr Kyrdan' });
  expect(response.reads()).toBe(6);panel.destroy();
});

it('renders API name text without interpreting markup or changing native author identity', async () => {
  const value = await snapshot([rawComment('<img src=x onerror=alert(1)>')]);
  const read = beginBitbucketAuthorPresentation(document, page(), new AbortController().signal).bind(value);
  const host = document.createElement('div');document.body.append(host);
  const panel = renderProviderReviewPanel(host, value.input, { authorPresentation: read });
  expect(panel.element.querySelector('[data-geld-author-name]')?.textContent).toBe('<img src=x onerror=alert(1)>');
  expect(panel.element.querySelector('img')).toBeNull();expect(source(value).author.id).toBe(UUID);panel.destroy();
});

it('prefers the original mounted name, vetoes invalid or duplicate native targets, and supports late native mounting', async () => {
  const value = await snapshot([rawComment('API display name')]);
  const read = beginBitbucketAuthorPresentation(document, page(), new AbortController().signal).bind(value);
  expect(read(source(value))?.displayName).toBe('API display name');
  mounted();const original = document.body.innerHTML;
  expect(read(source(value))).toEqual({ authorId: UUID, displayName: 'Oleksandr Kyrdan' });
  expect(document.body.innerHTML).toBe(original);
  const root = document.querySelector('[data-testid="comment"]');
  if (root === null) throw new Error('Missing native root');
  root.after(root.cloneNode(true));expect(read(source(value))).toBeNull();
  root.nextElementSibling?.remove();root.querySelector('a')?.setAttribute('href', `${URL}/_/diff#comment-99`);
  expect(read(source(value))).toBeNull();
  root.removeAttribute('data-testid');expect(read(source(value))).toBeNull();
});

it.each(['head', 'provider', 'origin', 'repository', 'review'] as const)('declines a mismatched API snapshot %s', async (kind) => {
  const value = await snapshot();const subject: ProviderReviewSubject = { ...value.input.subject,
    ...(kind === 'head' ? { headSha: 'c'.repeat(40) } : kind === 'provider' ? { provider: 'gitlab' } : kind === 'origin' ? { origin: 'https://other.example' } : kind === 'repository' ? { repository: 'other/repository' } : { id: '23' }) };
  expect(value.apiAuthorPresentation(source(value), subject)).toBeNull();
});

it.each([7, 39, 41, 48, 63, 65])('declines a non-full %i-character snapshot head', async (length) => {
  const value = await snapshot();const changed = { ...value, input: { ...value.input, subject: { ...value.input.subject, headSha: 'a'.repeat(length) } } };
  const read = beginBitbucketAuthorPresentation(document, page(), new AbortController().signal).bind(changed);
  expect(read(source(value))).toBeNull();
});

it('accepts an exact 64-character head and detects changes to the same review snapshot head', async () => {
  const response = fixture([rawComment()], 'a'.repeat(64));const value = await fetchBitbucketReview(page(), new AbortController().signal, new BitbucketClient(page(), response.fetcher));
  const subject = { ...value.input.subject };const bound = { ...value, input: { ...value.input, subject } };
  const read = beginBitbucketAuthorPresentation(document, page(), new AbortController().signal).bind(bound);
  expect(read(source(value))?.displayName).toBe('Oleksandr Kyrdan');
  subject.headSha = 'b'.repeat(64);expect(read(source(value))).toBeNull();
});

it('requires an exact immutable comment tuple and UUID rather than a display name or nickname', async () => {
  const value = await snapshot();const comment = source(value);const read = beginBitbucketAuthorPresentation(document, page(), new AbortController().signal).bind(value);
  for (const changed of [{ ...comment, id: '99' }, { ...comment, anchor: 'comment-99' }, { ...comment, url: comment.url.replace('/22/', '/23/') },
    { ...comment, body: 'Changed' }, { ...comment, createdAt: '2024-03-01T00:00:00Z' }, { ...comment, author: { ...comment.author, id: '{00000000-0000-4000-8000-000000000000}' } }, { ...comment, author: { ...comment.author, login: 'Oleksandr Kyrdan' } }]) expect(read(changed)).toBeNull();
  const missingUuid = await snapshot([{ ...rawComment(), user: { account_id: 'account-only', display_name: 'Oleksandr Kyrdan' } }]);
  expect(beginBitbucketAuthorPresentation(document, page(), new AbortController().signal).bind(missingUuid)(source(missingUuid))).toBeNull();
});

it('declines duplicate API comment identities and conflicting names for the same UUID', async () => {
  for (const comments of [[rawComment(), rawComment('Conflict')], [rawComment(), { ...rawComment('Conflict'), id: 471253039, links: { html: { href: `${URL}/_/diff#comment-471253039` } } }]]) {
    const value = await snapshot(comments);const read = beginBitbucketAuthorPresentation(document, page(), new AbortController().signal).bind(value);
    expect(read(source(value))).toBeNull();
  }
});

it.each(['', 'x'.repeat(513)])('declines an empty or oversized display name', async (name) => {
  const value = await snapshot([rawComment(name)]);
  const read = beginBitbucketAuthorPresentation(document, page(), new AbortController().signal).bind(value);
  expect(read(source(value))).toBeNull();
});

it('does not scan native comment collections or read geometry for repeatedly absent sources', async () => {
  const value = await snapshot();const read = beginBitbucketAuthorPresentation(document, page(), new AbortController().signal).bind(value);
  const queries = vi.spyOn(document, 'querySelectorAll');const geometry = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect');
  for (let index = 0; index < 200; index += 1) expect(read(source(value))?.displayName).toBe('Oleksandr Kyrdan');
  expect(queries).not.toHaveBeenCalled();expect(geometry).not.toHaveBeenCalled();
});

it('invalidates replaced, aborted, failed-fetch and departed-page readers instead of reviving stale API names', async () => {
  const value = await snapshot();const signal = new AbortController();const first = beginBitbucketAuthorPresentation(document, page(), signal.signal).bind(value);
  expect(first(source(value))).not.toBeNull();
  const next = beginBitbucketAuthorPresentation(document, page(), new AbortController().signal);
  expect(first(source(value))).toBeNull();const second = next.bind(value);expect(second(source(value))).not.toBeNull();
  next.invalidate();expect(second(source(value))).toBeNull();
  const aborted = beginBitbucketAuthorPresentation(document, page(), signal.signal).bind(value);signal.abort();expect(aborted(source(value))).toBeNull();
  const active = beginBitbucketAuthorPresentation(document, page(), new AbortController().signal).bind(value);
  vi.stubGlobal('fetch', async () => new Response('{}', { status: 401, headers: { 'content-type': 'application/json' } }));
  await expect(bitbucketAdapter.fetchReview?.(page(), new AbortController().signal, document)).rejects.toThrow();expect(active(source(value))).toBeNull();
  const departed = beginBitbucketAuthorPresentation(document, page(), new AbortController().signal).bind(value);
  window.location.href = `${URL}/diff`;
  expect(departed(source(value))).toBeNull();
});

it.each(['clear', 'master-disable'] as const)('discards a successfully fetched conversation on %s without adding name-reader lifecycle listeners', async (mode) => {
  // Establish the existing shared transport's pagehide watcher before measuring this presentation lifecycle.
  const value = await snapshot();
  document.body.innerHTML = '<section><div data-qa="pr-activity"></div></section>';
  const response = fixture();vi.stubGlobal('fetch', response.fetcher);
  const addWindow = vi.spyOn(window, 'addEventListener');
  const addDocument = vi.spyOn(document, 'addEventListener');
  const addSignal = vi.spyOn(AbortSignal.prototype, 'addEventListener');
  const changed = vi.fn();const conversation = new ProviderConversation(bitbucketAdapter, changed);
  const settings = { ...DEFAULT_SETTINGS, enabled: true, prOverview: true, quickReview: false, aiEnabled: false, compactTimeline: 'off' as const };
  try {
    conversation.apply(page(), settings);
    await vi.waitFor(() => expect(changed).toHaveBeenCalled());
    conversation.apply(page(), settings);
    expect(document.querySelector('[data-geld-author-name]')?.textContent).toBe('Oleksandr Kyrdan');
    expect(response.reads()).toBe(6);
    if (mode === 'clear') conversation.clear();
    else conversation.apply(page(), { ...settings, enabled: false });
    expect(document.querySelector('.geld-provider-review')).toBeNull();
    expect(document.querySelector('[data-geld-author-name]')).toBeNull();
    expect(addWindow.mock.calls.filter(([name]) => ['pagehide', 'popstate', 'hashchange', 'wxt:locationchange'].includes(name))).toEqual([]);
    expect(addDocument.mock.calls.filter(([name]) => ['pagehide', 'popstate', 'hashchange', 'wxt:locationchange'].includes(name))).toEqual([]);
    const abort = new AbortController();
    const beforeBinding = { window: addWindow.mock.calls.length, document: addDocument.mock.calls.length, signal: addSignal.mock.calls.length };
    const read = beginBitbucketAuthorPresentation(document, page(), abort.signal).bind(value);
    expect(read(source(value))?.displayName).toBe('Oleksandr Kyrdan');
    expect(addWindow.mock.calls).toHaveLength(beforeBinding.window);
    expect(addDocument.mock.calls).toHaveLength(beforeBinding.document);
    expect(addSignal.mock.calls).toHaveLength(beforeBinding.signal);
    expect(response.reads()).toBe(6);
    changed.mockClear();
    conversation.apply(page(), settings);
    await vi.waitFor(() => expect(changed).toHaveBeenCalled());
    conversation.apply(page(), settings);
    expect(document.querySelector('[data-geld-author-name]')?.textContent).toBe('Oleksandr Kyrdan');
    expect(response.reads()).toBe(12);
    expect(read(source(value))).toBeNull();
  } finally { conversation.clear(); }
});

it('invalidates the previous production adapter reader when a newer full-head snapshot replaces it', async () => {
  const read = bitbucketAdapter.fetchReview;
  if (read === undefined) throw new Error('Missing adapter');
  vi.stubGlobal('fetch', fixture().fetcher);
  const first = await read(page(), new AbortController().signal, document);
  const oldComment = first.input.threads[0]?.comments[0];
  if (oldComment === undefined || first.authorPresentation === undefined) throw new Error('Missing first source');
  expect(first.authorPresentation(oldComment)?.displayName).toBe('Oleksandr Kyrdan');
  vi.stubGlobal('fetch', fixture([rawComment('Updated native name')], 'c'.repeat(40)).fetcher);
  const next = await read(page(), new AbortController().signal, document);
  const currentComment = next.input.threads[0]?.comments[0];
  if (currentComment === undefined || next.authorPresentation === undefined) throw new Error('Missing current source');
  expect(next.input.subject.headSha).toBe('c'.repeat(40));
  expect(first.authorPresentation(oldComment)).toBeNull();
  expect(next.authorPresentation(currentComment)).toEqual({ authorId: UUID, displayName: 'Updated native name' });
});
