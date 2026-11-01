import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { commentBody, MARKER, run, SIGNATURES_BRANCH, SIGNATURES_PATH, signersOf, signs } from './cla.mjs';

const repo = { owner: 'brandonmcconnell', repo: 'geld' };
const repository = { default_branch: 'main', html_url: 'https://github.com/brandonmcconnell/geld' };
const hunter = { login: 'hunterchen7', id: 101, type: 'User' };
const batuhan = { login: 'Batuhan1999', id: 102, type: 'User' };
const brandon = { login: 'brandonmcconnell', id: 1, type: 'User' };
const cursorBot = { login: 'cursor[bot]', id: 3, type: 'Bot' };
const actions = { login: 'github-actions[bot]', id: 41898282, type: 'Bot' };

/** A commit author or co-author as GraphQL's `Commit.authors` gives one. */
const actor = (user) => ({ name: user.login, email: `${user.login}@example.com`, user: { login: user.login, databaseId: user.id } });
const unlinked = (name, email) => ({ name, email, user: null });

/** The agreement's history on main: CLA.md v1 from Nov 1, v2 from Dec 1. */
const AGREEMENT = [
  { since: '2026-12-01T00:00:00Z', commit: 'c2', blob: 'cla-v2' },
  { since: '2026-11-01T00:00:00Z', commit: 'c1', blob: 'cla-v1' },
];

function httpError(status) {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

/** Just enough of Octokit for scripts/cla.mjs, backed by maps. `commits` maps a pull request to its commits' author lists. */
function fakeGitHub({ commits = {}, comments = {}, pulls = {}, signatures } = {}) {
  const files = new Map(AGREEMENT.map((version) => [`${version.commit}:CLA.md`, { sha: version.blob, content: '' }]));
  const refs = new Set();
  if (signatures) {
    refs.add(SIGNATURES_BRANCH);
    files.set(`${SIGNATURES_BRANCH}:${SIGNATURES_PATH}`, { sha: 's0', content: JSON.stringify({ signatures }) });
  }
  const statuses = [];
  const reactions = [];
  const locks = [];
  let nextId = 900;
  let writes = 0;
  const github = {
    paginate: async (method, params) => method(params).then((response) => response.data),
    graphql: async (_query, { number }) => ({
      repository: {
        pullRequest: {
          commits: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: (commits[number] ?? []).map((authors) => ({ commit: { authors: { nodes: authors } } })),
          },
        },
      },
    }),
    rest: {
      pulls: {
        get: async ({ pull_number }) => ({ data: pulls[pull_number] }),
      },
      issues: {
        listComments: async ({ issue_number }) => ({ data: comments[issue_number] ?? [] }),
        createComment: async ({ issue_number, body }) => {
          const comment = { id: nextId++, user: actions, body };
          (comments[issue_number] ??= []).push(comment);
          return { data: comment };
        },
        updateComment: async ({ comment_id, body }) => {
          for (const list of Object.values(comments)) for (const comment of list) if (comment.id === comment_id) comment.body = body;
          return { data: {} };
        },
        lock: async ({ issue_number }) => {
          locks.push(issue_number);
          return { data: {} };
        },
      },
      repos: {
        listCommits: async ({ until }) => ({ data: AGREEMENT.filter((version) => version.since <= until).slice(0, 1).map((version) => ({ sha: version.commit })) }),
        getContent: async ({ path, ref }) => {
          const file = files.get(`${ref}:${path}`);
          if (!file) throw httpError(404);
          return { data: { sha: file.sha, content: Buffer.from(file.content, 'utf8').toString('base64') } };
        },
        createOrUpdateFileContents: async ({ branch, path, content, sha }) => {
          const key = `${branch}:${path}`;
          if (files.get(key)?.sha !== sha) throw httpError(409);
          writes++;
          files.set(key, { sha: `s${writes}`, content: Buffer.from(content, 'base64').toString('utf8') });
          return { data: {} };
        },
        createCommitStatus: async (status) => {
          statuses.push(status);
          return { data: {} };
        },
      },
      git: {
        getRef: async ({ ref }) => {
          if (!refs.has(ref.replace('heads/', ''))) throw httpError(404);
          return { data: {} };
        },
        createBlob: async () => ({ data: { sha: 'blob' } }),
        createTree: async () => ({ data: { sha: 'tree' } }),
        createCommit: async () => ({ data: { sha: 'commit' } }),
        createRef: async ({ ref }) => {
          refs.add(ref.replace('refs/heads/', ''));
          files.set(`${SIGNATURES_BRANCH}:${SIGNATURES_PATH}`, { sha: 's0', content: JSON.stringify({ signatures: [] }) });
          return { data: {} };
        },
      },
      reactions: {
        createForIssueComment: async ({ comment_id, content }) => {
          reactions.push({ comment_id, content });
          return { data: {} };
        },
      },
    },
  };
  const recorded = () => {
    const file = files.get(`${SIGNATURES_BRANCH}:${SIGNATURES_PATH}`);
    return file ? JSON.parse(file.content).signatures : [];
  };
  return { github, statuses, reactions, comments, locks, recorded };
}

