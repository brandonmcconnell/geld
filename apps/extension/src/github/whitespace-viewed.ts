import { OWN_UI_ATTRIBUTE } from './dom';

/**
 * GitHub-native "hide whitespace changes" is just `?w=1` on diff pages. We
 * redirect once per page load when a diff page was opened without it, and
 * back off if GitHub strips the parameter (which would otherwise loop).
 */
export class WhitespaceRedirector {
  private static readonly KEY_PREFIX = 'geld:whitespace:';
  /** A page that started loading this soon after our redirect is the redirect's result. */
  private static readonly LOOP_WINDOW_MS = 4000;
  private redirected = false;

  constructor(
    /** Whether GitHub already remembers the preference for this signed-in user. */
    private persisted: boolean,
    private readonly onPersisted: () => void,
  ) {}

  setPersisted(value: boolean): void {
    this.persisted = value;
  }

  private menuAttempted = false;
  /** The embedded preference belongs to the document's first page; SPA navigations leave it stale. */
  private initialPage: string | null = null;
  private embeddedAtLoad: boolean | null = null;

  ensure(url: URL, pageKey: string): void {
    if (this.redirected || url.searchParams.get('w') === '1') return;
    const signedIn = document.body.classList.contains('logged-in') || document.querySelector('meta[name="user-login"][content]:not([content=""])') !== null;

    if (this.initialPage === null) {
      this.initialPage = pageKey;
      this.embeddedAtLoad = readEmbeddedIgnoreWhitespace();
    }
    const embedded = this.initialPage === pageKey ? this.embeddedAtLoad : null;

    // React views embed the user's persisted diff preference. Already on: done.
    if (embedded === true) {
      if (signedIn && !this.persisted) this.markPersisted();
      return;
    }
    // GitHub remembers the preference for signed-in users; never re-apply it.
    if (signedIn && this.persisted) return;

    if (embedded === false && signedIn && !this.menuAttempted) {
      // Flip GitHub's own "Hide whitespace" setting through its diff-settings
      // menu, which GitHub persists and applies without a reload. Falls back to
      // the URL parameter if the menu cannot be driven.
      this.menuAttempted = true;
      void toggleWhitespaceViaMenu().then((done) => {
        if (done) this.markPersisted();
        else this.ensure(new URL(window.location.href), pageKey);
      });
      return;
    }

    // GitHub's own "Diff settings" form (legacy view). Its checkbox reflects
    // the effective state, and submitting it is exactly "Apply and reload",
    // which GitHub persists for signed-in users.
    const checkbox = document.querySelector<HTMLInputElement>('form[action$="/diffview"] input[type="checkbox"][name="w"]');
    if (checkbox !== null) {
      if (checkbox.checked) {
        if (signedIn && !this.persisted) this.markPersisted();
        return;
      }
      const form = checkbox.form;
      if (signedIn && form !== null) {
        this.redirected = true;
        checkbox.checked = true;
        this.markPersisted();
        form.requestSubmit();
        return;
      }
    }

    // No form (React view) and no menu: fall back to the URL parameter.
    const key = `${WhitespaceRedirector.KEY_PREFIX}${url.pathname}`;
    const previous = safeSessionGet(key);
    if (previous === 'unsupported') return;
    const last = Number.parseInt(previous ?? '0', 10);
    const navigationStart = performance.timeOrigin;
    if (Number.isFinite(last) && last > 0 && navigationStart - last < WhitespaceRedirector.LOOP_WINDOW_MS && navigationStart >= last) {
      // This document is the one our redirect produced, yet the parameter is
      // gone: GitHub dropped it, so stop trying on this path for the session.
      safeSessionSet(key, 'unsupported');
      return;
    }
    this.redirected = true;
    safeSessionSet(key, String(Date.now()));
    const target = new URL(url.toString());
    target.searchParams.set('w', '1');
    window.location.replace(target.toString());
  }

  private markPersisted(): void {
    if (this.persisted) return;
    this.persisted = true;
    this.onPersisted();
  }
}

function safeSessionGet(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSessionSet(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Storage may be unavailable (privacy modes); the redirect still works, it just may repeat.
  }
}

const FILES_TAB = /\/pull\/\d+\/(?:files|changes)\/?$/;

/** Point "Files changed" links at `?w=1` so navigating there needs no redirect. */
export function rewriteFilesLinksForWhitespace(): void {
  for (const link of document.querySelectorAll<HTMLAnchorElement>('a[href*="/pull/"][href*="/files"], a[href*="/pull/"][href*="/changes"]')) {
    if (link.closest(`[${OWN_UI_ATTRIBUTE}]`) !== null) continue;
    let url: URL;
    try {
      url = new URL(link.href, window.location.origin);
    } catch {
      continue;
    }
    if (url.origin !== window.location.origin || !FILES_TAB.test(url.pathname)) continue;
    if (url.searchParams.get('w') === '1') continue;
    url.searchParams.set('w', '1');
    link.setAttribute('href', `${url.pathname}${url.search}${url.hash}`);
  }
}

