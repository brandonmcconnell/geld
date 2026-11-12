import { buildOf, compareVersions } from '@geld/core/nightly';
import type { NightlyRelease } from '@geld/core/nightly';
import type { Conflict } from './conflicts';
import type { NightlyFolder, NightlyStatus, UpdateMode } from './state';

/** What the nightly panel says, worked out from the stored state alone, the same in the popup and on the page. */

export type NightlyAction = 'install' | 'retry' | 'restore' | 'rollback' | 'check' | 'connect' | 'manage';
export type NightlyTone = 'ok' | 'ready' | 'busy' | 'error' | 'paused' | 'needs-folder';

export interface NightlyView {
  readonly headline: string;
  readonly detail: string | null;
  readonly tone: NightlyTone;
  readonly action: { readonly kind: NightlyAction; readonly label: string } | null;
  /** Whether "Check for updates" sits under the action: once a folder is connected, except while a build installs or Nightly is paused. */
  readonly check: boolean;
  /** The build a recent update or rollback came from (`from 4163`), a tag beside the headline. */
  readonly from: string | null;
}

type ViewText = Omit<NightlyView, 'check' | 'from'> & { readonly from?: string };

export function buildLabel(version: string): string {
  const build = buildOf(version);
  return build === null ? version : `build ${build}`;
}

export function ago(iso: string, now: number): string {
  const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const seconds = (new Date(iso).getTime() - now) / 1000;
  if (Number.isNaN(seconds)) return '';
  if (Math.abs(seconds) < 60) return 'just now';
  if (Math.abs(seconds) < 3600) return relative.format(Math.round(seconds / 60), 'minute');
  if (Math.abs(seconds) < 86_400) return relative.format(Math.round(seconds / 3600), 'hour');
  return relative.format(Math.round(seconds / 86_400), 'day');
}

/** A change the reader may want to undo is offered for a day. */
const RECENT_MS = 24 * 60 * 60 * 1000;

export function pausedView(conflict: Conflict): ViewText {
  return conflict.kind === 'stable'
    ? {
        headline: 'Geld Nightly is paused',
        detail: 'Geld is also on in this profile, and only one can run at a time. Turn off or remove Geld and Geld Nightly starts on its own.',
        tone: 'paused',
        action: { kind: 'manage', label: 'Turn off Geld' },
      }
    : {
        headline: 'Geld Nightly is paused',
        detail: 'Another copy of Geld Nightly is on in this profile, and only one can run at a time. Turn off or remove one of them.',
        tone: 'paused',
        action: { kind: 'manage', label: 'Open the other copy' },
      };
}

export interface NightlyViewContext {
  readonly conflict?: Conflict | null;
  /** The folder the installer wrote, named so the reader knows what to pick when Chrome asks. */
  readonly installedIn?: string | null;
  readonly mode?: UpdateMode;
}

export function nightlyView(status: NightlyStatus, folder: NightlyFolder | null, version: string, now: number, context: NightlyViewContext = {}): NightlyView {
  const { conflict = null, installedIn = null, mode = 'automatic' } = context;
  const view = conflict === null ? viewText(status, folder, version, now, installedIn, mode) : pausedView(conflict);
  const check = folder !== null && view.tone !== 'busy' && view.tone !== 'paused';
  // A failed check is said in every state that offers one, beside whatever the line already says and does.
  const failed = check ? status.checkError : null;
  const detail = failed === null || view.detail?.includes(failed) === true ? view.detail : view.detail === null ? failed : `${view.detail} ${failed}`;
  return { ...view, detail, check, from: view.from ?? null };
}