const core = { info() {} };
const pullRequest = (number, { by = brandon, merged = false } = {}) => ({
  number,
  state: merged ? 'closed' : 'open',
  merged_at: merged ? '2026-10-30T12:00:00Z' : null,
  locked: false,
  user: by,
  head: { sha: `head-${number}` },
});
const prEvent = (pull) => ({ eventName: 'pull_request_target', repo, payload: { repository, pull_request: pull } });
const commentEvent = (issue, comment) => ({ eventName: 'issue_comment', repo, payload: { repository, issue, comment } });
const signing = (user, id = 500, at = '2026-11-01T14:00:00Z', editedAt = at) => ({
  id,
  user,
  body: 'I have read the Geld CLA and I agree to it.',
  created_at: at,
  updated_at: editedAt,
  html_url: `https://github.com/brandonmcconnell/geld/pull/128#issuecomment-${id}`,
});

describe('signs', () => {
  it('accepts the sentence however it is quoted or cased', () => {
    assert.ok(signs('I have read the Geld CLA and I agree to it.'));
    assert.ok(signs('> i have read the geld cla and I agree to it'));
    assert.ok(signs('Sure!\n\n**I have read the Geld CLA and\nI agree to it.**'));
  });
  it('rejects anything short of it', () => {
    assert.ok(!signs('I have read the Geld CLA'));
    assert.ok(!signs('I have not read the Geld CLA and I agree to it'));
    assert.ok(!signs(undefined));
  });
});

describe('signersOf', () => {
  it('skips the owner, the agents and bots, and keeps accounts and unclaimed emails apart', () => {
    const { accounts, unlinked: emails } = signersOf(
      [
        actor(hunter),
        actor(hunter),
        actor(brandon),
        actor({ login: 'cursoragent', id: 2 }),
        unlinked('github-actions[bot]', '41898282+github-actions[bot]@users.noreply.github.com'),
        unlinked('Claude Opus 5.5', 'noreply@anthropic.com'),
        unlinked('Someone', 'someone@example.com'),
      ],
      brandon,
    );
    assert.deepEqual(accounts.map((account) => account.login), ['hunterchen7']);
    assert.deepEqual(emails.map((author) => author.email), ['someone@example.com']);
  });

  it('reads an account from its noreply address', () => {
    const { accounts } = signersOf([unlinked('Batuhan', '102+Batuhan1999@users.noreply.github.com')], brandon);
    assert.deepEqual(accounts, [{ login: 'Batuhan1999', id: 102 }]);
  });

  it('needs the opener even when every commit claims an exempt author', () => {
    const { accounts } = signersOf([actor(brandon), unlinked('Cursor Agent', 'cursoragent@cursor.com')], batuhan);
    assert.deepEqual(accounts.map((account) => account.login), ['Batuhan1999']);
  });

  it('exempts a pull request a bot opened', () => {
    assert.deepEqual(signersOf([actor(brandon)], cursorBot).accounts, []);
  });
});

