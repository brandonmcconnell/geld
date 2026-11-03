import { BitbucketClient } from './api';
import { describeBitbucketCommitPage, describeBitbucketProviderPage } from './page';

const HEAD = '9777bca47119a91758bde1209ac14e6076ffbf23';
const ROOT = 'https://api.bitbucket.org/2.0/repositories/atlassian/bitbucket-upload-file';
const FILE = { status: 'added', old: null, new: { path: 'src/test.test.ts' }, lines_added: 1, lines_removed: 0 };
const PATCH = 'diff --git a/src/test.test.ts b/src/test.test.ts\nnew file mode 100644\n--- /dev/null\n+++ b/src/test.test.ts\n@@ -0,0 +1 @@\n+test();\n';

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

function setup(ref: string, handler: (url: URL, init: RequestInit | undefined) => Response): { client: BitbucketClient; requests: URL[]; signal: AbortSignal } {
  const page = describeBitbucketCommitPage(new URL(`https://bitbucket.org/atlassian/bitbucket-upload-file/commits/${ref}`));
  if (page === null) throw new Error('Invalid fixture ref');
  const requests: URL[] = [];
  const fetcher: typeof fetch = async (input, init) => { const url = new URL(input instanceof Request ? input.url : String(input)); requests.push(url); return handler(url, init); };
  return { client: new BitbucketClient(page, fetcher), requests, signal: new AbortController().signal };
}

it('describes native commit routes without treating an abbreviated hash as immutable', () => {
  expect(describeBitbucketCommitPage(new URL(`https://bitbucket.org/atlassian/bitbucket-upload-file/commits/${HEAD}`))).toMatchObject({ kind: 'commit', ref: HEAD, headSha: HEAD, version: `commit:${HEAD}` });
  expect(describeBitbucketProviderPage(new URL(`https://bitbucket.org/atlassian/bitbucket-upload-file/commits/${HEAD.slice(0, 12)}`))).toMatchObject({ kind: 'commit', headSha: null });
  for (const path of ['commits/main', 'commits/abcdef', `commits/${HEAD}/diff`, 'commit/abcdef01234', `commits/${'a'.repeat(41)}`]) expect(describeBitbucketCommitPage(new URL(`https://bitbucket.org/atlassian/bitbucket-upload-file/${path}`))).toBeNull();
  expect(describeBitbucketCommitPage(new URL(`https://user:secret@bitbucket.org/atlassian/bitbucket-upload-file/commits/${HEAD}`))).toBeNull();
});

it('pins documented commit diff and fully paginated diffstat to the authoritative full hash', async () => {
  // Documented API fixtures, not a claim of a live commit-page capture.
  const ref = HEAD.slice(0, 12);
  const { client, requests, signal } = setup(ref, (url, init) => {
    expect(init?.credentials).toBe('omit');
    expect(init?.redirect).toBe('manual');
    expect(init?.signal).toBe(signal);
    if (url.pathname.includes('/commit/')) return json({ hash: HEAD, repository: { full_name: 'atlassian/bitbucket-upload-file' } });
    if (url.pathname.includes('/diffstat/')) return url.searchParams.has('page') ? json({ size: 1, values: [FILE] }) : json({ size: 1, values: [], next: `${ROOT}/diffstat/${HEAD}?pagelen=100&page=2` });
    if (url.pathname.includes('/diff/')) return new Response(PATCH, { headers: { 'content-type': 'text/plain' } });
    throw new Error('Unexpected resource');
  });
  const result = await client.diff(signal);
  expect(result).toMatchObject({ complete: true, revision: `commit:${HEAD}`, files: [{ path: 'src/test.test.ts', additions: 1, deletions: 0 }] });
  expect(result.patches?.get('src/test.test.ts')).toBe(PATCH);
  expect(requests.filter((url) => url.pathname.includes('/commit/'))).toHaveLength(2);
  expect(requests.filter((url) => url.pathname.includes('/diff/'))[0]?.href).toBe(`${ROOT}/diff/${HEAD}`);
});

it('keeps omitted patches incomplete and never marks a bounded response as an empty complete commit', async () => {
  const { client, signal } = setup(HEAD, (url) => url.pathname.includes('/commit/') ? json({ hash: HEAD }) : url.pathname.includes('/diffstat/') ? json({ size: 1, values: [FILE] }) : new Response(''));
  expect(await client.diff(signal)).toMatchObject({ complete: false, files: [{ path: 'src/test.test.ts' }] });
});

