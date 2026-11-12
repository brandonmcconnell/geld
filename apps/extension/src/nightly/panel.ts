import { browser } from 'wxt/browser';
import { ICON_SYNC } from '../github/ui/icons';
import { buildLabel, nightlyView } from './view';
import type { NightlyAction } from './view';
import { manageUrl } from './conflicts';
import { readInstallRecord } from './writers';
import { nightlyConflictItem, nightlyFolderItem, nightlyPrefsItem, nightlyStatusItem, readNightlyStatus } from './state';
import type { UpdateMode } from './state';

/**
 * The nightly panel: which build this is, Manual or Automatic, and what is happening with updates, with the
 * one action that fits. The popup shows it at the top and the nightly page in its first card. Its styles are
 * injected from here, so store builds, which compile this module away, carry none of them.
 */

const STYLE_ID = 'geld-nightly-style';
const CSS = `
.geld-nightly { display: flex; flex-direction: column; gap: 10px; }
.geld-nightly__top, .geld-nightly__status { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.geld-nightly__name { font-weight: 600; font-size: 13px; white-space: nowrap; }
.geld-nightly__build { color: var(--muted-foreground); font-family: var(--font-mono); font-weight: 400; font-size: 12px; margin-left: 6px; }
.geld-nightly__modes { display: flex; flex-shrink: 0; gap: 4px; }
.geld-nightly__modes .geld-button { height: 24px; padding: 0 9px; font-size: 12px; }
.geld-nightly__text { min-width: 0; }
.geld-nightly__headline { font-size: 13px; font-weight: 500; }
.geld-nightly__detail { margin-top: 2px; color: var(--muted-foreground); font-size: 12px; overflow-wrap: anywhere; }
.geld-nightly__status[data-tone='error'] .geld-nightly__headline { color: var(--destructive); }
.geld-nightly__status[data-tone='busy'] .geld-nightly__headline { color: var(--muted-foreground); }
.geld-nightly__status[data-tone='paused'] { align-items: flex-start; flex-direction: column; padding: 10px 12px; border: 1px solid var(--destructive); }
.geld-nightly__status[data-tone='paused'] .geld-nightly__headline { color: var(--destructive); font-weight: 600; }
.geld-nightly__status .geld-button { flex-shrink: 0; }
.geld-nightly { --geld-nightly-amber: light-dark(oklch(0.56 0.13 65), oklch(0.82 0.14 80)); }
.geld-nightly__status[data-tone='needs-folder'] { padding: 10px 12px; border: 1px solid color-mix(in oklch, var(--geld-nightly-amber) 55%, transparent); background: color-mix(in oklch, var(--geld-nightly-amber) 8%, transparent); }
.geld-nightly__status[data-tone='needs-folder'] .geld-nightly__headline { color: var(--geld-nightly-amber); font-weight: 600; }
.geld-nightly__headrow { display: flex; align-items: center; gap: 4px; }
.geld-nightly__check { position: relative; display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; padding: 0; border: 0; background: none; color: var(--muted-foreground); cursor: pointer; }
.geld-nightly__check:hover, .geld-nightly__check:focus-visible { color: var(--foreground); }
.geld-nightly__check:focus-visible { outline: 2px solid var(--ring); outline-offset: 1px; }
.geld-nightly__check:disabled { cursor: default; }
.geld-nightly__check svg { width: 12px; height: 12px; }
.geld-nightly__check[aria-busy='true'] svg { animation: geld-nightly-spin 0.9s linear infinite; }
.geld-nightly__tip { position: absolute; top: calc(100% + 8px); left: 50%; z-index: 10; padding: 6px 8px; border: 1px solid var(--border); background: var(--popover); box-shadow: 0 4px 12px oklch(0 0 0 / 12%); color: var(--foreground); font-size: 12px; font-weight: 400; line-height: 1.4; white-space: nowrap; transform: translateX(-50%); pointer-events: none; visibility: hidden; }
.geld-nightly__tip::before { content: ''; position: absolute; top: -5px; left: calc(50% - 4px); width: 8px; height: 8px; border: 1px solid var(--border); border-right: 0; border-bottom: 0; background: var(--popover); transform: rotate(45deg); }
.geld-nightly__check:hover .geld-nightly__tip, .geld-nightly__check:focus-visible .geld-nightly__tip { visibility: visible; }
@keyframes geld-nightly-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .geld-nightly__check[aria-busy='true'] svg { animation: none; } }
`;

const MODES: ReadonlyArray<{ readonly mode: UpdateMode; readonly label: string; readonly title: string }> = [
  { mode: 'manual', label: 'Manual', title: 'Checks on every GitHub page and marks the toolbar icon when a build is ready' },
  { mode: 'automatic', label: 'Automatic', title: 'Checks on every GitHub page and installs a new build on its own' },
];

export type ActionHandler = (kind: NightlyAction) => Promise<string | null>;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