/** Find unchecked "Viewed" controls inside a diff entry (only present when signed in). */
export interface ViewedControls {
  /** Controls that are still off ("Not Viewed"). */
  readonly unviewed: HTMLElement[];
  /** Controls that are already on. */
  readonly viewed: HTMLElement[];
}

/**
 * Every "Viewed" control inside `root`, split by state. Legacy: a checkbox
 * (`input.js-reviewed-checkbox`). React files view: a toggle button whose
 * label is "Viewed" / "Not Viewed" with `aria-pressed`. Both are matched by
 * their accessible name so a class rename does not silently break this.
 */
export function findViewedControls(root: HTMLElement): ViewedControls {
  const unviewed: HTMLElement[] = [];
  const viewed: HTMLElement[] = [];
  for (const input of root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
    if (input.closest(`[${OWN_UI_ATTRIBUTE}]`) !== null) continue;
    if (!input.classList.contains('js-reviewed-checkbox') && !/viewed/i.test(accessibleName(input))) continue;
    (input.checked ? viewed : unviewed).push(input);
  }
  for (const button of root.querySelectorAll<HTMLButtonElement>('button[aria-pressed], button[aria-checked], button[role="switch"]')) {
    if (button.closest(`[${OWN_UI_ATTRIBUTE}]`) !== null) continue;
    if (!/viewed/i.test(accessibleName(button))) continue;
    const on = button.getAttribute('aria-pressed') === 'true' || button.getAttribute('aria-checked') === 'true';
    (on ? viewed : unviewed).push(button);
  }
  return { unviewed, viewed };
}

/**
 * Turn a control on the way a user would. Checkboxes toggle and fire `change`
 * through `click()`; React buttons get the pointer/mouse sequence a real
 * click produces, since a top-level delegated handler may look at more than
 * the `click` itself.
 */
export function activateControl(control: HTMLElement): void {
  if (!control.isConnected) return;
  if (control instanceof HTMLInputElement) {
    control.click();
    return;
  }
  const init: PointerEventInit = { bubbles: true, cancelable: true, composed: true, button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true };
  control.dispatchEvent(new PointerEvent('pointerdown', init));
  control.dispatchEvent(new MouseEvent('mousedown', init));
  control.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0 }));
  control.dispatchEvent(new MouseEvent('mouseup', { ...init, buttons: 0 }));
  control.click();
}

function accessibleName(element: HTMLElement): string {
  const label = element.getAttribute('aria-label');
  if (label !== null && label.trim() !== '') return label;
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy !== null) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ')
      .trim();
    if (text !== '') return text;
  }
  const wrapping = element.closest('label');
  if (wrapping !== null) return (wrapping.textContent ?? '').trim();
  if (element instanceof HTMLInputElement && element.id !== '') {
    const forLabel = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
    if (forLabel !== null) return (forLabel.textContent ?? '').trim();
  }
  return (element.textContent ?? '').trim();
}

/** `"ignoreWhitespace": true|false` from the React app's embedded payload, if present. */
function readEmbeddedIgnoreWhitespace(): boolean | null {
  for (const script of document.querySelectorAll('script[type="application/json"]')) {
    const match = /"ignoreWhitespace"\s*:\s*(true|false)/.exec(script.textContent ?? '');
    if (match !== null) return match[1] === 'true';
  }
  return null;
}

const MENU_TIMEOUT_MS = 1500;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor<T>(probe: () => T | null, timeoutMs: number): Promise<T | null> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const value = probe();
    if (value !== null) return value;
    await wait(50);
  }
  return null;
}

function findDiffSettingsButton(): HTMLButtonElement | null {
  for (const button of document.querySelectorAll<HTMLButtonElement>('button')) {
    if (button.closest(`[${OWN_UI_ATTRIBUTE}]`) !== null) continue;
    if (/diff (view )?settings/i.test(accessibleName(button))) return button;
  }
  return null;
}

function findWhitespaceMenuItem(): HTMLElement | null {
  const candidates = document.querySelectorAll<HTMLElement>(
    '[role="menuitemcheckbox"], [role="checkbox"], [role="switch"], input[type="checkbox"], [role="menuitem"]',
  );
  for (const candidate of candidates) {
    if (candidate.closest(`[${OWN_UI_ATTRIBUTE}]`) !== null) continue;
    if (candidate instanceof HTMLInputElement && candidate.name === 'w') continue; // legacy form, handled separately
    if (/whitespace/i.test(accessibleName(candidate))) return candidate;
  }
  return null;
}

function isChecked(element: HTMLElement): boolean {
  if (element instanceof HTMLInputElement) return element.checked;
  return element.getAttribute('aria-checked') === 'true';
}

function closeMenus(): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
}

/**
 * Turn on GitHub's "Hide whitespace" through its own diff-settings menu.
 * Resolves `true` when the setting is on afterwards (or already was).
 */
async function toggleWhitespaceViaMenu(): Promise<boolean> {
  const gear = findDiffSettingsButton();
  if (gear === null) return false;
  gear.click();
  const item = await waitFor(findWhitespaceMenuItem, MENU_TIMEOUT_MS);
  if (item === null) {
    closeMenus();
    return false;
  }
  if (!isChecked(item)) {
    item.click();
    await wait(150);
  }
  closeMenus();
  await wait(50);
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  return true;
}
