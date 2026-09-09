import { storage } from 'wxt/utils/storage';

/**
 * Device-local, non-user-facing state (as opposed to synced settings).
 */

/**
 * Set once GitHub has stored the "hide whitespace" preference for the signed-in
 * user, so pages without the diff-settings form stop redirecting to `?w=1`.
 */
export const whitespacePersistedItem = storage.defineItem<boolean>('local:whitespacePersisted', { fallback: false });

/** The user's answer per repository when `repoConfigs` is `ask`: use its config, or ignore it. */
export type RepoConfigChoice = 'use' | 'ignore';
export type RepoConfigChoices = Readonly<Record<string, RepoConfigChoice>>;
export const repoConfigChoicesItem = storage.defineItem<RepoConfigChoices>('local:repoConfigChoices', { fallback: {} });
