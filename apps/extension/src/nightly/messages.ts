import type { NightlyStatus } from './state';

export interface NightlyCheckMessage {
  readonly type: 'geld:nightly-check';
}

export interface NightlyInstallMessage {
  readonly type: 'geld:nightly-install';
}

/** From the conflict note on a GitHub page: opens the extensions page on the Geld in the way. */
export interface NightlyManageMessage {
  readonly type: 'geld:nightly-manage';
}

export function isNightlyManageMessage(message: unknown): message is NightlyManageMessage {
  return hasType(message, 'geld:nightly-manage');
}

/** Puts back the build that ran before the last install (or before an install that broke off). */
export interface NightlyRollbackMessage {
  readonly type: 'geld:nightly-rollback';
}

/** What an install needs that it does not have: a connected folder, or this session's access to it. */
export type InstallNeed = 'folder' | 'permission';

export type NightlyInstallResult =
  | { readonly ok: true; readonly version: string }
  | { readonly ok: false; readonly reason: string; readonly need?: InstallNeed };

export type NightlyCheckResult = NightlyStatus;

function hasType(message: unknown, type: string): boolean {
  return typeof message === 'object' && message !== null && 'type' in message && message.type === type;
}

export function isNightlyCheckMessage(message: unknown): message is NightlyCheckMessage {
  return hasType(message, 'geld:nightly-check');
}

export function isNightlyRollbackMessage(message: unknown): message is NightlyRollbackMessage {
  return hasType(message, 'geld:nightly-rollback');
}

export function isNightlyInstallMessage(message: unknown): message is NightlyInstallMessage {
  return hasType(message, 'geld:nightly-install');
}

export function isNightlyInstallResult(value: unknown): value is NightlyInstallResult {
  if (typeof value !== 'object' || value === null || !('ok' in value)) return false;
  return value.ok === true ? 'version' in value && typeof value.version === 'string' : value.ok === false && 'reason' in value && typeof value.reason === 'string';
}
