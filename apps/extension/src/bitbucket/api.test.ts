import { describe, expect, it } from 'vitest';
import { BitbucketApiError, BitbucketClient, bitbucketCapabilities } from './api';
import { describeBitbucketPage } from './page';

const ORIGIN = 'https://api.bitbucket.org';
const ROOT = '/2.0/repositories/acme/widgets/pullrequests/42';
const DATE = '2026-11-01T12:00:00Z';
const HEAD = 'b'.repeat(40);
const BASE = 'a'.repeat(40);
const PR = { id: 42, title: 'A review', state: 'OPEN', source: { commit: { hash: HEAD } }, destination: { commit: { hash: BASE } }, author: null, participants: [] };
const USER = { uuid: '{account-uuid}', nickname: 'reviewer', display_name: 'A reviewer' };
const TEST = { status: 'added', old: null, new: { path: 'src/a.test.ts' }, lines_added: 1, lines_removed: 0 };
const SOURCE = { status: 'added', old: null, new: { path: 'src/a.ts' }, lines_added: 1, lines_removed: 0 };
const PATCH = 'diff --git a/src/a.test.ts b/src/a.test.ts\nnew file mode 100644\n--- /dev/null\n+++ b/src/a.test.ts\n@@ -0,0 +1 @@\n+test("works", () => {});\ndiff --git a/src/a.ts b/src/a.ts\nnew file mode 100644\n--- /dev/null\n+++ b/src/a.ts\n@@ -0,0 +1 @@\n+export const result = 1;\n';

function comparison(resource: 'diff' | 'diffstat'): string {
  return `${ORIGIN}/2.0/repositories/acme/widgets/${resource}/acme/widgets:${HEAD}%0D${BASE}?from_pullrequest_id=42&topic=true${resource === 'diffstat' ? '&pagelen=100' : ''}`;
}

function json(value: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function setup(handler: (url: URL, init: RequestInit | undefined) => Response | Promise<Response>): { client: BitbucketClient; requests: string[] } {
  const page = describeBitbucketPage(new URL('https://bitbucket.org/acme/widgets/pull-requests/42'));
  if (page === null) throw new Error('Invalid fixture page');
  const requests: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    requests.push(url.href);
    return handler(url, init);
  };
  return { client: new BitbucketClient(page, fetcher), requests };
}

const signal = (): AbortSignal => new AbortController().signal;

describe('Bitbucket Cloud page identity', () => {
  it('keeps overview, diff and other review tabs distinct', () => {
    const overview = describeBitbucketPage(new URL('https://bitbucket.org/acme/widgets/pull-requests/42'));
    expect(overview).toMatchObject({ provider: 'bitbucket', number: '42', kind: 'overview', headSha: null, version: 'current', repository: { provider: 'bitbucket', origin: 'https://bitbucket.org', path: 'acme/widgets' } });
    expect(overview?.diffUrl).toBe(`${ORIGIN}${ROOT}/diff`);
    expect(describeBitbucketPage(new URL('https://bitbucket.org/acme/widgets/pull-requests/42/diff'))?.kind).toBe('diff');
    expect(describeBitbucketPage(new URL('https://bitbucket.org/acme/widgets/pull-requests/42/commits'))?.kind).toBe('other');
  });

  it('does not mistake lists, unsupported paths, credentials or other hosts for a review', () => {
    for (const url of [
      'https://bitbucket.org/acme/widgets/pull-requests/',
      'https://bitbucket.org/acme/widgets/pull-requests/0',
      'https://bitbucket.org/acme/widgets/pull-requests/42/settings',
      'https://user:secret@bitbucket.org/acme/widgets/pull-requests/42',
      'https://gitlab.com/acme/widgets/pull-requests/42',
      'https://example.com/acme/widgets/pull-requests/42',
    ]) expect(describeBitbucketPage(new URL(url))).toBeNull();
  });
});

