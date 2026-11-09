import { storage } from 'wxt/utils/storage';
import type { Conflict } from './conflicts';
import type { NightlyRelease } from './release';

/**
 * Both look on every GitHub page load and navigation (schedule.ts). Automatic installs a newer build as soon
 * as it is found; Manual marks the toolbar icon and waits for Install.
 */
export type UpdateMode = 'automatic' | 'manual';

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

/**
 * A write into the folder that began and has not yet ended whole. Until it does, the folder may hold parts of
 * two builds, so only the copy in IndexedDB (`whole`) is trusted, and `paths` are the files that may be Geld's.
 */
export interface NightlyWrite {
  readonly version: string;
  readonly whole: string;
  readonly paths: readonly string[];
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
  /** The release tag the API was last asked about, and when: the API is asked again only for a new tag (schedule.ts). */
  readonly askedTag: string | null;
  readonly askedAt: string | null;
  /** Sent back as `If-None-Match`, so an unchanged release comes back as a short 304. */
  readonly etag: string | null;
  /** The API limited Geld's requests: none is sent before this time. */
  readonly limitedUntil: string | null;
  readonly writing: NightlyWrite | null;
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
  askedTag: null,
  askedAt: null,
  etag: null,
  limitedUntil: null,
  writing: null,
};

export const nightlyStatusItem = /* @__PURE__ */ storage.defineItem<NightlyStatus>('local:nightlyStatus', { fallback: EMPTY_STATUS });

/** Each GitHub tab's hidden-file count, kept for the worker's next start so a tab's badge can take the ↑ too. */
export const nightlyTabCountsItem = /* @__PURE__ */ storage.defineItem<Readonly<Record<string, number>>>('session:nightlyTabCounts', { fallback: {} });

/** The other Geld that keeps this build from running (conflicts.ts), null while it may run. */
export const nightlyConflictItem = /* @__PURE__ */ storage.defineItem<Conflict | null>('local:nightlyConflict', { fallback: null });

export async function isNightlyPaused(): Promise<boolean> {
  return (await nightlyConflictItem.getValue()) !== null;
}
