/**
 * What holds a digest's rebuild back on every host: a menu of the digest's own that is open, a press inside it
 * that has not been released, or the reader typing in a field inside it. A rebuild then would close the menu,
 * lose the click or drop the caret, so the host waits and draws once the reader is done (`onRelease`).
 */
export interface RenderHold {
  /** Whether a rebuild must wait now; when it must, `onRelease` is called once it no longer does. */
  held(): boolean;
  dispose(): void;
}

/** Whether a menu matching `menus` is open under `root`. */
export function menusOpen(root: ParentNode, menus: string): boolean {
  return [...root.querySelectorAll<HTMLDetailsElement>(menus)].some((details) => details.open);
}

const TYPING = 'textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]), [contenteditable]:not([contenteditable="false"])';

export function watchRenderHold(root: HTMLElement, options: { readonly menus: string; readonly onRelease: () => void }): RenderHold {
  const doc = root.ownerDocument;
  const watch = new AbortController();
  let pressing = false;
  let waiting = false;
  const release = (): void => {
    if (!waiting || hold()) return;
    waiting = false;
    options.onRelease();
  };
  const hold = (): boolean => {
    if (pressing || menusOpen(root, options.menus)) return true;
    const active = doc.activeElement;
    return active instanceof Element && root.contains(active) && active.matches(TYPING);
  };
  // `toggle` does not bubble: one capturing listener hears every menu in the digest close.
  root.addEventListener('toggle', (event) => {
    if (event.target instanceof HTMLDetailsElement && !event.target.open) queueMicrotask(release);
  }, { capture: true, signal: watch.signal });
  root.addEventListener('pointerdown', (event) => {
    if (event.button === 0) pressing = true;
  }, { capture: true, signal: watch.signal });
  const lift = (): void => {
    if (!pressing) return;
    pressing = false;
    // The click follows the release: draw after it has run.
    setTimeout(release, 0);
  };
  doc.addEventListener('pointerup', lift, { capture: true, signal: watch.signal });
  doc.addEventListener('pointercancel', lift, { capture: true, signal: watch.signal });
  root.addEventListener('focusout', () => queueMicrotask(release), { signal: watch.signal });
  return {
    held(): boolean {
      if (!hold()) return false;
      waiting = true;
      return true;
    },
    dispose(): void {
      watch.abort();
      waiting = false;
      pressing = false;
    },
  };
}