describe('Bitbucket diff acquisition from documented API shapes', () => {
  it('resolves native abbreviated refs to full immutable commits before publishing review data', async () => {
    const head = '9777bca47119a91758bde1209ac14e6076ffbf23';
    const base = 'c522201d16c0142bd10bf7e606e72851d9669eb0';
    const repoPath = '/2.0/repositories/acme/widgets';
    const short = { ...PR, source: { repository: { full_name: 'acme/widgets' }, commit: { hash: head.slice(0, 12), links: { self: { href: `${ORIGIN}${repoPath}/commit/${head.slice(0, 12)}` } } } }, destination: { repository: { full_name: 'acme/widgets' }, commit: { hash: base.slice(0, 12) } } };
    const requestSignal = signal();
    const { client, requests } = setup((url, init) => {
      expect(init?.signal).toBe(requestSignal);
      if (url.pathname === ROOT) return json(short);
      if (url.pathname === `${repoPath}/commit/${head.slice(0, 12)}`) return json({ hash: head });
      if (url.pathname === `${repoPath}/commit/${base.slice(0, 12)}`) return json({ hash: base });
      throw new Error(`Unexpected URL ${url}`);
    });
    expect(await client.pullRequest(requestSignal)).toMatchObject({ headSha: head, baseSha: base });
    expect(requests).toHaveLength(3);
  });

  it('resolves a fork head in its source repository without following arbitrary commit links', async () => {
    const prefix = HEAD.slice(0, 12);
    const source = { repository: { full_name: 'contributor/fork' }, commit: { hash: prefix } };
    const { client, requests } = setup((url) => url.pathname === ROOT ? json({ ...PR, source }) : json({ hash: HEAD }));
    expect((await client.pullRequest(signal())).headSha).toBe(HEAD);
    expect(requests[1]).toBe(`${ORIGIN}/2.0/repositories/contributor/fork/commit/${prefix}?fields=hash`);
    for (const source of [
      { repository: { full_name: '../private' }, commit: { hash: prefix } },
      { repository: { full_name: 'contributor/fork' }, commit: { hash: prefix, links: { self: { href: 'https://example.com/commit' } } } },
      { commit: { hash: prefix } },
    ]) {
      const bad = setup(() => json({ ...PR, source }));
      await expect(bad.client.pullRequest(signal())).rejects.toMatchObject({ reason: 'invalid-response' });
      expect(bad.requests).toHaveLength(1);
    }
  });

  it('rejects short-ref mismatches and re-resolves each snapshot instead of caching an ambiguous prefix', async () => {
    const prefix = 'abcdef012345';
    const original = prefix + 'a'.repeat(28);
    const changed = prefix + 'b'.repeat(28);
    let resolutions = 0;
    const short = { ...PR, source: { repository: { full_name: 'acme/widgets' }, commit: { hash: prefix } } };
    const { client } = setup((url) => {
      if (url.pathname === ROOT) return json(short);
      if (url.pathname.includes('/commit/')) return json({ hash: ++resolutions === 1 ? original : changed });
      return url.pathname.includes('/diffstat/') ? json({ size: 2, values: [TEST, SOURCE] }) : new Response(PATCH);
    });
    await expect(client.diff(signal())).rejects.toMatchObject({ reason: 'changed' });
    expect(resolutions).toBe(2);
    for (const hash of ['c'.repeat(40), prefix, prefix + 'a'.repeat(29)]) {
      const bad = setup((url) => json(url.pathname === ROOT ? short : { hash }));
      await expect(bad.client.pullRequest(signal())).rejects.toMatchObject({ reason: 'invalid-response' });
    }
    const wrongDestination = setup(() => json({ ...PR, destination: { repository: { full_name: 'other/repository' }, commit: { hash: BASE } } }));
    await expect(wrongDestination.client.pullRequest(signal())).rejects.toMatchObject({ reason: 'invalid-response' });
  });

  it('paginates file inventory, verifies revisions and retains parser facts', async () => {
    const requestSignal = signal();
    const { client, requests } = setup((url, init) => {
      expect(init?.signal).toBe(requestSignal);
      expect(init?.credentials).toBe('omit');
      expect(init?.redirect).toBe('manual');
      if (url.pathname === ROOT) return json(PR);
      if (url.pathname === new URL(comparison('diff')).pathname) return new Response(PATCH, { headers: { 'content-type': 'text/plain' } });
      if (url.pathname === new URL(comparison('diffstat')).pathname && url.searchParams.get('page') === '2') return json({ size: 2, values: [SOURCE] });
      if (url.pathname === new URL(comparison('diffstat')).pathname) return json({ size: 2, values: [TEST], next: `${comparison('diffstat')}&page=2` });
      throw new Error(`Unexpected URL ${url}`);
    });
    const result = await client.diff(requestSignal);
    expect(result.complete).toBe(true);
    expect(result.revision).toBe(`${BASE}..${HEAD}`);
    expect(result.files).toEqual([{ path: 'src/a.test.ts', additions: 1, deletions: 0, status: 'added' }, { path: 'src/a.ts', additions: 1, deletions: 0, status: 'added' }]);
    expect(result.patches?.get('src/a.test.ts')).toContain('test("works"');
    expect(requests.filter((url) => new URL(url).pathname === ROOT)).toHaveLength(2);
  });

  it('keeps omitted patches incomplete while preserving authoritative counts', async () => {
    const { client } = setup((url) => url.pathname === ROOT ? json(PR) : url.pathname.includes('/diffstat/') ? json({ size: 2, values: [TEST, SOURCE] }) : new Response(PATCH.split('diff --git a/src/a.ts')[0], { headers: { 'content-type': 'text/plain' } }));
    const result = await client.diff(signal());
    expect(result.complete).toBe(false);
    expect(result.files).toHaveLength(2);
    expect(result.files[1]).toMatchObject({ path: 'src/a.ts', additions: 1, deletions: 0 });
  });

  it('does not cache a moving review as a single revision', async () => {
    let reads = 0;
    const { client } = setup((url) => {
      if (url.pathname === ROOT) return json(++reads === 1 ? PR : { ...PR, source: { commit: { hash: 'c'.repeat(40) } } });
      return url.pathname.includes('/diffstat/') ? json({ size: 2, values: [TEST, SOURCE] }) : new Response(PATCH);
    });
    await expect(client.diff(signal())).rejects.toMatchObject({ reason: 'changed' });
  });

  it('rejects opaque browser redirects without following an unreadable destination', async () => {
    const opaque = new Response(null);
    Object.defineProperties(opaque, { type: { value: 'opaqueredirect' }, status: { value: 0 } });
    const { client, requests } = setup((url) => url.pathname === ROOT ? json(PR) : opaque);
    await expect(client.diff(signal())).rejects.toMatchObject({ reason: 'invalid-response' });
    expect(requests.every((url) => !new URL(url).pathname.endsWith('/pullrequests/42/diff'))).toBe(true);
    const foreign = setup((url) => url.pathname === ROOT ? json(PR) : url.pathname.includes('/diffstat/') ? json({ values: [] }) : new Response(null, { status: 302, headers: { location: 'https://example.com/private' } }));
    await expect(foreign.client.diff(signal())).rejects.toMatchObject({ reason: 'invalid-response' });
    expect(foreign.requests.every((url) => new URL(url).origin === ORIGIN)).toBe(true);
  });

  it('requests full pinned comparison resources directly and paginates without changing selection', async () => {
    const canonical = comparison('diffstat');
    const { client, requests } = setup((url) => {
      if (url.pathname === ROOT) return json(PR);
      if (url.pathname.includes('/diffstat/')) return url.searchParams.has('page') ? json({ size: 2, values: [SOURCE] }) : json({ size: 2, values: [TEST], next: `${canonical}&page=2` });
      return new Response(PATCH, { headers: { 'content-type': 'text/plain' } });
    });
    expect(await client.diff(signal())).toMatchObject({ complete: true, revision: `${BASE}..${HEAD}` });
    expect(requests).toContain(`${canonical}&page=2`);
    expect(requests).toContain(comparison('diff'));
    expect(requests).not.toContain(`${ORIGIN}${ROOT}/diff`);
    expect(requests).not.toContain(`${ORIGIN}${ROOT}/diffstat?pagelen=100`);
  });

  it('rejects pagination that changes the pinned refs, repository, review or comparison mode', async () => {
    const canonical = comparison('diffstat');
    for (const next of [
      canonical.replace(HEAD, 'c'.repeat(40)),
      canonical.replace('from_pullrequest_id=42', 'from_pullrequest_id=43'),
      canonical.replace('topic=true', 'topic=false'),
      canonical.replace('&topic=true', ''),
      canonical.replace('/repositories/acme/widgets/', '/repositories/other/repo/'),
      `${canonical}&q=hidden`,
    ]) {
      const { client, requests } = setup((url) => {
        if (url.pathname === ROOT) return json(PR);
        if (url.pathname.includes('/diffstat/')) return json({ values: [TEST], next });
        return new Response(PATCH);
      });
      await expect(client.diff(signal())).rejects.toMatchObject({ reason: 'invalid-response' });
      expect(requests).not.toContain(next);
    }
  });

});

