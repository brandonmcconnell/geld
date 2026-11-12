import type { GeldSettings, RemoteRead } from '@geld/core';
import { DEFAULT_SETTINGS, fetchGitHubProfile, findSettingsGist, readRemoteValidated, settingsEqual, SignedOutError, writeRemote } from '@geld/core';
import type { TokenSet } from '@geld/github';
import { createTokenSource, pollDeviceCode, refreshTokens, requestDeviceCode } from '@geld/github';
import { browser } from 'wxt/browser';
import type { AuthFlowState, GitHubAccount, RemoteInvalid, SyncState } from './account';
import { accountItem, authFlowItem, effectiveClientId, EMPTY_SYNC_STATE, syncStateItem, tokensOf, withTokens } from './account';
import { loadCatalog } from './catalog';
import type { CreatePullOutcome, PullAttempt } from './create-pull';
import { apiRefusal, parseCreatedPull } from './create-pull';
import { FEEDBACK_REPO, ISSUE_BODY_LIMIT, parseCreatedIssue, refusalMessage } from './feedback';
import type { AccountActionMessage, AccountActionResponse, FeedbackSubmitMessage, FeedbackSubmitResponse } from './messages';
import { settingsItem } from './storage';

/**
 * Runs in the background so a sign-in or sync survives the popup closing.
 * State is published through `storage.local` items that the popup and options
 * page watch; they never talk to GitHub themselves.
 *
 * Sign-in is the Geld GitHub App's **device flow** (no client secret, no
 * server). App tokens expire after eight hours, so this module is also the
 * one place that refreshes them: every GitHub call goes through `withToken`,
 * which renews the token ahead of expiry and retries once after a 401.
 * Refresh tokens rotate on use, which is why only the background may refresh.
 */

const PUSH_DEBOUNCE_MS = 1500;

let cancelFlow: (() => void) | null = null;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
/** Settings we just wrote locally from the remote copy; skip pushing them back. */
let suppressPushFor: string | null = null;

function fail(message: string): AccountActionResponse {
  return { ok: false, message };
}

async function setSync(patch: Partial<SyncState>): Promise<SyncState> {
  // Spread the defaults first so state saved by an older version gains new fields.
  const next: SyncState = { ...EMPTY_SYNC_STATE, ...(await syncStateItem.getValue()), ...patch };
  await syncStateItem.setValue(next);
  return next;
}

function invalidFrom(read: Extract<RemoteRead, { kind: 'invalid' }>): RemoteInvalid {
  return { gistId: read.gistId, gistUrl: read.htmlUrl, updatedAt: read.updatedAt, issues: read.issues };
}

/** A corrupted gist blocks sync until the user acts; record it and say so. */
async function markInvalid(read: Extract<RemoteRead, { kind: 'invalid' }>): Promise<AccountActionResponse> {
  await setSync({ gistId: read.gistId, remoteUpdatedAt: read.updatedAt, lastError: null, pendingChoice: null, remoteInvalid: invalidFrom(read) });
  return fail('Your settings on GitHub could not be read. See the notice for details.');
}

/* ------------------------------------------------------------------ tokens */

const tokenSource = createTokenSource({
  store: {
    async load(): Promise<TokenSet | null> {
      const account = await accountItem.getValue();
      return account === null ? null : tokensOf(account);
    },
    async save(tokens: TokenSet): Promise<void> {
      const account = await accountItem.getValue();
      if (account !== null) await accountItem.setValue(withTokens(account, tokens));
    },
  },
  // Device-flow tokens refresh without a client secret, so the extension can do it alone.
  refresh: async (refreshToken) => refreshTokens({ clientId: await effectiveClientId(), refreshToken }),
});

/** The sign-in is over (revoked, expired for good, or refused): forget it and say why. */
async function signedOut(reason: string): Promise<void> {
  await accountItem.setValue(null);
  await setSync({ ...EMPTY_SYNC_STATE, lastError: reason });
}

/**
 * Run a GitHub call with a token that is good for a while, refreshing first
 * when needed. A 401 gets one forced refresh and retry (clock skew, or a token
 * revoked and re-issued); a second 401 means the sign-in really is over.
 * Throws `SignedOutError` once the account has been cleared.
 */
async function withToken<T>(call: (token: string) => Promise<T>): Promise<T> {
  const first = await tokenSource.get();
  if (first.status === 'signed-out') {
    await signedOut('GitHub signed Geld out; please sign in again.');
    throw new SignedOutError();
  }
  if (first.status === 'unavailable') throw new Error(`Could not renew the GitHub sign-in: ${first.message}`);
  try {
    return await call(first.token);
  } catch (error) {
    if (!(error instanceof SignedOutError)) throw error;
    const second = await tokenSource.get({ force: true });
    if (second.status !== 'ok' || second.token === first.token) {
      await signedOut('GitHub signed Geld out; please sign in again.');
      throw error;
    }
    try {
      return await call(second.token);
    } catch (retryError) {
      if (retryError instanceof SignedOutError) await signedOut('GitHub signed Geld out; please sign in again.');
      throw retryError;
    }
  }
}

