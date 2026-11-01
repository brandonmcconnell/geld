/**
 * The CLA check (`.github/workflows/cla.yml`), run by actions/github-script
 * from a checkout of the default branch, never the pull request's.
 *
 * A pull request passes when the person who opened it and every author and
 * co-author of its commits have signed `CLA.md`. Commit metadata is whatever
 * the pusher wrote, so an exempt author on a commit never exempts the pull
 * request: its opener, the one identity GitHub vouches for, signs unless they
 * are exempt themselves. Signing is a comment that says `SIGN_PHRASE` and
 * nothing else, on a pull request or an issue; each signature is kept on the unprotected
 * `cla-signatures` branch with the comment's words, its link and the blob SHA
 * of the agreement as it stood when the comment was written. A pull request's
 * check also reads its own comments, so a signature whose run was dropped is
 * picked up on the next one, and a new signature rechecks the open pull
 * requests whose check was waiting on its signer.
 */

export const SIGN_PHRASE = 'I have read the Geld CLA and I agree to it';
export const SIGNATURES_BRANCH = 'cla-signatures';
export const SIGNATURES_PATH = 'signatures.json';
export const AGREEMENT_PATH = 'CLA.md';
export const STATUS_CONTEXT = 'CLA';
export const MARKER = '<!-- geld:cla -->';

const ALLOWED_LOGINS = new Set(['brandonmcconnell', 'cursoragent']);
// Agents that co-author commits under a shared address no account can sign for.
const ALLOWED_EMAILS = new Set(['brandon@dreamthinkbuild.com', 'cursoragent@cursor.com', 'noreply@anthropic.com']);
const NOREPLY = /^(?:(\d+)\+)?([^@]+)@users\.noreply\.github\.com$/i;

const COMMIT_AUTHORS = `query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      commits(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes { commit { authors(first: 20) { nodes { name email user { login databaseId } } } } }
      }
    }
  }
}`;

const WAITING_PULLS = `query($owner: String!, $name: String!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, first: 100, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes { number commits(last: 1) { nodes { commit { status { context(name: "${STATUS_CONTEXT}") { state description } } } } } }
    }
  }
}`;

const PHRASE = SIGN_PHRASE.toLowerCase();

/**
 * Whether a comment signs: the sentence alone, however it was pasted (a code span or block, bold or italic, a closing
 * full stop). Words around it may refuse it, and a quotation is someone else's words, so neither signs.
 */