describe('Bitbucket API trust and availability', () => {
  it('separates authorization and rate limiting from empty collections', async () => {
    for (const [status, reason] of [[401, 'authentication'], [403, 'forbidden'], [503, 'unavailable']] as const) {
      const { client } = setup(() => json({}, status));
      await expect(client.comments(signal())).rejects.toMatchObject({ reason });
    }
    const blocked = setup(() => json({}, 429, { 'retry-after': '12' }));
    await expect(blocked.client.comments(signal())).rejects.toMatchObject({ reason: 'rate-limited', retryAfterMs: 12_000 });
    const empty = setup(() => json({ values: [], size: 0 }));
    expect(await empty.client.comments(signal())).toEqual([]);
  });

  it('rejects login HTML and malformed data even with a successful HTTP status', async () => {
    for (const response of [new Response('<!doctype html><html>Sign in</html>', { headers: { 'content-type': 'text/html' } }), json({}), json({ values: [{ id: 'not-a-number' }] })]) {
      const { client } = setup(() => response);
      await expect(client.comments(signal())).rejects.toBeInstanceOf(BitbucketApiError);
    }
  });

  it('rejects hostile pagination and repeated or incomplete pages', async () => {
    for (const next of ['https://example.com/steal', `${ORIGIN}/2.0/repositories/other/private/pullrequests/42/comments`, `${ORIGIN}${ROOT}/tasks`]) {
      const { client, requests } = setup(() => json({ values: [], next }));
      await expect(client.comments(signal())).rejects.toMatchObject({ reason: 'invalid-response' });
      expect(requests).toHaveLength(1);
    }
    const repeated = setup(() => json({ values: [], next: `${ORIGIN}${ROOT}/comments?pagelen=100` }));
    await expect(repeated.client.comments(signal())).rejects.toMatchObject({ reason: 'incomplete' });
    const incomplete = setup(() => json({ values: [], size: 2 }));
    await expect(incomplete.client.comments(signal())).rejects.toMatchObject({ reason: 'incomplete' });
  });

  it('bounds responses before parsing or classifying them', async () => {
    const { client } = setup(() => new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': String(6 * 1024 * 1024) } }));
    await expect(client.comments(signal())).rejects.toMatchObject({ reason: 'incomplete' });
  });

  it('keeps native comment resolution, tasks and build statuses distinct', async () => {
    const { client } = setup((url) => {
      if (url.pathname.endsWith('/comments')) return json({ values: [{ id: 10, parent: null, user: USER, content: { raw: 'A finding' }, created_on: DATE, updated_on: DATE, deleted: false, inline: { path: 'src/a.ts', from: null, to: 5 }, resolution: { resolved_on: DATE } }] });
      if (url.pathname.endsWith('/tasks')) return json({ values: [{ id: 11, content: { raw: 'Follow up' }, state: 'OPEN', comment: { id: 10 }, creator: USER }] });
      if (url.pathname.endsWith('/activity')) return json({ values: [{ changes_requested: { user: USER, date: DATE } }, { comment: { id: 10, user: USER, created_on: DATE } }] });
      return json({ values: [{ key: 'ci', name: 'Pipeline', state: 'INPROGRESS', created_on: DATE, updated_on: DATE, url: 'https://bitbucket.org/acme/widgets/pipelines/results/1' }] });
    });
    expect((await client.comments(signal()))[0]).toMatchObject({ id: 10, author: { id: USER.uuid }, resolved: true, line: 5, path: 'src/a.ts' });
    expect((await client.tasks(signal()))[0]).toMatchObject({ id: 11, state: 'OPEN', commentId: 10 });
    expect((await client.activity(signal()))[0]?.kind).toBe('changes-requested');
    expect((await client.statuses(signal()))[0]?.state).toBe('INPROGRESS');
    expect(bitbucketCapabilities(false).approve).toBe('unavailable');
    expect(bitbucketCapabilities(true).approve).toBe('unverified');
  });
});