describe('a pull request', () => {
  it('passes with no comment when only the owner and bots wrote it', async () => {
    const fake = fakeGitHub({ commits: { 7: [[actor(brandon)], [actor(actions)]] } });
    await run({ github: fake.github, context: prEvent(pullRequest(7)), core });
    assert.equal(fake.statuses.at(-1).state, 'success');
    assert.equal(fake.comments[7], undefined);
  });

  it('asks an outside author to sign, then passes once they do', async () => {
    const pull = pullRequest(140, { by: hunter });
    const fake = fakeGitHub({ commits: { 140: [[actor(hunter)], [actor(brandon)]] }, pulls: { 140: pull } });
    await run({ github: fake.github, context: prEvent(pull), core });
    assert.equal(fake.statuses.at(-1).state, 'failure');
    assert.match(fake.statuses.at(-1).description, /@hunterchen7/);
    assert.ok(fake.comments[140][0].body.startsWith(MARKER));
    assert.match(fake.comments[140][0].body, /Waiting on: @hunterchen7/);

    const comment = signing(hunter);
    fake.comments[140].push(comment);
    await run({ github: fake.github, context: commentEvent({ number: 140, pull_request: {} }, comment), core });
    assert.equal(fake.statuses.at(-1).state, 'success');
    assert.equal(fake.comments[140].length, 2);
    assert.match(fake.comments[140][0].body, /has signed/);
    assert.deepEqual(
      fake.recorded().map((signature) => [signature.login, signature.agreementSha, signature.comment]),
      [['hunterchen7', 'cla-v1', comment.html_url]],
    );
    assert.deepEqual(fake.reactions, [{ comment_id: comment.id, content: 'rocket' }]);
  });

  it('needs a co-author on an owner\'s commit', async () => {
    const fake = fakeGitHub({ commits: { 145: [[actor(brandon), actor(batuhan)]] } });
    await run({ github: fake.github, context: prEvent(pullRequest(145)), core });
    assert.equal(fake.statuses.at(-1).state, 'failure');
    assert.match(fake.comments[145][0].body, /Waiting on: @Batuhan1999/);
  });

  it('needs an outside opener whose commits claim the owner', async () => {
    const fake = fakeGitHub({ commits: { 146: [[actor(brandon)]] } });
    await run({ github: fake.github, context: prEvent(pullRequest(146, { by: batuhan })), core });
    assert.equal(fake.statuses.at(-1).state, 'failure');
    assert.match(fake.statuses.at(-1).description, /@Batuhan1999/);
  });

  it('picks up a signature whose own run never happened, against the agreement of its time', async () => {
    const fake = fakeGitHub({ commits: { 141: [[actor(batuhan)]] }, comments: { 141: [signing(batuhan, 501, '2026-11-20T10:00:00Z')] }, signatures: [] });
    await run({ github: fake.github, context: prEvent({ ...pullRequest(141, { by: batuhan }), merged_at: null }), core });
    assert.equal(fake.statuses.at(-1).state, 'success');
    assert.deepEqual(fake.recorded().map((signature) => [signature.login, signature.agreementSha]), [['Batuhan1999', 'cla-v1']]);
  });

  it('records the later agreement for a comment written after it changed', async () => {
    const fake = fakeGitHub({ commits: { 147: [[actor(hunter)]] }, comments: { 147: [signing(hunter, 507, '2026-12-05T10:00:00Z')] }, signatures: [] });
    await run({ github: fake.github, context: prEvent(pullRequest(147, { by: hunter })), core });
    assert.deepEqual(fake.recorded().map((signature) => signature.agreementSha), ['cla-v2']);
  });

  it('dates a signature edited into an older comment by its edit', async () => {
    const comment = { ...signing(hunter, 508, '2026-10-20T10:00:00Z', '2026-11-03T09:00:00Z') };
    const fake = fakeGitHub({ commits: { 148: [[actor(hunter)]] }, comments: { 148: [comment] }, signatures: [] });
    await run({ github: fake.github, context: prEvent(pullRequest(148, { by: hunter })), core });
    assert.deepEqual(fake.recorded().map((signature) => [signature.signedAt, signature.agreementSha]), [['2026-11-03T09:00:00Z', 'cla-v1']]);
  });

  it('ignores the sentence in a comment from before there was an agreement', async () => {
    const fake = fakeGitHub({ commits: { 149: [[actor(hunter)]] }, comments: { 149: [signing(hunter, 509, '2026-10-20T10:00:00Z')] }, signatures: [] });
    await run({ github: fake.github, context: prEvent(pullRequest(149, { by: hunter })), core });
    assert.equal(fake.statuses.at(-1).state, 'failure');
    assert.deepEqual(fake.recorded(), []);
  });

  it('does not count someone else posting the sentence for an author', async () => {
    const fake = fakeGitHub({ commits: { 142: [[actor(hunter)]] }, comments: { 142: [signing(batuhan, 502)] }, signatures: [] });
    await run({ github: fake.github, context: prEvent(pullRequest(142, { by: hunter })), core });
    assert.equal(fake.statuses.at(-1).state, 'failure');
  });

  it('records a past contributor signing on a merged pull request, adds no comment and locks it', async () => {
    const pull = pullRequest(128, { by: hunter, merged: true });
    const comment = signing(hunter, 503);
    const fake = fakeGitHub({ commits: { 128: [[actor(hunter)], [actor({ login: 'cursoragent', id: 2 })]] }, comments: { 128: [comment] }, pulls: { 128: pull } });
    await run({ github: fake.github, context: commentEvent({ number: 128, pull_request: {} }, comment), core });
    assert.deepEqual(fake.recorded().map((signature) => signature.login), ['hunterchen7']);
    assert.equal(fake.comments[128].length, 1);
    assert.deepEqual(fake.locks, [128]);
  });

  it('leaves a merged pull request open while an author has yet to sign, and the owner\'s own alone', async () => {
    const fake = fakeGitHub({ commits: { 96: [[actor(batuhan)]], 136: [[actor(brandon)]] }, signatures: [] });
    await run({ github: fake.github, context: prEvent(pullRequest(96, { by: batuhan, merged: true })), core });
    await run({ github: fake.github, context: prEvent(pullRequest(136, { merged: true })), core });
    assert.deepEqual(fake.locks, []);
  });

  it('locks a pull request when it merges with every author signed', async () => {
    const fake = fakeGitHub({ commits: { 144: [[actor(hunter)]] }, signatures: [{ login: 'hunterchen7', id: 101 }] });
    await run({ github: fake.github, context: prEvent(pullRequest(144, { by: hunter })), core });
    assert.deepEqual(fake.locks, []);
    await run({ github: fake.github, context: prEvent(pullRequest(144, { by: hunter, merged: true })), core });
    assert.deepEqual(fake.locks, [144]);
  });

  it('tells an author whose email no account claims what to do', async () => {
    const fake = fakeGitHub({ commits: { 143: [[unlinked('Someone', 'someone@example.com')]] } });
    await run({ github: fake.github, context: prEvent(pullRequest(143)), core });
    assert.equal(fake.statuses.at(-1).state, 'failure');
    assert.match(fake.comments[143][0].body, /someone@example\.com/);
  });
});

describe('an issue', () => {
  it('records whoever signs there, once', async () => {
    const fake = fakeGitHub({ signatures: [] });
    const comment = signing(batuhan, 504);
    await run({ github: fake.github, context: commentEvent({ number: 150 }, comment), core });
    await run({ github: fake.github, context: commentEvent({ number: 150 }, { ...comment, id: 505 }), core });
    assert.deepEqual(fake.recorded().map((signature) => signature.login), ['Batuhan1999']);
    assert.equal(fake.reactions.length, 1);
  });

  it('ignores the owner quoting the sentence', async () => {
    const fake = fakeGitHub({ signatures: [] });
    await run({ github: fake.github, context: commentEvent({ number: 150 }, signing(brandon, 506)), core });
    assert.deepEqual(fake.recorded(), []);
    assert.deepEqual(fake.reactions, []);
  });
});

describe('commentBody', () => {
  it('quotes the sentence to post and names who is left', () => {
    const body = commentBody({ pending: [hunter, batuhan], unlinked: [], agreementUrl: 'https://example.com/CLA.md' });
    assert.match(body, /> I have read the Geld CLA and I agree to it\./);
    assert.match(body, /Waiting on: @hunterchen7, @Batuhan1999/);
  });
});
