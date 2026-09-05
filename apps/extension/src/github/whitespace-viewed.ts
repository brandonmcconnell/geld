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

  ensure(url: URL): void {
    if (this.redirected || url.searchParams.get('w') === '1') return;
    const signedIn = document.body.classList.contains('logged-in') || document.querySelector('meta[name="user-login"][content]:not([content=""])') !== null;

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

    // No form (React view): once GitHub remembers the preference there is
    // nothing to do; otherwise fall back to the URL parameter.
    if (signedIn && this.persisted) return;
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

const FILES_TAB = /\/pull\/\d+\/files\/?$/;

/** Point "Files changed" links at `?w=1` so navigating there needs no redirect. */
export function rewriteFilesLinksForWhitespace(): void {
  for (const link of document.querySelectorAll<HTMLAnchorElement>('a[href*="/pull/"][href*="/files"]')) {
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
export function findUnviewedControls(root: HTMLElement): HTMLElement[] {
  const controls: HTMLElement[] = [];
  for (const input of root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:not(:checked)')) {
    if (input.closest(`[${OWN_UI_ATTRIBUTE}]`) !== null) continue;
    if (input.classList.contains('js-reviewed-checkbox') || /viewed/i.test(accessibleName(input))) controls.push(input);
  }
  for (const button of root.querySelectorAll<HTMLButtonElement>('button[aria-pressed="false"], button[aria-checked="false"]')) {
    if (button.closest(`[${OWN_UI_ATTRIBUTE}]`) !== null) continue;
    if (/viewed/i.test(accessibleName(button))) controls.push(button);
  }
  return controls;
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
