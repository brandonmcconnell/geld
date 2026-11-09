import { storage } from 'wxt/utils/storage';
import type { NightlyRelease } from './release';

/** How often the background asks GitHub for a newer build, in minutes. */
export const CHECK_INTERVALS = [5, 15, 30, 60, 180] as const;
export type CheckInterval = (typeof CHECK_INTERVALS)[number];

export interface NightlyPrefs {
  /** Install a newer build as soon as it is found, when Geld can write to its folder without asking. */
  readonly auto: boolean;
  readonly intervalMinutes: CheckInterval;
}

export const DEFAULT_NIGHTLY_PREFS: NightlyPrefs = { auto: true, intervalMinutes: 60 };

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
}

export interface NightlyStatus {
  readonly checkedAt: string | null;
  /** The latest release with a nightly build, whether or not it is newer than this one. */
  readonly latest: NightlyRelease | null;
  readonly checkError: string | null;
  readonly installing: string | null;
  readonly installError: string | null;
  readonly lastInstall: NightlyInstall | null;
  /** GitHub answers a matching `If-None-Match` with a 304, which costs nothing against the hourly API limit. */
  readonly etag: string | null;
}

export const EMPTY_STATUS: NightlyStatus = {
  checkedAt: null,
  latest: null,
  checkError: null,
  installing: null,
  installError: null,
  lastInstall: null,
  etag: null,
};

export const nightlyStatusItem = /* @__PURE__ */ storage.defineItem<NightlyStatus>('local:nightlyStatus', { fallback: EMPTY_STATUS });