/* ------------------------------------------------------------------ sign-in */

async function signIn(): Promise<AccountActionResponse> {
  const clientId = await effectiveClientId();
  if (clientId === '') {
    return fail('No GitHub App client id is configured. Add one in the options page (Account section).');
  }
  cancelFlow?.();
  let cancelled = false;
  cancelFlow = () => {
    cancelled = true;
  };

  let device;
  try {
    device = await requestDeviceCode(clientId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await authFlowItem.setValue({ status: 'error', message });
    return fail(message);
  }
  const pending: AuthFlowState = {
    status: 'pending',
    userCode: device.userCode,
    verificationUri: device.verificationUri,
    expiresAt: device.expiresAt,
  };
  await authFlowItem.setValue(pending);
  // Open GitHub's device page; the user types the code shown in the popup.
  void browser.tabs.create({ url: device.verificationUri }).catch(() => undefined);

  void (async () => {
    let intervalMs = device.intervalMs;
    while (!cancelled && Date.now() < device.expiresAt) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      if (cancelled) return;
      let result;
      try {
        result = await pollDeviceCode(clientId, device);
      } catch {
        continue; // transient network error; keep polling
      }
      if (result.status === 'pending') {
        intervalMs = result.intervalMs;
        continue;
      }
      if (result.status === 'failed') {
        await authFlowItem.setValue({ status: 'error', message: result.message });
        return;
      }
      try {
        const profile = await fetchGitHubProfile(result.tokens.accessToken);
        // Replaces an OAuth App account in place (same user, same gist); the old
        // token cannot be revoked from here (that needs the client secret), it
        // is simply forgotten.
        const account: GitHubAccount = withTokens({ ...profile, auth: 'app', token: '', expiresAt: null, refreshToken: null, refreshTokenExpiresAt: null, scopes: [] }, result.tokens);
        await accountItem.setValue(account);
        await authFlowItem.setValue({ status: 'idle' });
        await initialSync();
      } catch (error) {
        await authFlowItem.setValue({ status: 'error', message: error instanceof Error ? error.message : String(error) });
      }
      return;
    }
    if (!cancelled) await authFlowItem.setValue({ status: 'error', message: 'The sign-in code expired. Please try again.' });
  })();

  return { ok: true };
}

async function cancelSignIn(): Promise<AccountActionResponse> {
  cancelFlow?.();
  cancelFlow = null;
  await authFlowItem.setValue({ status: 'idle' });
  return { ok: true };
}

async function signOut(): Promise<AccountActionResponse> {
  cancelFlow?.();
  cancelFlow = null;
  await accountItem.setValue(null);
  await authFlowItem.setValue({ status: 'idle' });
  await syncStateItem.setValue(EMPTY_SYNC_STATE);
  return { ok: true };
}

/* -------------------------------------------------------------------- sync */

/**
 * Right after signing in: look for settings on the account. None → upload
 * this device's settings. Identical → nothing. Different → ask the user.
 */
async function initialSync(): Promise<void> {
  if ((await accountItem.getValue()) === null) return;
  try {
    const local = await settingsItem.getValue();
    const existing = await withToken((token) => findSettingsGist(token));
    if (existing === null) {
      const written = await withToken((token) => writeRemote(token, null, local));
      await setSync({ gistId: written.gistId, remoteUpdatedAt: written.updatedAt, lastSyncedAt: Date.now(), lastError: null, pendingChoice: null });
      return;
    }
    const catalog = await loadCatalog();
    const read = await withToken((token) => readRemoteValidated(token, existing.id, catalog));
    if (read.kind === 'missing') {
      // The gist exists but has no settings file (e.g. the user deleted it): recreate it.
      const written = await withToken((token) => writeRemote(token, existing.id, local));
      await setSync({ gistId: written.gistId, remoteUpdatedAt: written.updatedAt, lastSyncedAt: Date.now(), lastError: null, pendingChoice: null, remoteInvalid: null });
      return;
    }
    if (read.kind === 'invalid') {
      await markInvalid(read);
      return;
    }
    const { remote } = read;
    if (settingsEqual(remote.settings, local)) {
      await setSync({ gistId: remote.gistId, remoteUpdatedAt: remote.updatedAt, lastSyncedAt: Date.now(), lastError: null, pendingChoice: null, remoteInvalid: null });
      return;
    }
    await setSync({
      gistId: remote.gistId,
      remoteUpdatedAt: remote.updatedAt,
      lastError: null,
      pendingChoice: { remote: remote.settings, remoteUpdatedAt: remote.updatedAt },
      remoteInvalid: null,
    });
  } catch (error) {
    await handleSyncError(error);
  }
}

