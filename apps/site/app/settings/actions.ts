'use server';

import type { GeldSettings } from '@geld/core';
import { DEFAULT_SETTINGS, findSettingsGist, readRemote, settingsEqual, SignedOutError, writeRemote } from '@geld/core';
import { cookies } from 'next/headers';

import { authConfig } from '@/lib/auth/config';
import { clearSession, getSession } from '@/lib/auth/session';
import { applyPatch, isSettingsPatch } from '@/lib/settings/patch';

export type SaveResult =
  | { readonly ok: true; readonly settings: GeldSettings; readonly gistId: string; readonly changed: boolean }
  | { readonly ok: false; readonly reason: 'signed-out' | 'invalid' | 'error'; readonly message: string };

/**
 * Save one change to the user's gist. The gist is re-read first and the
 * change applied on top of that fresh copy, so a stale tab cannot undo
 * something the extension (or another tab) just pushed. `gistId` is a hint;
 * the gist is looked up again if it is missing or was deleted.
 */
export async function saveSetting(gistIdHint: string | null, patch: unknown): Promise<SaveResult> {
  const config = authConfig();
  const session = await getSession(config);
  if (config === null || session === null) return { ok: false, reason: 'signed-out', message: 'You are signed out.' };
  if (!isSettingsPatch(patch)) return { ok: false, reason: 'invalid', message: 'That change could not be understood.' };

  try {
    let gistId = gistIdHint;
    let remote = gistId === null ? null : await readRemote(session.token, gistId).catch(() => null);
    if (remote === null) {
      const found = await findSettingsGist(session.token);
      gistId = found?.id ?? null;
      remote = gistId === null ? null : await readRemote(session.token, gistId);
    }
    const base = remote?.settings ?? DEFAULT_SETTINGS;

    const applied = applyPatch(base, patch);
    if (!applied.ok) return { ok: false, reason: 'invalid', message: applied.message };

    if (gistId !== null && settingsEqual(base, applied.settings)) {
      return { ok: true, settings: applied.settings, gistId, changed: false };
    }
    const saved = await writeRemote(session.token, gistId, applied.settings);
    return { ok: true, settings: saved.settings, gistId: saved.gistId, changed: true };
  } catch (error) {
    if (error instanceof SignedOutError) {
      clearSession(await cookies());
      return { ok: false, reason: 'signed-out', message: "You've been signed out." };
    }
    return { ok: false, reason: 'error', message: error instanceof Error ? error.message : 'GitHub did not accept the change.' };
  }
}