export function mountNightlyPanel(host: HTMLElement, act: ActionHandler): void {
  if (document.getElementById(STYLE_ID) === null) {
    const style = element('style', '');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.append(style);
  }
  const version = browser.runtime.getManifest().version;
  const name = element('span', 'geld-nightly__name', 'Nightly');
  name.append(element('span', 'geld-nightly__build', buildLabel(version)));
  const modes = element('div', 'geld-nightly__modes');
  modes.setAttribute('role', 'group');
  modes.setAttribute('aria-label', 'Updates');
  const modeButtons = MODES.map(({ mode, label, title }) => {
    const button = element('button', 'geld-button geld-button--small', label);
    button.type = 'button';
    button.title = title;
    button.addEventListener('click', () => void nightlyPrefsItem.setValue({ mode }));
    modes.append(button);
    return { mode, button };
  });
  const headline = element('p', 'geld-nightly__headline');
  headline.setAttribute('aria-live', 'polite');
  const detail = element('p', 'geld-nightly__detail');
  const check = element('button', 'geld-nightly__check');
  check.type = 'button';
  const checkIcon = document.createElement('template');
  checkIcon.innerHTML = ICON_SYNC;
  const checkTip = element('span', 'geld-nightly__tip');
  checkTip.setAttribute('aria-hidden', 'true');
  check.append(...checkIcon.content.childNodes, checkTip);
  const headrow = element('div', 'geld-nightly__headrow');
  headrow.append(headline, check);
  const text = element('div', 'geld-nightly__text');
  text.append(headrow, detail);
  const action = element('button', 'geld-button geld-button--small');
  action.type = 'button';
  const status = element('div', 'geld-nightly__status');
  status.append(text, action);
  const top = element('div', 'geld-nightly__top');
  top.append(name, modes);
  host.append(top, status);
  host.classList.add('geld-nightly');

  let localError: string | null = null;
  let busy = false;
  let checking = false;
  let current: NightlyAction | null = null;
  let blocker: string | null = null;
  let installedIn: string | null = null;
  void readInstallRecord().then((record) => {
    installedIn = record?.folder ?? null;
    void render();
  });

  const render = async (): Promise<void> => {
    const [state, folder, prefs, conflict] = await Promise.all([readNightlyStatus(), nightlyFolderItem.getValue(), nightlyPrefsItem.getValue(), nightlyConflictItem.getValue()]);
    blocker = conflict?.id ?? null;
    for (const { mode, button } of modeButtons) {
      button.setAttribute('aria-pressed', String(prefs.mode === mode));
    }
    const view = nightlyView(state, folder, version, Date.now(), { conflict, installedIn, mode: prefs.mode });
    headline.textContent = view.headline;
    detail.textContent = localError ?? view.detail ?? '';
    detail.hidden = detail.textContent === '';
    check.hidden = !view.check;
    check.disabled = checking || busy;
    check.setAttribute('aria-busy', String(checking));
    checkTip.textContent = checking ? 'Checking…' : 'Check for updates';
    check.setAttribute('aria-label', checking ? 'Checking for updates' : 'Check for updates');
    status.dataset['tone'] = localError === null ? view.tone : 'error';
    current = view.action?.kind ?? null;
    action.hidden = view.action === null;
    action.textContent = view.action?.label ?? '';
    action.classList.toggle('geld-button--primary', current === 'install' || current === 'restore');
    action.disabled = busy;
  };

  action.addEventListener('click', () => {
    if (current === null || busy) return;
    if (current === 'manage' && blocker !== null) {
      void browser.tabs.create({ url: manageUrl(blocker) });
      return;
    }
    const kind = current;
    busy = true;
    localError = null;
    const failedAt = async (): Promise<string | undefined> => (await readNightlyStatus()).failure?.at;
    void failedAt().then(async (before) => {
      const problem = await render()
        .then(() => act(kind))
        .catch((error: unknown) => (error instanceof DOMException && error.name === 'AbortError' ? null : error instanceof Error ? error.message : String(error)));
      // A failure the background recorded is already on the panel, with the builds it concerns.
      return problem !== null && (await failedAt()) !== before ? null : problem;
    }).then((problem) => {
        localError = problem;
        busy = false;
        return render();
      });
  });

  check.addEventListener('click', () => {
    if (checking || busy) return;
    checking = true;
    localError = null;
    void render()
      .then(() => act('check'))
      .catch((error: unknown) => (error instanceof Error ? error.message : String(error)))
      .then((problem) => {
        localError = problem;
        checking = false;
        return render();
      });
  });

  const rerender = (): void => {
    localError = null;
    void render();
  };
  nightlyStatusItem.watch(rerender);
  nightlyFolderItem.watch(rerender);
  nightlyPrefsItem.watch(rerender);
  nightlyConflictItem.watch(rerender);
  setInterval(() => void render(), 30_000);
  void render();
}
