'use server';

import type { GeldSettings } from '@geld/core';
import { DEFAULT_SETTINGS, findSettingsGist, readRemoteValidated, settingsEqual, SignedOutError, writeRemote } from '@geld/core';
import { cookies } from 'next/headers';

import type { AuthConfig } from '@/lib/auth/config';
import { authConfig } from '@/lib/auth/config';
import { clearSession, resolveSession } from '@/lib/auth/session';
import { applyPatch, isSettingsPatch } from '@/lib/settings/patch';

export type SaveResult =
  | { readonly ok: true; readonly settings: GeldSettings; readonly gistId: string; readonly changed: boolean }
  | { readonly ok: false; readonly reason: 'signed-out' | 'invalid' | 'invalid-remote' | 'error'; readonly message: string };

type Denied = { readonly ok: false; readonly reason: 'signed-out' | 'error'; readonly message: string };

/**
 * The token to act with. Server actions may write cookies, so an expiring App
 * token is renewed right here and the rewritten cookie rides back with the
 * response.
 */
async function tokenForAction(config: AuthConfig | null): Promise<{ readonly token: string } | Denied> {
  const access = await resolveSession(config, await cookies());
  switch (access.status) {
    case 'ok':
    case 'stale':
      return { token: access.session.token };
    case 'none':
      return { ok: false, reason: 'signed-out', message: 'You are signed out.' };
    case 'expired':
      return { ok: false, reason: 'signed-out', message: "You've been signed out." };
    case 'unavailable':
      return { ok: false, reason: 'error', message: `GitHub could not be reached to renew your sign-in: ${access.message}` };
  }
}

/**
 * Strict read of the current gist. `gistIdHint` comes from the page; the gist
 * is looked up again if the hint is stale (deleted and recreated, say).
 */
async function readCurrent(token: string, gistIdHint: string | null): Promise<{ readonly gistId: string | null; readonly read: Awaited<ReturnType<typeof readRemoteValidated>> }> {
  if (gistIdHint !== null) {
    const read = await readRemoteValidated(token, gistIdHint).catch((error: unknown) => {
      if (error instanceof SignedOutError) throw error;
      return null;
    });
    if (read !== null && read.kind !== 'missing') return { gistId: gistIdHint, read };
  }
  const found = await findSettingsGist(token);
  if (found === null) return { gistId: null, read: { kind: 'missing' } };
  return { gistId: found.id, read: await readRemoteValidated(token, found.id) };
}

/**
 * Save one change to the user's gist. The gist is re-read first and the
 * change applied on top of that fresh copy, so a stale tab cannot undo
 * something the extension (or another tab) just pushed. `gistId` is a hint;
 * the gist is looked up again if it is missing or was deleted.
 */
export async function saveSetting(gistIdHint: string | null, patch: unknown): Promise<SaveResult> {
  const config = authConfig();
  const auth = await tokenForAction(config);
  if ('ok' in auth) return auth;
  if (!isSettingsPatch(patch)) return { ok: false, reason: 'invalid', message: 'That change could not be understood.' };

  try {
    const { gistId, read } = await readCurrent(auth.token, gistIdHint);
    // Never layer a change on a file we could not read: the user must fix or reset it first.
    if (read.kind === 'invalid') {
      return { ok: false, reason: 'invalid-remote', message: 'Your settings gist has errors. Reload this page to see them.' };
    }
    const base = read.kind === 'valid' ? read.remote.settings : DEFAULT_SETTINGS;

    const applied = applyPatch(base, patch);
    if (!applied.ok) return { ok: false, reason: 'invalid', message: applied.message };

    if (gistId !== null && settingsEqual(base, applied.settings)) {
      return { ok: true, settings: applied.settings, gistId, changed: false };
    }
    const saved = await writeRemote(auth.token, gistId, applied.settings);
    return { ok: true, settings: saved.settings, gistId: saved.gistId, changed: true };
  } catch (error) {
    if (error instanceof SignedOutError) {
      clearSession(await cookies());
      return { ok: false, reason: 'signed-out', message: "You've been signed out." };
    }
    return { ok: false, reason: 'error', message: error instanceof Error ? error.message : 'GitHub did not accept the change.' };
  }
}

export type ResetResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

/** Overwrite a corrupted gist with the defaults (the gist keeps its revision history on GitHub). */
export async function resetRemoteSettings(gistId: string): Promise<ResetResult> {
  const auth = await tokenForAction(authConfig());
  if ('ok' in auth) return { ok: false, message: auth.message };
  try {
    await writeRemote(auth.token, gistId, DEFAULT_SETTINGS);
    return { ok: true };
  } catch (error) {
    if (error instanceof SignedOutError) {
      clearSession(await cookies());
      return { ok: false, message: "You've been signed out." };
    }
    return { ok: false, message: error instanceof Error ? error.message : 'GitHub did not accept the reset.' };
  }
}
