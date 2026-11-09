import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { svgFromString } from '../../src/github/dom';
import { ICON_ALERT } from '../../src/github/ui/icons';
import type { NightlyManageMessage } from '../../src/nightly/messages';
import { nightlyConflictItem } from '../../src/nightly/state';
import type { Conflict } from '../../src/nightly/conflicts';
import './style.css';

/**
 * Nightly builds only, and only while paused (src/nightly/pause.ts registers it then). Geld Stable runs the
 * page. This copy starts no Geld of its own and never announces itself, so Stable keeps working: it only
 * marks Stable's Geld bar, digest or digest-off line, with the conflict, and its stylesheet hides the
 * digest and the view switch under it so the bar is the one thing to act on. Stable does not know about it.
 */

const ATTR = 'data-geld-nightly-paused';
const NOTE = 'geld-nightly-conflict';
const BARS = '.geld-review__summary, .geld-digest-off, .geld-provider-review__header, .geld-provider-view';

function noteFor(conflict: Conflict): HTMLElement {
  const note = document.createElement('span');
  note.className = NOTE;
  const text = document.createElement('span');
  text.className = `${NOTE}__text`;
  text.textContent =
    conflict.kind === 'stable' ? 'Geld Nightly is paused because Geld is also on. Only one can run at a time.' : 'Geld Nightly is paused because another copy of it is on. Only one can run at a time.';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `btn btn-sm ${NOTE}__button`;
  button.textContent = conflict.kind === 'stable' ? 'Turn off Geld' : 'Open the other copy';
  button.addEventListener('click', () => {
    const message: NightlyManageMessage = { type: 'geld:nightly-manage' };
    void browser.runtime.sendMessage(message).catch(() => undefined);
  });
  note.append(svgFromString(ICON_ALERT), text, button);
  return note;
}

export default defineContentScript({
  matches: ['https://github.com/*'],
  registration: 'runtime',
  async main(ctx) {
    const marker = 'geldNightlyConflict';
    if (Reflect.get(globalThis, marker) === true) return;
    Reflect.set(globalThis, marker, true);
    let conflict = await nightlyConflictItem.getValue();
    let queued = false;

    const mark = (): void => {
      queued = false;
      if (conflict === null) return;
      document.documentElement.setAttribute(ATTR, '');
      for (const bar of document.querySelectorAll(BARS)) {
        if (bar.querySelector(`:scope > .${NOTE}`) === null) bar.append(noteFor(conflict));
      }
    };
    const clear = (): void => {
      document.documentElement.removeAttribute(ATTR);
      for (const note of document.querySelectorAll(`.${NOTE}`)) note.remove();
    };
    const observer = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(mark);
    });
    const stop = (): void => {
      observer.disconnect();
      clear();
      Reflect.set(globalThis, marker, false);
    };

    observer.observe(document, { childList: true, subtree: true });
    mark();
    // The reloaded or unpaused build cleans up after this copy: an orphaned one would hide its digest for good.
    ctx.onInvalidated(stop);
    const unwatch = nightlyConflictItem.watch((next) => {
      conflict = next;
      if (next !== null) return mark();
      unwatch();
      stop();
    });
  },
});
