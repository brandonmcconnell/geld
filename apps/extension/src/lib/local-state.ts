import { storage } from 'wxt/utils/storage';

/**
 * Device-local, non-user-facing state (as opposed to synced settings).
 */

/**
 * Set once GitHub has stored the "hide whitespace" preference for the signed-in
 * user, so pages without the diff-settings form stop redirecting to `?w=1`.
 */
export const whitespacePersistedItem = storage.defineItem<boolean>('local:whitespacePersisted', { fallback: false });
