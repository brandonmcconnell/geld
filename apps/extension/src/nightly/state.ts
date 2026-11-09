import { storage } from 'wxt/utils/storage';
import type { NightlyRelease } from './release';

/**
 * Automatic installs a newer build as soon as it finds one, and looks whenever a GitHub page loads once
 * `AUTOMATIC_CHECK_MS` has passed since the last look (and on that clock with no page loading).
 * Manual looks every `MANUAL_CHECK_MS` and only says a build is ready.
 */
export type UpdateMode = 'automatic' | 'manual';

export const AUTOMATIC_CHECK_MS = 30 * 60 * 1000;
export const MANUAL_CHECK_MS = 60 * 60 * 1000;

export interface NightlyPrefs {
  readonly mode: UpdateMode;
}

export const DEFAULT_NIGHTLY_PREFS: NightlyPrefs = { mode: 'automatic' };

export const nightlyPrefsItem = /* @__PURE__ */ storage.defineItem<NightlyPrefs>('local:nightlyPrefs', { fallback: DEFAULT_NIGHTLY_PREFS });

/** The folder Geld was loaded from, as connected on the nightly page. Its handle is kept in IndexedDB (handle-store.ts). */
export interface NightlyFolder {
  readonly name: string;
  /**
   * The folder sits directly in the browser's download folder, so the downloads API can write to it with no
   * grant. Null until an install first needs to know: the check writes into `<download folder>/<name>`.
   */
  readonly downloads: boolean | null;
  readonly connectedAt: string;
}

export const nightlyFolderItem = /* @__PURE__ */ storage.defineItem<NightlyFolder | null>('local:nightlyFolder', { fallback: null });

export type InstallMethod = 'folder' | 'downloads';

export interface NightlyInstall {
  readonly from: string;
  readonly to: string;
  readonly at: string;
  readonly method: InstallMethod;
  readonly rollback?: true;
}

export interface NightlyFailure {
  /** The build that did not install. */
  readonly version: string;
  /** The build Geld is still on: the one it was on before, put back when the write had begun. */
  readonly stillOn: string;
  readonly reason: string;
  readonly at: string;
  /** The write had begun, so the old build was written back. Automatic does not try this version again. */
  readonly restored?: true;
  /** The write broke off and writing the old build back failed too, so the folder holds parts of both. */
  readonly broken?: true;
}

export interface NightlyStatus {
  readonly checkedAt: string | null;
  /** The latest release with a nightly build, whether or not it is newer than this one. */
  readonly latest: NightlyRelease | null;
  readonly checkError: string | null;
  readonly installing: string | null;
  readonly failure: NightlyFailure | null;
  readonly lastInstall: NightlyInstall | null;
  /** A build the reader rolled back from: Automatic leaves it alone and waits for the next one. */
  readonly skipped: string | null;
  /** The version of the copy in IndexedDB (handle-store.ts) that Roll back writes. */
  readonly backup: string | null;
  /** GitHub answers a matching `If-None-Match` with a 304, which costs nothing against the hourly API limit. */
  readonly etag: string | null;
}

export const EMPTY_STATUS: NightlyStatus = {
  checkedAt: null,
  latest: null,
  checkError: null,
  installing: null,
  failure: null,
  lastInstall: null,
  skipped: null,
  backup: null,
  etag: null,
};

export const nightlyStatusItem = /* @__PURE__ */ storage.defineItem<NightlyStatus>('local:nightlyStatus', { fallback: EMPTY_STATUS });
