import { compileAuthorRules } from '@geld/core';
import { createBitbucketListAuthorFetcher } from './list-authors';
import { createBitbucketTransport } from './transport';
import type { BitbucketCooldownStore } from './transport';
vi.mock('wxt/utils/storage', () => ({ storage: { getItem: async () => null, setItem: async () => undefined, watch: () => () => undefined } }));
const LIST = 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/?state=MERGED';
const REVIEW = 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/27';
const UUID = '7177c565-3bb4-44d3-b17b-e791dfb8fed8';
// Documented collection shape with retained actual PR27 author fields; not a live collection capture.
const fixture = () => ({ values: [{ id: 27, author: { uuid: `{${UUID}}`, display_name: 'Albert Sundjaja', nickname: 'Albert Sundjaja', account_id: '712020:0f3e0dc4-4f17-4c0f-be18-c3d6dfa60987' } }] });
function response(value: unknown, status = 200, contentType = 'application/json'): Response { return new Response(typeof value === 'string' ? value : JSON.stringify(value), { status, headers: { 'content-type': contentType } }); }
function setup(value: unknown = fixture(), status = 200, contentType = 'application/json') {
  let until: unknown = 0;
  const store: BitbucketCooldownStore = { read: async () => until, write: async (value) => { until = value; } };
  const transport = createBitbucketTransport({ origin: () => 'https://bitbucket.org', store, now: () => 1000 });
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => response(value, status, contentType));
  return { fetcher, transport, store, read: createBitbucketListAuthorFetcher(fetcher, transport) };
}
it('requests one state-bound UUID/name projection through native session transport with fresh mutable metadata', async () => {
  const { read, fetcher, transport } = setup();const signal = new AbortController().signal;
  expect(await read(new URL(LIST), [REVIEW], signal)).toEqual([{ url: REVIEW, author: `bitbucket.org/uuid/${UUID}`, authorName: 'Albert Sundjaja' }]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [input, init] = fetcher.mock.calls[0] ?? [];const url = new URL(String(input));
  expect(url.origin).toBe('https://bitbucket.org');expect(url.pathname).toBe('/!api/2.0/repositories/atlassian/bitbucket-upload-file/pullrequests');
  expect(Object.fromEntries(url.searchParams)).toEqual({ q: 'state="MERGED"', pagelen: '25', fields: 'values.id,values.author.uuid,values.author.display_name' });
  expect(init).toMatchObject({ cache: 'no-cache', credentials: 'same-origin', redirect: 'manual', signal });transport.dispose();
});
it('maps only exact current PR IDs and never follows next or fans out for omitted rows', async () => {
  const { read, fetcher } = setup({ ...fixture(), next: 'https://foreign.example/next', values: [...fixture().values, { id: 25, author: { uuid: '{11111111-1111-1111-1111-111111111111}', display_name: 'Albert Sundjaja' } }] });
  expect(await read(new URL(LIST), [REVIEW, REVIEW.replace('/27', '/22')], new AbortController().signal)).toHaveLength(1);expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each([LIST.replace('MERGED', 'merged'), LIST.replace('MERGED', 'ALL'), LIST.replace('?state=MERGED', ''), `${LIST}&state=OPEN`, `${LIST}&page=2`, `${LIST}&q=author.uuid`, `${LIST}&sort=-updated_on`, LIST.replace('https:', 'http:'), `${LIST}#other`])('declines unsupported selection without a read: %s', async (url) => {
  const { read, fetcher } = setup();expect(await read(new URL(url), [REVIEW], new AbortController().signal)).toEqual([]);expect(fetcher).not.toHaveBeenCalled();
});
it.each([REVIEW.replace('bitbucket.org', 'example.com'), REVIEW.replace('atlassian', 'foreign'), `${REVIEW}/diff`, `${REVIEW}?other=1`, REVIEW.replace('/27', '/0')])('declines foreign/noncanonical visible identity: %s', async (review) => {
  const { read, fetcher } = setup();expect(await read(new URL(LIST), [review], new AbortController().signal)).toEqual([]);expect(fetcher).not.toHaveBeenCalled();
});
it('never uses nickname, display-name or account_id fallback as an identity and reuses the exact core glob grammar', async () => {
  const missing = setup({ values: [{ id: 27, author: { nickname: 'albert', display_name: 'Albert Sundjaja', account_id: UUID } }] });
  expect(await missing.read(new URL(LIST), [REVIEW], new AbortController().signal)).toEqual([]);
  const valid = setup();const key = (await valid.read(new URL(LIST), [REVIEW], new AbortController().signal))[0]?.author ?? '';
  expect(compileAuthorRules(['Albert*', 'albert', UUID]).hides(key)).toBe(false);
  expect(compileAuthorRules([`@BITBUCKET.ORG/uuid/${UUID.toUpperCase()}`]).hides(key)).toBe(true);
  expect(compileAuthorRules(['bitbucket.org/uuid/7177*']).hides(key)).toBe(true);
});
it.each([null, {}, { values: 'wrong' }, { values: [{ id: 0 }] }, { values: [{ id: 27 }, { id: 27 }] }, { values: Array.from({ length: 26 }, (_, index) => ({ id: index + 1 })) }])('rejects invalid/ambiguous collection batches', async (value) => {
  const { read } = setup(value);await expect(read(new URL(LIST), [REVIEW], new AbortController().signal)).rejects.toThrow();
});
it.each([null, {}, { uuid: 'not-a-uuid', display_name: 'Albert Sundjaja' }, { uuid: ` ${UUID}` }])('keeps missing/deleted/malformed authors unknown', async (author) => {
  const { read } = setup({ values: [{ id: 27, author }] });expect(await read(new URL(LIST), [REVIEW], new AbortController().signal)).toEqual([]);
});
it.each([401, 403, 500])('does not turn HTTP%s into empty authoritative data', async (status) => {
  const { read } = setup({}, status);await expect(read(new URL(LIST), [REVIEW], new AbortController().signal)).rejects.toThrow();
});
it('rejects login HTML, truncated JSON and oversized bodies', async () => {
  for (const [value, contentType] of [['<html>Sign in</html>', 'text/html'], ['{"values":[', 'application/json'], [JSON.stringify({ values: [{ id: 27, author: { uuid: UUID, display_name: 'x'.repeat(300_000) } }] }), 'application/json']]) {
    const { read } = setup(value, 200, contentType);await expect(read(new URL(LIST), [REVIEW], new AbortController().signal)).rejects.toThrow();
  }
});
it('shares429 cooldown with every resource and fresh client instance without retrying', async () => {
  const { read, fetcher, store } = setup({}, 429);await expect(read(new URL(LIST), [REVIEW], new AbortController().signal)).rejects.toMatchObject({ reason: 'rate-limited' });
  const fresh = createBitbucketTransport({ origin: () => 'https://bitbucket.org', store, now: () => 1000 });
  for (const suffix of ['diff/abc', 'src/abc/.github/geld.yml', 'pullrequests/27/comments']) await expect(fresh.fetch(`https://api.bitbucket.org/2.0/repositories/atlassian/bitbucket-upload-file/${suffix}`, {}, fetcher)).rejects.toMatchObject({ reason: 'rate-limited' });
  expect(fetcher).toHaveBeenCalledTimes(1);fresh.dispose();
});
it('rejects pre-aborted reads and foreign response destinations', async () => {
  const { read, fetcher } = setup();const abort = new AbortController();abort.abort();
  await expect(read(new URL(LIST), [REVIEW], abort.signal)).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled();
  const bad: typeof fetch = async () => { const value = response(fixture());Object.defineProperty(value, 'url', { value: 'https://foreign.example/list' });return value; };
  const transport = createBitbucketTransport({ origin: () => null, store: { read: async () => 0, write: async () => undefined } });
  await expect(createBitbucketListAuthorFetcher(bad, transport)(new URL(LIST), [REVIEW], new AbortController().signal)).rejects.toThrow();
});

it.each(['OPEN', 'MERGED', 'DECLINED', 'SUPERSEDED'])('translates only validated native state %s into the observed fixed predicate', async (state) => {
  const { read, fetcher } = setup();await read(new URL(LIST.replace('MERGED', state)), [REVIEW], new AbortController().signal);
  const request = new URL(String(fetcher.mock.calls[0]?.[0]));expect(request.searchParams.get('q')).toBe(`state="${state}"`);expect(request.searchParams.has('state')).toBe(false);expect(request.searchParams.get('pagelen')).toBe('25');expect(fetcher).toHaveBeenCalledTimes(1);
});