async function resolveChoice(useRemote: boolean): Promise<AccountActionResponse> {
  const account = await accountItem.getValue();
  const state = await syncStateItem.getValue();
  if (account === null || state.pendingChoice === null || state.gistId === null) return fail('Nothing to resolve.');
  const { pendingChoice, gistId } = state;
  try {
    if (useRemote) {
      await applyRemoteLocally(pendingChoice.remote);
      await setSync({ remoteUpdatedAt: pendingChoice.remoteUpdatedAt, lastSyncedAt: Date.now(), lastError: null, pendingChoice: null });
    } else {
      const local = await settingsItem.getValue();
      const written = await withToken((token) => writeRemote(token, gistId, local));
      await setSync({ remoteUpdatedAt: written.updatedAt, lastSyncedAt: Date.now(), lastError: null, pendingChoice: null });
    }
    return { ok: true };
  } catch (error) {
    await handleSyncError(error);
    return fail(error instanceof Error ? error.message : String(error));
  }
}

/** The user gave up on a corrupted gist: both sides go back to the defaults. */
async function resetRemote(): Promise<AccountActionResponse> {
  const account = await accountItem.getValue();
  const state = await syncStateItem.getValue();
  if (account === null) return fail('Not signed in.');
  const gistId = state.remoteInvalid?.gistId ?? state.gistId;
  try {
    const written = await withToken((token) => writeRemote(token, gistId, DEFAULT_SETTINGS));
    await applyRemoteLocally(DEFAULT_SETTINGS);
    await setSync({ gistId: written.gistId, remoteUpdatedAt: written.updatedAt, lastSyncedAt: Date.now(), lastError: null, pendingChoice: null, remoteInvalid: null });
    return { ok: true };
  } catch (error) {
    await handleSyncError(error);
    return fail(error instanceof Error ? error.message : String(error));
  }
}

async function applyRemoteLocally(remote: GeldSettings): Promise<void> {
  suppressPushFor = JSON.stringify(remote);
  await settingsItem.setValue(remote);
}

/** Pull: adopt the account copy if it changed since we last saw it. */
async function pull(): Promise<AccountActionResponse> {
  const account = await accountItem.getValue();
  if (account === null) return fail('Not signed in.');
  const state = await syncStateItem.getValue();
  if (state.pendingChoice !== null) return fail('Choose which settings to keep first.');
  try {
    const gistId = state.gistId ?? (await withToken((token) => findSettingsGist(token)))?.id ?? null;
    if (gistId === null) {
      const local = await settingsItem.getValue();
      const written = await withToken((token) => writeRemote(token, null, local));
      await setSync({ gistId: written.gistId, remoteUpdatedAt: written.updatedAt, lastSyncedAt: Date.now(), lastError: null });
      return { ok: true };
    }
    const catalog = await loadCatalog();
    const read = await withToken((token) => readRemoteValidated(token, gistId, catalog));
    if (read.kind === 'missing') return fail('The settings gist could not be read.');
    if (read.kind === 'invalid') return markInvalid(read);
    const { remote } = read;
    const local = await settingsItem.getValue();
    // Adopt the account copy when it changed since we last saw it, or when we
    // are recovering from a corrupted file the user has just fixed.
    const recovering = state.remoteInvalid !== null;
    if ((recovering || remote.updatedAt !== state.remoteUpdatedAt) && !settingsEqual(remote.settings, local)) {
      await applyRemoteLocally(remote.settings);
    }
    await setSync({ gistId, remoteUpdatedAt: remote.updatedAt, lastSyncedAt: Date.now(), lastError: null, remoteInvalid: null });
    return { ok: true };
  } catch (error) {
    await handleSyncError(error);
    return fail(error instanceof Error ? error.message : String(error));
  }
}

/** Push: write local settings after they change (debounced). */
function schedulePush(settings: GeldSettings): void {
  const serialized = JSON.stringify(settings);
  if (suppressPushFor === serialized) {
    suppressPushFor = null;
    return;
  }
  if (pushTimer !== null) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void push(settings);
  }, PUSH_DEBOUNCE_MS);
}

async function push(settings: GeldSettings): Promise<void> {
  const account = await accountItem.getValue();
  if (account === null) return;
  const state = await syncStateItem.getValue();
  // Never write over a file the user is still fixing by hand.
  if (state.pendingChoice !== null || state.remoteInvalid !== null) return;
  try {
    const written = await withToken((token) => writeRemote(token, state.gistId, settings));
    await setSync({ gistId: written.gistId, remoteUpdatedAt: written.updatedAt, lastSyncedAt: Date.now(), lastError: null });
  } catch (error) {
    await handleSyncError(error);
  }
}

