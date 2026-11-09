/**
 * The history of one agent's note in the description, in GitHub's own small dialog (Primer's `Overlay`, as the Rerun
 * confirmation is built): the readings down the side, newest first, and the chosen one as GitHub rendered it beside
 * them. It reads the history as it lands (`onNotesChange`), so a window opened early fills in.
 */

import { createElement, OWN_UI_ATTRIBUTE, svgFromString } from '../dom';
import { ICON_X } from '../ui/icons';
import type { AgentNote, NoteVersion } from './agent-notes';
import { noteCopy, onNotesChange } from './agent-notes';
import { absoluteTimeText } from './time';

let historyIds = 0;

/** "Nov 4, 2026, 3:51 PM · current", or "Current" for the page's own reading when the history has no time for it. */
function versionLabel(version: NoteVersion): string {
  const when = version.at === null ? '' : absoluteTimeText(version.at);
  if (version.current) return when === '' ? 'Current' : `${when} · current`;
  return when === '' ? 'Earlier' : when;
}

/**
 * Open a note's history. `read` answers what is known of the note now and whether the description's history is still
 * being read; the window keeps to it until closed.
 */
export function openNoteHistory(read: () => { readonly note: AgentNote | undefined; readonly reading: boolean }): void {
  historyIds += 1;
  const titleId = `geld-note-history-${historyIds}-title`;
  const dialog = createElement('dialog', { class: 'Overlay Overlay-whenNarrow Overlay--size-large Overlay--motion-scaleFade geld-review__dialog geld-review__note-dialog', [OWN_UI_ATTRIBUTE]: '', 'aria-labelledby': titleId });
  const close = createElement('button', { type: 'button', class: 'close-button Overlay-closeButton', 'aria-label': 'Close' }, [svgFromString(ICON_X)]);
  const title = createElement('h1', { class: 'Overlay-title', id: titleId }, ['Note history']);
  const list = createElement('ul', { class: 'geld-review__note-versions', role: 'list' });
  const view = createElement('div', { class: 'markdown-body geld-review__note-version' });
  const status = createElement('p', { class: 'geld-review__note-status' });
  dialog.append(
    createElement('div', { class: 'Overlay-header Overlay-header--divided' }, [
      createElement('div', { class: 'Overlay-headerContentWrap' }, [createElement('div', { class: 'Overlay-titleWrap' }, [title]), createElement('div', { class: 'Overlay-actionWrap' }, [close])]),
    ]),
    createElement('div', { class: 'Overlay-body geld-review__note-dialog-body' }, [createElement('nav', { class: 'geld-review__note-nav', 'aria-label': 'Versions' }, [list, status]), view]),
  );
  /** The reading shown, by its time (`null` for the page's own); the newest until the reader picks another. */
  let chosen: string | null | undefined;
  const render = (): void => {
    const { note, reading } = read();
    title.textContent = note === undefined ? 'Note history' : `${note.name}’s note history`;
    const versions = note === undefined ? [] : [...note.versions].reverse();
    const shown = versions.find((version) => version.at === chosen) ?? versions[0];
    chosen = shown?.at;
    list.replaceChildren(
      ...versions.map((version) => {
        const button = createElement('button', { type: 'button', class: 'geld-review__note-version-btn', ...(version === shown ? { 'aria-current': 'true' } : {}) }, [versionLabel(version)]);
        button.addEventListener('click', () => {
          chosen = version.at;
          render();
        });
        return createElement('li', {}, [button]);
      }),
    );
    status.textContent = reading ? 'Reading the description’s edit history…' : versions.length === 1 ? 'The only version in the description’s history.' : '';
    view.replaceChildren(...(shown === undefined ? [createElement('p', {}, [reading ? 'Loading…' : 'No version of this note was found.'])] : noteCopy(shown.blocks)));
  };
  const stop = onNotesChange(() => {
    if (dialog.open) render();
  });
  const dismiss = (): void => {
    stop();
    if (dialog.open) dialog.close();
    dialog.remove();
  };
  close.addEventListener('click', dismiss);
  // A click on the backdrop lands on the dialog element itself, outside its children.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dismiss();
  });
  dialog.addEventListener('close', () => {
    stop();
    dialog.remove();
  });
  render();
  document.body.append(dialog);
  dialog.showModal();
  close.focus();
}
