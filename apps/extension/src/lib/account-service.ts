import type { GeldSettings, RemoteRead } from '@geld/core';
import { DEFAULT_SETTINGS, fetchGitHubProfile, findSettingsGist, readRemoteValidated, settingsEqual, SignedOutError, writeRemote } from '@geld/core';
import type { TokenSet } from '@geld/github';
import { createTokenSource, pollDeviceCode, refreshTokens, requestDeviceCode } from '@geld/github';
import { browser } from 'wxt/browser';
import type { AuthFlowState, GitHubAccount, RemoteInvalid, SyncState } from './account';
import { accountItem, authFlowItem, effectiveClientId, EMPTY_SYNC_STATE, syncStateItem, tokensOf, withTokens } from './account';
import { loadCatalog } from './catalog';
import type { AccountActionMessage, AccountActionResponse } from './messages';
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
