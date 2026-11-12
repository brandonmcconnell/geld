import { buildOf, compareVersions } from '@geld/core/nightly';
import type { Conflict } from './conflicts';
import type { NightlyFolder, NightlyStatus } from './state';

/** What the nightly panel says, worked out from the stored state alone, the same in the popup and on the page. */

export type NightlyAction = 'install' | 'retry' | 'restore' | 'rollback' | 'check' | 'connect' | 'manage';
export type NightlyTone = 'ok' | 'ready' | 'busy' | 'error' | 'paused';

export interface NightlyView {
  readonly headline: string;
  readonly detail: string | null;
  readonly tone: NightlyTone;
  readonly action: { readonly kind: NightlyAction; readonly label: string } | null;
  /** Whether "Check for updates" sits under the action: once a folder is connected, except while a build installs or Nightly is paused. */
  readonly check: boolean;
}

type ViewText = Omit<NightlyView, 'check'>;

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

/** `installedIn`: the folder the installer wrote, named so the reader knows what to pick when Chrome asks. */
export function nightlyView(status: NightlyStatus, folder: NightlyFolder | null, version: string, now: number, conflict: Conflict | null = null, installedIn: string | null = null): NightlyView {
  const view = conflict === null ? viewText(status, folder, version, now, installedIn) : pausedView(conflict);
  return { ...view, check: folder !== null && view.tone !== 'busy' && view.tone !== 'paused' };
}

function viewText(status: NightlyStatus, folder: NightlyFolder | null, version: string, now: number, installedIn: string | null): ViewText {
  const latest = status.latest;
  const newer = latest !== null && compareVersions(latest.version, version) > 0 ? latest : null;
  if (status.installing !== null) {
    const back = compareVersions(status.installing, version) < 0;
    return { headline: `${back ? 'Going back to' : 'Installing'} ${buildLabel(status.installing)}…`, detail: 'Geld reloads when it is done.', tone: 'busy', action: null };
  }
  const failure = status.failure;
  if (failure !== null && (failure.broken === true || (newer !== null && failure.version === newer.version))) {
    if (failure.broken === true) {
      return {
        headline: `Update to ${buildLabel(failure.version)} failed`,
        detail: `Geld could not put ${buildLabel(failure.stillOn)} back, so it may not start next time. ${failure.reason}`,
        tone: 'error',
        action: { kind: 'restore', label: `Restore ${buildLabel(failure.stillOn)}` },
      };
    }
    return {
      headline: `Update to ${buildLabel(failure.version)} failed`,
      detail: `Still on ${buildLabel(failure.stillOn)}. ${failure.reason}`,
      tone: 'error',
      action: { kind: 'retry', label: 'Try again' },
    };
  }
  if (folder === null) {
    const which = installedIn === null ? 'the folder it runs from' : installedIn;
    const waiting = newer === null ? '' : `${capital(buildLabel(newer.version))} is ready. `;
    return {
      headline: 'Folder not connected',
      detail: `${waiting}Geld can only install builds once you connect ${which}.${installedIn === null ? '' : ' Pick it when Chrome asks.'}`,
      tone: 'ready',
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
      return { headline: `Back on ${buildLabel(version)}`, detail: `Went back from ${buildLabel(install.from)} ${ago(install.at, now)}.`, tone: 'ok', action: null };
    }
    return {
      headline: 'Up to date',
      detail: `Updated from ${buildLabel(install.from)} ${ago(install.at, now)}.`,
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

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