it('rejects ambiguous, wrong-prefix and wrong-repository resolutions before fetching a diff', async () => {
  for (const value of [{ hash: 'a'.repeat(40) }, { hash: HEAD.slice(0, 12) }, { hash: HEAD, repository: { full_name: 'other/repo' } }]) {
    const { client, requests, signal } = setup(HEAD.slice(0, 12), () => json(value));
    await expect(client.diff(signal)).rejects.toMatchObject({ reason: 'invalid-response' });
    expect(requests).toHaveLength(1);
  }
  const { client, signal } = setup(HEAD.slice(0, 12), () => json({}, 409));
  await expect(client.diff(signal)).rejects.toMatchObject({ reason: 'unavailable' });
});

it('re-resolves abbreviated refs after acquisition to detect a changed or reused prefix', async () => {
  const prefix = HEAD.slice(0, 12);
  let reads = 0;
  const { client, signal } = setup(prefix, (url) => url.pathname.includes('/commit/') ? json({ hash: ++reads === 1 ? HEAD : prefix + 'a'.repeat(28) }) : url.pathname.includes('/diffstat/') ? json({ size: 1, values: [FILE] }) : new Response(PATCH));
  await expect(client.diff(signal)).rejects.toMatchObject({ reason: 'changed' });
});

it('rejects redirect and cross-revision pagination rather than following untrusted sources', async () => {
  for (const next of [`${ROOT}/diffstat/${'a'.repeat(40)}?page=2`, `https://example.com/2.0/repositories/atlassian/bitbucket-upload-file/diffstat/${HEAD}?page=2`, `${ROOT}/diffstat/${HEAD}?topic=true&page=2`]) {
    const { client, signal } = setup(HEAD, (url) => url.pathname.includes('/commit/') ? json({ hash: HEAD }) : url.pathname.includes('/diffstat/') ? json({ values: [], next }) : new Response(PATCH));
    await expect(client.diff(signal)).rejects.toMatchObject({ reason: 'invalid-response' });
  }
  const redirect = setup(HEAD, () => new Response('', { status: 302, headers: { location: 'https://example.com' } }));
  await expect(redirect.client.diff(redirect.signal)).rejects.toMatchObject({ reason: 'invalid-response' });
});

it('keeps authentication failure distinct from empty commit data and prevents review endpoint use', async () => {
  const { client, requests, signal } = setup(HEAD, () => json({}, 401));
  await expect(client.diff(signal)).rejects.toMatchObject({ reason: 'authentication' });
  await expect(client.pullRequest(signal)).rejects.toMatchObject({ reason: 'invalid-response' });
  await expect(client.comments(signal)).rejects.toMatchObject({ reason: 'invalid-response' });
  expect(requests).toHaveLength(1);
});

it('revalidates an abbreviated standalone commit before and after pinned acquisition', async () => {
  const prefix = HEAD.slice(0, 12);
  let origin = HEAD;
  let cached: string | null = null;
  const policies: Array<{ readonly identity: boolean; readonly cache: RequestCache | undefined }> = [];
  const { client, requests, signal } = setup(prefix, (url, init) => {
    const identity = url.pathname.includes('/commit/');
    policies.push({ identity, cache: init?.cache });
    if (identity) {
      const hash = init?.cache === 'no-cache' || cached === null ? origin : cached;
      cached = hash;
      origin = prefix + 'a'.repeat(28);
      return json({ hash });
    }
    return url.pathname.includes('/diffstat/') ? json({ size: 1, values: [FILE] }) : new Response(PATCH);
  });
  await expect(client.diff(signal)).rejects.toMatchObject({ reason: 'changed' });
  expect(requests).toHaveLength(4);
  expect(policies.filter(({ identity }) => identity).map(({ cache }) => cache)).toEqual(['no-cache', 'no-cache']);
  expect(policies.filter(({ identity }) => !identity).every(({ cache }) => cache === undefined)).toBe(true);
});

it('retains the default HTTP cache policy for a full immutable commit and its payloads', async () => {
  const { client, requests, signal } = setup(HEAD, (url, init) => {
    expect(init?.cache).toBeUndefined();
    return url.pathname.includes('/commit/') ? json({ hash: HEAD }) : url.pathname.includes('/diffstat/') ? json({ size: 1, values: [FILE] }) : new Response(PATCH);
  });
  expect((await client.diff(signal)).complete).toBe(true);
  expect(requests).toHaveLength(3);
});