export function signs(body) {
  if (typeof body !== 'string') return false;
  const text = body
    .trim()
    .replace(/^```[^\n]*\n([\s\S]*?)\n?```$/, '$1')
    .trim()
    .replace(/\.$/, '')
    .replace(/^([`*_]+)([\s\S]*?)\1$/, '$2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.$/, '')
    .toLowerCase();
  return text === PHRASE;
}

export function isAllowed(person) {
  if (person.login) return ALLOWED_LOGINS.has(person.login) || person.login.endsWith('[bot]') || person.type === 'Bot';
  return ALLOWED_EMAILS.has((person.email ?? '').toLowerCase());
}

/** A commit author or co-author as GitHub resolves them: an account, or a name and an email no account claims. */
function personOf(actor) {
  if (actor.user) return { login: actor.user.login, id: actor.user.databaseId };
  const email = actor.email ?? '';
  const noreply = NOREPLY.exec(email);
  if (noreply?.[1]) return { login: noreply[2], id: Number(noreply[1]) };
  return { name: actor.name ?? '', email };
}

/**
 * Who a pull request needs a signature from: its opener, unless exempt, and every author and co-author of its
 * commits (`actors`, GraphQL `Commit.authors`, which reads the `Co-authored-by` trailers), as accounts and as
 * emails no account claims.
 */
export function signersOf(actors, opener) {
  const accounts = new Map();
  const unlinked = new Map();
  const people = actors.map(personOf);
  if (opener) people.unshift({ login: opener.login, id: opener.id, type: opener.type });
  for (const person of people) {
    if (isAllowed(person)) continue;
    if (person.login) accounts.set(person.id, person);
    else unlinked.set(person.email.toLowerCase(), person);
  }
  return { accounts: [...accounts.values()], unlinked: [...unlinked.values()] };
}

export function pendingAccounts(accounts, signatures) {
  const signed = new Set(signatures.map((signature) => signature.id));
  return accounts.filter((account) => !signed.has(account.id));
}

/** When the comment held the sentence: an edit may have added it, so an edited comment counts from its edit. */
export function signedAtOf(comment) {
  return comment.updated_at && comment.updated_at !== comment.created_at ? comment.updated_at : comment.created_at;
}

export function signatureFrom(comment, agreementSha) {
  return {
    login: comment.user.login,
    id: comment.user.id,
    signedAt: signedAtOf(comment),
    comment: comment.html_url,
    body: comment.body,
    agreementSha,
  };
}

export function commentBody({ pending, unlinked, agreementUrl }) {
  if (pending.length === 0 && unlinked.length === 0) {
    return `${MARKER}\nEveryone who wrote this pull request has signed the [Contributor License Agreement](${agreementUrl}). Thank you.`;
  }
  const lines = [
    MARKER,
    `Thanks for the pull request. Before it can be merged, the person who opened it and every author and co-author of its commits need to sign Geld's [Contributor License Agreement](${agreementUrl}).`,
    'You keep the copyright in your work. The agreement lets the maintainer also offer Geld under other terms, such as for distribution through app stores.',
  ];
  if (pending.length > 0) {
    lines.push(
      '',
      'To sign, post a comment on this pull request that says only this sentence:',
      '',
      '```',
      `${SIGN_PHRASE}.`,
      '```',
      '',
      `Waiting on: ${pending.map((account) => `@${account.login}`).join(', ')}`,
    );
  }
  if (unlinked.length > 0) {
    const who = unlinked.map((author) => `${author.name} <${author.email}>`).join(', ');
    lines.push(
      '',
      `Some commits are by ${who}, an email no GitHub account claims. Add it to your GitHub account, or amend those commits (and any Co-authored-by line) with an email your account uses, then push again.`,
    );
  }
  return lines.join('\n');
}

/**
 * The open pull requests (GraphQL `pullRequests` nodes) whose check failed waiting on one of `logins`. A description
 * cut at GitHub's 140 characters may name anyone, so such a pull request is checked again too.
 */
export function waitingOn(pulls, logins) {
  const names = logins.map((login) => login.toLowerCase());
  return pulls
    .filter((pull) => {
      const status = pull.commits.nodes[0]?.commit.status?.context;
      if (status?.state !== 'FAILURE' || !status.description.startsWith('Waiting on ')) return false;
      if (!status.description.endsWith(' to sign the CLA')) return true;
      const waiting = status.description.slice('Waiting on '.length, -' to sign the CLA'.length).split(', ');
      return waiting.some((entry) => names.includes(entry.replace(/^@/, '').toLowerCase()));
    })
    .map((pull) => pull.number);
}

export function statusDescription({ pending, unlinked }) {
  if (pending.length === 0 && unlinked.length === 0) return 'Everyone who wrote this has signed the CLA';
  if (pending.length > 0) return `Waiting on ${pending.map((account) => `@${account.login}`).join(', ')} to sign the CLA`.slice(0, 140);
  return 'A commit author has no GitHub account to sign with';
}

async function commitActors(github, repo, number) {
  const actors = [];
  let cursor = null;
  do {
    const data = await github.graphql(COMMIT_AUTHORS, { owner: repo.owner, name: repo.repo, number, cursor });
    const { commits } = data.repository.pullRequest;
    for (const node of commits.nodes) actors.push(...node.commit.authors.nodes);
    cursor = commits.pageInfo.hasNextPage ? commits.pageInfo.endCursor : null;
  } while (cursor !== null);
  return actors;
}

/** The blob SHA of `CLA.md` on the default branch as of `at`, or null when there was no agreement yet to sign. */
async function agreementShaAt(github, repo, ref, at) {
  const { data: commits } = await github.rest.repos.listCommits({ ...repo, sha: ref, path: AGREEMENT_PATH, until: at, per_page: 1 });
  if (commits.length === 0) return null;
  try {
    const { data } = await github.rest.repos.getContent({ ...repo, path: AGREEMENT_PATH, ref: commits[0].sha });
    return data.sha;
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

async function readSignatures(github, repo) {
  try {
    const { data } = await github.rest.repos.getContent({ ...repo, path: SIGNATURES_PATH, ref: SIGNATURES_BRANCH });
    const parsed = JSON.parse(Buffer.from(data.content, 'base64').toString('utf8'));
    return { signatures: parsed.signatures ?? [], sha: data.sha };
  } catch (error) {
    if (error.status === 404) return { signatures: [], sha: undefined };
    throw error;
  }
}

/** Creates the signatures branch as an orphan, so it shares no history (and no protection) with the code. */
async function ensureSignaturesBranch(github, repo) {
  try {
    await github.rest.git.getRef({ ...repo, ref: `heads/${SIGNATURES_BRANCH}` });
    return;
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  const content = `${JSON.stringify({ agreement: AGREEMENT_PATH, signatures: [] }, null, 2)}\n`;
  const blob = await github.rest.git.createBlob({ ...repo, content, encoding: 'utf-8' });
  const tree = await github.rest.git.createTree({ ...repo, tree: [{ path: SIGNATURES_PATH, mode: '100644', type: 'blob', sha: blob.data.sha }] });
  const commit = await github.rest.git.createCommit({ ...repo, message: 'Start the CLA signature record', tree: tree.data.sha, parents: [] });
  try {
    await github.rest.git.createRef({ ...repo, ref: `refs/heads/${SIGNATURES_BRANCH}`, sha: commit.data.sha });
  } catch (error) {
    if (error.status !== 422) throw error;
  }
}

/** Adds the signatures not yet on record, re-reading and retrying when another run wrote first. Returns the record. */
async function recordSignatures(github, repo, additions) {
  for (let attempt = 0; ; attempt++) {
    const { signatures, sha } = await readSignatures(github, repo);
    const known = new Set(signatures.map((signature) => signature.id));
    const fresh = [];
    for (const signature of additions) {
      if (known.has(signature.id)) continue;
      known.add(signature.id);
      fresh.push(signature);
    }
    if (fresh.length === 0) return { signatures, fresh };
    const next = [...signatures, ...fresh];
    const content = `${JSON.stringify({ agreement: AGREEMENT_PATH, signatures: next }, null, 2)}\n`;
    try {
      await github.rest.repos.createOrUpdateFileContents({
        ...repo,
        branch: SIGNATURES_BRANCH,
        path: SIGNATURES_PATH,
        message: `CLA signed by ${fresh.map((signature) => `@${signature.login}`).join(', ')}`,
        content: Buffer.from(content, 'utf8').toString('base64'),
        sha,
      });
      return { signatures: next, fresh };
    } catch (error) {
      if (attempt >= 3 || ![409, 422].includes(error.status)) throw error;
    }
  }
}

/** The comment as a signature, against the agreement it was written under, or null when no agreement existed then. */
async function signatureOf(github, repo, defaultBranch, comment) {
  const sha = await agreementShaAt(github, repo, defaultBranch, signedAtOf(comment));
  return sha === null ? null : signatureFrom(comment, sha);
}

async function checkPullRequest({ github, repo, pull, defaultBranch, agreementUrl, extraSignatures }) {
  const { accounts, unlinked } = signersOf(await commitActors(github, repo, pull.number), pull.user);
  let { signatures } = await readSignatures(github, repo);
  const comments = await github.paginate(github.rest.issues.listComments, { ...repo, issue_number: pull.number, per_page: 100 });

  const waiting = new Set(pendingAccounts(accounts, signatures).map((account) => account.id));
  for (const signature of extraSignatures) waiting.delete(signature.id);
  const additions = [...extraSignatures];
  for (const comment of comments) {
    if (!waiting.has(comment.user?.id) || !signs(comment.body)) continue;
    const signature = await signatureOf(github, repo, defaultBranch, comment);
    if (signature === null) continue;
    additions.push(signature);
    waiting.delete(comment.user.id);
  }
  let fresh = [];
  if (additions.length > 0) {
    await ensureSignaturesBranch(github, repo);
    ({ signatures, fresh } = await recordSignatures(github, repo, additions));
  }

  const pending = pendingAccounts(accounts, signatures);
  const outcome = { pending, unlinked, agreementUrl };
  const passed = pending.length === 0 && unlinked.length === 0;
  await github.rest.repos.createCommitStatus({
    ...repo,
    sha: pull.head.sha,
    state: passed ? 'success' : 'failure',
    context: STATUS_CONTEXT,
    description: statusDescription(outcome),
    target_url: agreementUrl,
  });

  const existing = comments.find((comment) => comment.user?.type === 'Bot' && comment.body?.startsWith(MARKER));
  const body = commentBody(outcome);
  if (existing) {
    if (existing.body !== body) await github.rest.issues.updateComment({ ...repo, comment_id: existing.id, body });
  } else if (!passed && pull.state === 'open') {
    await github.rest.issues.createComment({ ...repo, issue_number: pull.number, body });
  }

  // A locked conversation takes comments, edits and deletions from collaborators only, so signatures stay on the page.
  if (pull.merged_at && passed && accounts.length > 0 && !pull.locked) {
    await github.rest.issues.lock({ ...repo, issue_number: pull.number, lock_reason: 'resolved' });
  }
  return fresh;
}

/** Checks again every other open pull request that was waiting on someone who has just signed. */
async function recheckWaiting({ github, repo, signers, skip, defaultBranch, agreementUrl }) {
  if (signers.length === 0) return;
  const pulls = [];
  let cursor = null;
  do {
    const data = await github.graphql(WAITING_PULLS, { owner: repo.owner, name: repo.repo, cursor });
    const page = data.repository.pullRequests;
    pulls.push(...page.nodes);
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (cursor !== null);
  for (const number of waitingOn(pulls, signers.map((signature) => signature.login))) {
    if (number === skip) continue;
    const { data: pull } = await github.rest.pulls.get({ ...repo, pull_number: number });
    await checkPullRequest({ github, repo, pull, defaultBranch, agreementUrl, extraSignatures: [] });
  }
}

export async function run({ github, context, core }) {
  const repo = context.repo;
  const { payload } = context;
  const defaultBranch = payload.repository.default_branch;
  const agreementUrl = `${payload.repository.html_url}/blob/${defaultBranch}/${AGREEMENT_PATH}`;

  if (context.eventName === 'pull_request_target') {
    const pull = payload.pull_request;
    const fresh = await checkPullRequest({ github, repo, pull, defaultBranch, agreementUrl, extraSignatures: [] });
    await recheckWaiting({ github, repo, signers: fresh, skip: pull.number, defaultBranch, agreementUrl });
    return;
  }
  if (context.eventName !== 'issue_comment') return;

  const { comment, issue } = payload;
  const commenter = { login: comment.user.login, id: comment.user.id, type: comment.user.type };
  let signature = null;
  if (signs(comment.body) && !isAllowed(commenter)) {
    const { signatures } = await readSignatures(github, repo);
    if (!signatures.some((known) => known.id === commenter.id)) signature = await signatureOf(github, repo, defaultBranch, comment);
  }
  const extraSignatures = signature === null ? [] : [signature];

  let fresh = [];
  if (issue.pull_request) {
    const { data: pull } = await github.rest.pulls.get({ ...repo, pull_number: issue.number });
    fresh = await checkPullRequest({ github, repo, pull, defaultBranch, agreementUrl, extraSignatures });
  } else if (signature !== null) {
    await ensureSignaturesBranch(github, repo);
    ({ fresh } = await recordSignatures(github, repo, extraSignatures));
  }
  await recheckWaiting({ github, repo, signers: fresh, skip: issue.pull_request ? issue.number : null, defaultBranch, agreementUrl });
  if (signature !== null) {
    await github.rest.reactions.createForIssueComment({ ...repo, comment_id: comment.id, content: 'rocket' });
    core.info(`Recorded the CLA signature of @${commenter.login}`);
  }
}
