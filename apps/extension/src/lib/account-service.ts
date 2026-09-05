import type { GeldSettings, RemoteRead } from '@geld/core';
import { DEFAULT_SETTINGS, findSettingsGist, readRemoteValidated, settingsEqual, SignedOutError, writeRemote } from '@geld/core';
import { browser } from 'wxt/browser';
import type { AuthFlowState, RemoteInvalid, SyncState } from './account';
import { accountItem, authFlowItem, effectiveClientId, EMPTY_SYNC_STATE, syncStateItem } from './account';
import { fetchAccount, pollForToken, requestDeviceCode } from './github-auth';
import type { AccountActionMessage, AccountActionResponse } from './messages';
import { settingsItem } from './storage';

/**
 * Runs in the background so a sign-in or sync survives the popup closing.
 * State is published through `storage.local` items that the popup and options
 * page watch; they never talk to GitHub themselves.
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

/* ------------------------------------------------------------------ sign-in */

async function signIn(): Promise<AccountActionResponse> {
  const clientId = await effectiveClientId();
  if (clientId === '') {
    return fail('No GitHub OAuth client id is configured. Add one in the options page (Account section).');
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
        result = await pollForToken(clientId, device);
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
        const account = await fetchAccount(result.token, result.scopes);
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
  const account = await accountItem.getValue();
  if (account === null) return;
  try {
    const local = await settingsItem.getValue();
    const existing = await findSettingsGist(account.token);
    if (existing === null) {
      const written = await writeRemote(account.token, null, local);
      await setSync({ gistId: written.gistId, remoteUpdatedAt: written.updatedAt, lastSyncedAt: Date.now(), lastError: null, pendingChoice: null });
      return;
    }
    const read = await readRemoteValidated(account.token, existing.id);
    if (read.kind === 'missing') {
      // The gist exists but has no settings file (e.g. the user deleted it): recreate it.
      const written = await writeRemote(account.token, existing.id, local);
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
  try {
    if (useRemote) {
      await applyRemoteLocally(state.pendingChoice.remote);
      await setSync({ remoteUpdatedAt: state.pendingChoice.remoteUpdatedAt, lastSyncedAt: Date.now(), lastError: null, pendingChoice: null });
    } else {
      const written = await writeRemote(account.token, state.gistId, await settingsItem.getValue());
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
    const written = await writeRemote(account.token, gistId, DEFAULT_SETTINGS);
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
    const gistId = state.gistId ?? (await findSettingsGist(account.token))?.id ?? null;
    if (gistId === null) {
      const written = await writeRemote(account.token, null, await settingsItem.getValue());
      await setSync({ gistId: written.gistId, remoteUpdatedAt: written.updatedAt, lastSyncedAt: Date.now(), lastError: null });
      return { ok: true };
    }
    const read = await readRemoteValidated(account.token, gistId);
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
    const written = await writeRemote(account.token, state.gistId, settings);
    await setSync({ gistId: written.gistId, remoteUpdatedAt: written.updatedAt, lastSyncedAt: Date.now(), lastError: null });
  } catch (error) {
    await handleSyncError(error);
  }
}

async function handleSyncError(error: unknown): Promise<void> {
  if (error instanceof SignedOutError) {
    await accountItem.setValue(null);
    await setSync({ ...EMPTY_SYNC_STATE, lastError: 'GitHub signed Geld out; please sign in again.' });
    return;
  }
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