/** Why the waiting build did not install, when that is still the case and newer than any failure of the same build. */
function blockerView(status: NightlyStatus, folder: NightlyFolder, newer: NightlyRelease, mode: UpdateMode): ViewText | null {
  const blocked = status.blocked;
  if (blocked === null || blocked.version !== newer.version || newer.version === status.skipped) return null;
  const failure = status.failure;
  if (failure !== null && failure.version === newer.version && Date.parse(failure.at) > Date.parse(blocked.at)) return null;
  const headline = `${capital(buildLabel(newer.version))} is ready`;
  if (blocked.need === 'permission') {
    const then = mode === 'automatic' ? 'later builds install on their own' : 'Chrome stops asking';
    return {
      headline,
      detail: `Chrome needs your OK before Geld can write to its folder. Choose Allow on every visit and ${then}.`,
      tone: 'ready',
      action: { kind: 'install', label: 'Allow and install' },
    };
  }
  if (Date.parse(blocked.at) < Date.parse(folder.connectedAt)) return null;
  return { headline, detail: blocked.reason, tone: 'ready', action: { kind: 'connect', label: 'Connect folder' } };
}

function viewText(status: NightlyStatus, folder: NightlyFolder | null, version: string, now: number, installedIn: string | null, mode: UpdateMode): ViewText {
  const latest = status.latest;
  const newer = latest !== null && compareVersions(latest.version, version) > 0 ? latest : null;
  if (status.installing !== null) {
    const back = compareVersions(status.installing, version) < 0;
    return { headline: `${back ? 'Going back to' : 'Installing'} ${buildLabel(status.installing)}…`, detail: 'Geld reloads when it is done.', tone: 'busy', action: null };
  }
  const failure = status.failure;
  if (failure?.broken === true) {
    return {
      headline: `Update to ${buildLabel(failure.version)} failed`,
      detail: `Geld could not put ${buildLabel(failure.stillOn)} back, so it may not start next time. ${failure.reason}`,
      tone: 'error',
      action: { kind: 'restore', label: `Restore ${buildLabel(failure.stillOn)}` },
    };
  }
  const blocker = folder === null || newer === null ? null : blockerView(status, folder, newer, mode);
  if (blocker !== null) return blocker;
  if (failure !== null && newer !== null && failure.version === newer.version) {
    return {
      headline: `Update to ${buildLabel(failure.version)} failed`,
      detail: `Still on ${buildLabel(failure.stillOn)}. ${failure.reason}`,
      tone: 'error',
      action: { kind: 'retry', label: 'Try again' },
    };
  }
  if (folder === null) {
    const which = installedIn === null ? 'the folder it runs from' : installedIn;
    return {
      headline: 'Folder not connected',
      detail: `Geld can only install builds once you connect ${which}.${installedIn === null ? '' : ' Pick it when Chrome asks.'}`,
      tone: 'needs-folder',
      action: { kind: 'connect', label: 'Connect folder' },
    };
  }
  if (newer !== null) {
    return {
      headline: `${capital(buildLabel(newer.version))} is ready`,
      detail: newer.version === status.skipped ? 'You went back from it, so it waits for you.' : null,
      tone: 'ready',
      action: { kind: 'install', label: 'Install' },
    };
  }
  const install = status.lastInstall;
  if (install !== null && install.to === version && now - new Date(install.at).getTime() < RECENT_MS) {
    if (install.rollback === true) {
      return { headline: `Back on ${buildLabel(version)}`, from: fromTag(install.from), detail: `Went back ${ago(install.at, now)}.`, tone: 'ok', action: null };
    }
    return {
      headline: 'Up to date',
      from: fromTag(install.from),
      detail: `Updated ${ago(install.at, now)}.`,
      tone: 'ok',
      action: status.backup === install.from ? { kind: 'rollback', label: 'Roll back' } : null,
    };
  }
  return {
    headline: 'Up to date',
    detail: status.checkError ?? (status.checkedAt === null ? 'Not checked yet.' : `Checked ${ago(status.checkedAt, now)}.`),
    tone: status.checkError === null ? 'ok' : 'error',
    action: null,
  };
}

function fromTag(version: string): string {
  return `from ${buildOf(version) ?? version}`;
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
