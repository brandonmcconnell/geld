/**
 * The CLA check (`.github/workflows/cla.yml`), run by actions/github-script
 * from a checkout of the default branch, never the pull request's.
 *
 * A pull request passes when every author of its commits has signed `CLA.md`.
 * Signing is a comment holding `SIGN_PHRASE`, on a pull request or an issue;
 * each signature is kept on the unprotected `cla-signatures` branch with the
 * comment's words, its link and the agreement's blob SHA at the time. A pull
 * request's check also reads its own comments, so a signature whose run was
 * dropped is picked up on the next one.
 */

export const SIGN_PHRASE = 'I have read the Geld CLA and I agree to it';
export const SIGNATURES_BRANCH = 'cla-signatures';
export const SIGNATURES_PATH = 'signatures.json';
export const AGREEMENT_PATH = 'CLA.md';
export const STATUS_CONTEXT = 'CLA';
export const MARKER = '<!-- geld:cla -->';

const ALLOWED_LOGINS = new Set(['brandonmcconnell', 'cursoragent']);
const ALLOWED_EMAILS = new Set(['brandon@dreamthinkbuild.com', 'cursoragent@cursor.com']);

const normalize = (text) => text.toLowerCase().replace(/[>*_`]/g, ' ').replace(/\s+/g, ' ').trim();

export function signs(body) {
  return typeof body === 'string' && normalize(body).includes(normalize(SIGN_PHRASE));
}

export function isAllowed(author) {
  if (author.login && (ALLOWED_LOGINS.has(author.login) || author.login.endsWith('[bot]') || author.type === 'Bot')) return true;
  return !author.login && ALLOWED_EMAILS.has((author.email ?? '').toLowerCase());
}

/** The people a pull request's commits need a signature from: GitHub accounts, and authors whose email no account claims. */
export function authorsOf(commits) {
  const accounts = new Map();
  const unlinked = new Map();
  for (const commit of commits) {
    const author = commit.author
      ? { login: commit.author.login, id: commit.author.id, type: commit.author.type }
      : { name: commit.commit?.author?.name ?? '', email: commit.commit?.author?.email ?? '' };
    if (isAllowed(author)) continue;
    if (author.login) accounts.set(author.id, author);
    else unlinked.set(author.email.toLowerCase(), author);
  }
  return { accounts: [...accounts.values()], unlinked: [...unlinked.values()] };
}

export function pendingAccounts(accounts, signatures) {
  const signed = new Set(signatures.map((signature) => signature.id));
  return accounts.filter((account) => !signed.has(account.id));
}

export function signatureFrom(comment, agreementSha) {
  return {
    login: comment.user.login,
    id: comment.user.id,
    signedAt: comment.created_at,
    comment: comment.html_url,
    body: comment.body,
    agreementSha,
  };
}

export function commentBody({ pending, unlinked, agreementUrl }) {
  if (pending.length === 0 && unlinked.length === 0) {
    return `${MARKER}\nEveryone who authored commits in this pull request has signed the [Contributor License Agreement](${agreementUrl}). Thank you.`;
  }
  const lines = [
    MARKER,
    `Thanks for the pull request. Before it can be merged, every author of its commits needs to sign Geld's [Contributor License Agreement](${agreementUrl}).`,
    'You keep the copyright in your work. The agreement lets the maintainer also offer Geld under other terms, such as for distribution through app stores.',
  ];
  if (pending.length > 0) {
    lines.push(
      '',
      'To sign, post a comment on this pull request with this sentence:',
      '',
      `> ${SIGN_PHRASE}.`,
      '',
      `Waiting on: ${pending.map((account) => `@${account.login}`).join(', ')}`,
    );
  }
  if (unlinked.length > 0) {
    const who = unlinked.map((author) => `${author.name} <${author.email}>`).join(', ');
    lines.push(
      '',
      `Some commits are by ${who}, an email no GitHub account claims. Add it to your GitHub account, or amend those commits with an email your account uses, then push again.`,
    );
  }
  return lines.join('\n');
}

export function statusDescription({ pending, unlinked }) {
  if (pending.length === 0 && unlinked.length === 0) return 'Every author has signed the CLA';
  if (pending.length > 0) return `Waiting on ${pending.map((account) => `@${account.login}`).join(', ')} to sign the CLA`.slice(0, 140);
  return 'A commit author has no GitHub account to sign with';
}

async function agreementSha(github, repo, ref) {
  const { data } = await github.rest.repos.getContent({ ...repo, path: AGREEMENT_PATH, ref });
  return data.sha;
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
    if (fresh.length === 0) return signatures;
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
      return next;
    } catch (error) {
      if (attempt >= 3 || ![409, 422].includes(error.status)) throw error;
    }
  }
}

async function checkPullRequest({ github, repo, pull, defaultBranch, agreementUrl, extraSignatures }) {
  const commits = await github.paginate(github.rest.pulls.listCommits, { ...repo, pull_number: pull.number, per_page: 100 });
  const { accounts, unlinked } = authorsOf(commits);
  let { signatures } = await readSignatures(github, repo);
  const comments = await github.paginate(github.rest.issues.listComments, { ...repo, issue_number: pull.number, per_page: 100 });

  const waiting = new Set(pendingAccounts(accounts, signatures).map((account) => account.id));
  const additions = [...extraSignatures];
  if (waiting.size > 0) {
    const sha = await agreementSha(github, repo, defaultBranch);
    for (const comment of comments) {
      if (waiting.has(comment.user?.id) && signs(comment.body)) {
        additions.push(signatureFrom(comment, sha));
        waiting.delete(comment.user.id);
      }
    }
  }
  if (additions.length > 0) {
    await ensureSignaturesBranch(github, repo);
    signatures = await recordSignatures(github, repo, additions);
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
}

export async function run({ github, context, core }) {
  const repo = context.repo;
  const { payload } = context;
  const defaultBranch = payload.repository.default_branch;
  const agreementUrl = `${payload.repository.html_url}/blob/${defaultBranch}/${AGREEMENT_PATH}`;

  if (context.eventName === 'pull_request_target') {
    await checkPullRequest({ github, repo, pull: payload.pull_request, defaultBranch, agreementUrl, extraSignatures: [] });
    return;
  }
  if (context.eventName !== 'issue_comment') return;

  const { comment, issue } = payload;
  const commenter = { login: comment.user.login, id: comment.user.id, type: comment.user.type };
  const signing = signs(comment.body) && !isAllowed(commenter);
  const extraSignatures = [];
  if (signing) {
    const { signatures } = await readSignatures(github, repo);
    if (!signatures.some((signature) => signature.id === commenter.id)) {
      extraSignatures.push(signatureFrom(comment, await agreementSha(github, repo, defaultBranch)));
    }
  }

  if (issue.pull_request) {
    const { data: pull } = await github.rest.pulls.get({ ...repo, pull_number: issue.number });
    await checkPullRequest({ github, repo, pull, defaultBranch, agreementUrl, extraSignatures });
  } else if (extraSignatures.length > 0) {
    await ensureSignaturesBranch(github, repo);
    await recordSignatures(github, repo, extraSignatures);
  }
  if (signing) {
    await github.rest.reactions.createForIssueComment({ ...repo, comment_id: comment.id, content: 'rocket' });
    core.info(`Recorded the CLA signature of @${commenter.login}`);
  }
}
