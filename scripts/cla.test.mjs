import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { authorsOf, commentBody, MARKER, run, SIGNATURES_BRANCH, SIGNATURES_PATH, signs } from './cla.mjs';

const repo = { owner: 'brandonmcconnell', repo: 'geld' };
const repository = { default_branch: 'main', html_url: 'https://github.com/brandonmcconnell/geld' };
const hunter = { login: 'hunterchen7', id: 101, type: 'User' };
const batuhan = { login: 'Batuhan1999', id: 102, type: 'User' };
const brandon = { login: 'brandonmcconnell', id: 1, type: 'User' };
const actions = { login: 'github-actions[bot]', id: 41898282, type: 'Bot' };

const commitBy = (user) => ({ author: user, commit: { author: { name: user.login, email: `${user.login}@example.com` } } });
const unlinkedCommit = (name, email) => ({ author: null, commit: { author: { name, email } } });

function httpError(status) {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

/** Just enough of Octokit for scripts/cla.mjs, backed by maps. */
function fakeGitHub({ commits = {}, comments = {}, pulls = {}, signatures } = {}) {
  const files = new Map([[`main:CLA.md`, { sha: 'cla-v1', content: '' }]]);
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
    rest: {
      pulls: {
        listCommits: async ({ pull_number }) => ({ data: commits[pull_number] ?? [] }),
        get: async ({ pull_number }) => ({ data: pulls[pull_number] }),
      },
      issues: {
        listComments: async ({ issue_number }) => ({ data: comments[issue_number] ?? [] }),
        createComment: async ({ issue_number, body }) => {
          const comment = { id: nextId++, user: actions, body };
          (comments[issue_number] ??= []).push(comment);
          return { data: comment };
        },
        lock: async ({ issue_number }) => {
          locks.push(issue_number);
          return { data: {} };
        },
        updateComment: async ({ comment_id, body }) => {
          for (const list of Object.values(comments)) for (const comment of list) if (comment.id === comment_id) comment.body = body;
          return { data: {} };
        },
      },
      repos: {
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
        createBlob: async ({ content }) => ({ data: { sha: 'blob', content } }),
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
const pullRequest = (number, state = 'open') => ({
  number,
  state,
  merged_at: state === 'merged' ? '2026-10-30T12:00:00Z' : null,
  locked: false,
  head: { sha: `head-${number}` },
});
const prEvent = (pull) => ({ eventName: 'pull_request_target', repo, payload: { repository, pull_request: pull } });
const commentEvent = (issue, comment) => ({ eventName: 'issue_comment', repo, payload: { repository, issue, comment } });
const signing = (user, id = 500) => ({
  id,
  user,
  body: 'I have read the Geld CLA and I agree to it.',
  created_at: '2026-11-01T14:00:00Z',
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

describe('authorsOf', () => {
  it('skips the owner, the agent and bots, and keeps accounts and unclaimed emails apart', () => {
    const { accounts, unlinked } = authorsOf([
      commitBy(hunter),
      commitBy(hunter),
      commitBy(brandon),
      commitBy({ login: 'cursoragent', id: 2, type: 'User' }),
      commitBy(actions),
      commitBy({ login: 'renovate', id: 3, type: 'Bot' }),
      unlinkedCommit('Someone', 'someone@example.com'),
      unlinkedCommit('Cursor Agent', 'cursoragent@cursor.com'),
    ]);
    assert.deepEqual(accounts.map((account) => account.login), ['hunterchen7']);
    assert.deepEqual(unlinked.map((author) => author.email), ['someone@example.com']);
  });
});

describe('a pull request', () => {
  it('passes with no comment when only the owner and bots wrote it', async () => {
    const fake = fakeGitHub({ commits: { 7: [commitBy(brandon), commitBy(actions)] } });
    await run({ github: fake.github, context: prEvent(pullRequest(7)), core });
    assert.equal(fake.statuses.at(-1).state, 'success');
    assert.equal(fake.comments[7], undefined);
  });

  it('asks an outside author to sign, then passes once they do', async () => {
    const pull = pullRequest(140);
    const fake = fakeGitHub({ commits: { 140: [commitBy(hunter), commitBy(brandon)] }, pulls: { 140: pull } });
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

  it('picks up a signature whose own run never happened', async () => {
    const pull = pullRequest(141);
    const fake = fakeGitHub({ commits: { 141: [commitBy(batuhan)] }, comments: { 141: [signing(batuhan, 501)] }, signatures: [] });
    await run({ github: fake.github, context: prEvent(pull), core });
    assert.equal(fake.statuses.at(-1).state, 'success');
    assert.deepEqual(fake.recorded().map((signature) => signature.login), ['Batuhan1999']);
  });

  it('does not count someone else posting the sentence for an author', async () => {
    const pull = pullRequest(142);
    const fake = fakeGitHub({ commits: { 142: [commitBy(hunter)] }, comments: { 142: [signing(batuhan, 502)] }, signatures: [] });
    await run({ github: fake.github, context: prEvent(pull), core });
    assert.equal(fake.statuses.at(-1).state, 'failure');
  });

  it('records a past contributor signing on a merged pull request without commenting there', async () => {
    const pull = pullRequest(128, 'merged');
    const comment = signing(hunter, 503);
    const fake = fakeGitHub({
      commits: { 128: [commitBy(hunter), commitBy({ login: 'cursoragent', id: 2, type: 'User' })] },
      comments: { 128: [comment] },
      pulls: { 128: pull },
    });
    await run({ github: fake.github, context: commentEvent({ number: 128, pull_request: {} }, comment), core });
    assert.deepEqual(fake.recorded().map((signature) => signature.login), ['hunterchen7']);
    assert.equal(fake.comments[128].length, 1);
    assert.deepEqual(fake.locks, [128]);
  });

  it('leaves a merged pull request open while an author has yet to sign, and the owner\'s own alone', async () => {
    const fake = fakeGitHub({ commits: { 96: [commitBy(batuhan)], 136: [commitBy(brandon)] }, signatures: [] });
    await run({ github: fake.github, context: prEvent(pullRequest(96, 'merged')), core });
    await run({ github: fake.github, context: prEvent(pullRequest(136, 'merged')), core });
    assert.deepEqual(fake.locks, []);
  });

  it('locks a pull request when it merges with every author signed', async () => {
    const fake = fakeGitHub({ commits: { 144: [commitBy(hunter)] }, signatures: [{ login: 'hunterchen7', id: 101 }] });
    await run({ github: fake.github, context: prEvent(pullRequest(144)), core });
    assert.deepEqual(fake.locks, []);
    await run({ github: fake.github, context: prEvent(pullRequest(144, 'merged')), core });
    assert.deepEqual(fake.locks, [144]);
  });

  it('tells an author whose email no account claims what to do', async () => {
    const fake = fakeGitHub({ commits: { 143: [unlinkedCommit('Someone', 'someone@example.com')] } });
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
