import type { GeldSettings, SettingsIssue } from '@geld/core';
import { storage } from 'wxt/utils/storage';
import type { GitHubAccount } from './account-model';
import { migrateStoredAccount } from './account-model';

export type { GitHubAccount } from './account-model';
export { migrateStoredAccount, tokensOf, withTokens } from './account-model';

/**
 * Device-local state for the GitHub account link. Tokens never go into
 * `storage.sync`; they stay on the device that signed in.
 */

export type AuthFlowState =
  | { readonly status: 'idle' }
  | {
      readonly status: 'pending';
      readonly userCode: string;
      readonly verificationUri: string;
      readonly expiresAt: number;
    }
  | { readonly status: 'error'; readonly message: string };

export interface SyncState {
  readonly gistId: string | null;
  /** ISO timestamp of the gist revision we last read or wrote. */
  readonly remoteUpdatedAt: string | null;
  readonly lastSyncedAt: number | null;
  readonly lastError: string | null;
  /**
   * Set when a sign-in found account settings that differ from this device's.
   * Sync pauses until the user chooses which side wins.
   */
  readonly pendingChoice: { readonly remote: GeldSettings; readonly remoteUpdatedAt: string } | null;
  /**
   * Set when the gist exists but fails validation (usually hand-edited). Sync
   * pauses in both directions — nothing is adopted from it and local changes are
   * not pushed over it — until the user fixes the file or resets to defaults.
   */
  readonly remoteInvalid: RemoteInvalid | null;
}

export interface RemoteInvalid {
  readonly gistId: string;
  readonly gistUrl: string;
  readonly updatedAt: string;
  readonly issues: readonly SettingsIssue[];
}

export const EMPTY_SYNC_STATE: SyncState = {
  gistId: null,
  remoteUpdatedAt: null,
  lastSyncedAt: null,
  lastError: null,
  pendingChoice: null,
  remoteInvalid: null,
};

/** Version 2 added the App token fields; version 1 accounts migrate to `oauth` on first access. */
export const accountItem = storage.defineItem<GitHubAccount | null>('local:githubAccount', {
  fallback: null,
  version: 2,
  migrations: { 2: migrateStoredAccount },
});
export const authFlowItem = storage.defineItem<AuthFlowState>('local:authFlow', { fallback: { status: 'idle' } });
export const syncStateItem = storage.defineItem<SyncState>('local:syncState', { fallback: EMPTY_SYNC_STATE });
/** GitHub App client id (public). Can be overridden from the options page to test another App. */
export const appClientIdItem = storage.defineItem<string>('local:appClientId', { fallback: '' });

/** Client id baked in at build time (`WXT_GELD_APP_CLIENT_ID` in .env), if any. */
export const BUILT_IN_CLIENT_ID: string = import.meta.env.WXT_GELD_APP_CLIENT_ID ?? '';

export async function effectiveClientId(): Promise<string> {
  const override = (await appClientIdItem.getValue()).trim();
  return override !== '' ? override : BUILT_IN_CLIENT_ID;
}