async function handleSyncError(error: unknown): Promise<void> {
  // `withToken` already cleared the account and recorded why.
  if (error instanceof SignedOutError) return;
  await setSync({ lastError: error instanceof Error ? error.message : String(error) });
}

/* ---------------------------------------------------------------- feedback */

function refuse(message: string): FeedbackSubmitResponse {
  return { ok: false, message };
}

async function createIssue(token: string, title: string, body: string): Promise<FeedbackSubmitResponse> {
  const response = await fetch(`https://api.github.com/repos/${FEEDBACK_REPO}/issues`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    // GitHub drops labels from anyone without push access, so this only sorts the owner's own reports.
    body: JSON.stringify({ title, body, labels: ['feedback'] }),
  });
  if (response.status === 401) throw new SignedOutError();
  const answer: unknown = await response.json().catch(() => null);
  if (response.ok) {
    const issue = parseCreatedIssue(answer);
    return issue === null ? refuse('GitHub opened the issue but its answer could not be read.') : { ok: true, ...issue };
  }
  return refuse(refusalMessage(response.status, answer, response.headers.get('x-ratelimit-remaining') === '0'));
}

/** Open the reader's feedback as an issue from their own account, through the Geld App's user token. */
async function submitFeedback(message: FeedbackSubmitMessage): Promise<FeedbackSubmitResponse> {
  const account = await accountItem.getValue();
  if (account === null) return refuse('Sign in with GitHub to send feedback.');
  // An OAuth App token only carries the gist scope.
  if (account.auth !== 'app') return refuse('Sign in with GitHub again to send feedback.');
  if (message.title.trim() === '' || message.body.trim() === '') return refuse('Add a title and some details first.');
  if (message.body.length > ISSUE_BODY_LIMIT) return refuse('The details are too long for one GitHub issue. Shorten them and send again.');
  try {
    return await withToken((token) => createIssue(token, message.title, message.body));
  } catch (error) {
    if (error instanceof SignedOutError) return refuse('GitHub signed Geld out. Sign in again to send it.');
    return refuse(`Could not reach GitHub: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function handleFeedbackMessage(message: FeedbackSubmitMessage): Promise<FeedbackSubmitResponse> {
  return submitFeedback(message);
}

/* ------------------------------------------------------- pull request retry */

async function postPull(token: string, attempt: PullAttempt): Promise<CreatePullOutcome> {
  const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(attempt.owner)}/${encodeURIComponent(attempt.repo)}/pulls`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: attempt.title,
      body: attempt.body,
      base: attempt.base,
      head: attempt.head,
      ...(attempt.headRepo === null ? {} : { head_repo: attempt.headRepo }),
      draft: attempt.draft,
    }),
  });
  if (response.status === 401) throw new SignedOutError();
  const answer: unknown = await response.json().catch(() => null);
  if (response.ok) {
    const pull = parseCreatedPull(answer);
    return pull === null ? { ok: false, reason: 'refused', message: 'GitHub opened the pull request but its answer could not be read.' } : { ok: true, ...pull };
  }
  return apiRefusal(response.status, answer);
}

/** The request `gh pr create` makes, with the reader's Geld App token, for a pull request GitHub's own form failed to open. */
export async function createPullRequest(attempt: PullAttempt): Promise<CreatePullOutcome> {
  const account = await accountItem.getValue();
  if (account === null) return { ok: false, reason: 'unavailable', message: 'Sign in to Geld with GitHub to retry through the API.' };
  // An OAuth App token only carries the gist scope.
  if (account.auth !== 'app') return { ok: false, reason: 'unavailable', message: 'Sign in to Geld with GitHub again to retry through the API.' };
  try {
    return await withToken((token) => postPull(token, attempt));
  } catch (error) {
    if (error instanceof SignedOutError) return { ok: false, reason: 'unavailable', message: 'GitHub signed Geld out.' };
    return { ok: false, reason: 'refused', message: `Could not reach GitHub: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/* ------------------------------------------------------------------ wiring */

export function handleAccountMessage(message: AccountActionMessage): Promise<AccountActionResponse> {
  switch (message.action) {
    case 'sign-in':
      return signIn();
    case 'cancel-sign-in':
      return cancelSignIn();
    case 'sign-out':
      return signOut();
    case 'sync-now':
      return pull();
    case 'resolve-remote':
      return resolveChoice(true);
    case 'resolve-local':
      return resolveChoice(false);
    case 'reset-remote':
      return resetRemote();
  }
}

/** Call once from the background entrypoint. */
export function startAccountSync(): void {
  settingsItem.watch((settings) => schedulePush(settings));
  // Adopt changes made on other devices when the browser starts.
  void pull().catch(() => undefined);
}
