import { OWN_UI_ATTRIBUTE } from './dom';
import { describePage } from './page';

/**
 * Diff pages the reader has turned "Hide whitespace" off on, by page key
 * (`/owner/repo/pull/N`, a commit's or a compare's path): when they were
 * opted out. Kept on this device; the oldest fall off past `OPT_OUT_CAP`.
 */
export type WhitespaceOptOuts = Readonly<Record<string, number>>;
const OPT_OUT_CAP = 300;

const DIFF_KINDS = new Set(['pull-files', 'pull-review', 'commit', 'compare']);
const SESSION_PREFIX = 'geld:whitespace:';
/** A page that started loading this soon after our redirect is the redirect's result. */
const LOOP_WINDOW_MS = 4000;
/** How long a path GitHub stripped the parameter from is left alone before one more try (a stray hit on the loop guard costs a minute, not the session). */
const UNSUPPORTED_MS = 60_000;

/**
 * GitHub's "Hide whitespace changes" is URL state: `?w=1` on a diff page
 * hides them, `?w=0` is what its diff-settings menu writes when the reader
 * unchecks the option, and nothing is remembered between pull requests (the
 * React files view used to persist the preference; it no longer does, so a
 * flag that said "GitHub remembers it, never re-apply" switched Geld off for
 * good). So Geld adds `?w=1` to every diff page opened without a `w` - at
 * `document_start`, before anything renders, when it can (`redirectEarly`),
 * else once the view is there - unless the reader has opted that page out:
 * a `?w=0` on a page records the opt-out, a `?w=1` on an opted-out page
 * (which only the reader can produce, since Geld neither redirects nor
 * rewrites links there) clears it. The legacy view's own diff-settings form
 * is submitted instead when it is there, since GitHub persists that one.
 * A redirect GitHub strips the parameter from is not repeated for the session.
 */
export class WhitespaceRedirector {
  /** Pages this document has already redirected or submitted for: never twice in one document. */
  private readonly handled = new Set<string>();
  /** The embedded preference belongs to the document's first page; SPA navigations leave it stale. */
  private initialPage: string | null = null;
  private embeddedAtLoad: boolean | null = null;

  constructor(
    private optOuts: WhitespaceOptOuts,
    private readonly onOptOuts: (next: WhitespaceOptOuts) => void,
  ) {}

  setOptOuts(value: WhitespaceOptOuts): void {
    this.optOuts = value;
  }

  isOptedOut(pageKey: string): boolean {
    return pageKey in this.optOuts;
  }

  ensure(url: URL, pageKey: string): void {
    const w = url.searchParams.get('w');
    if (w === '0') {
      this.optOut(pageKey);
      return;
    }
    if (w === '1') {
      if (this.isOptedOut(pageKey)) this.optIn(pageKey);
      return;
    }
    if (w !== null || this.isOptedOut(pageKey) || this.handled.has(pageKey)) return;

    if (this.initialPage === null) {
      this.initialPage = pageKey;
      this.embeddedAtLoad = readEmbeddedHideWhitespace();
    }
    // A persisted preference GitHub still honours (its payload carries one): already on, nothing to add.
    if (this.initialPage === pageKey && this.embeddedAtLoad === true) return;

    // GitHub's own "Diff settings" form (legacy view). Its checkbox reflects the effective state, and
    // submitting it is exactly "Apply and reload", which GitHub persists for signed-in users.
    const checkbox = document.querySelector<HTMLInputElement>('form[action$="/diffview"] input[type="checkbox"][name="w"]');
    if (checkbox !== null) {
      if (checkbox.checked) return;
      const signedIn = document.body.classList.contains('logged-in') || document.querySelector('meta[name="user-login"][content]:not([content=""])') !== null;
      const form = checkbox.form;
      if (signedIn && form !== null) {
        this.handled.add(pageKey);
        checkbox.checked = true;
        form.requestSubmit();
        return;
      }
    }

    if (redirectWithWhitespaceHidden(url)) this.handled.add(pageKey);
  }

  private optOut(pageKey: string): void {
    if (this.isOptedOut(pageKey)) return;
    const entries = Object.entries(this.optOuts).sort((a, b) => a[1] - b[1]);
    while (entries.length >= OPT_OUT_CAP) entries.shift();
    entries.push([pageKey, Date.now()]);
    this.optOuts = Object.fromEntries(entries);
    this.onOptOuts(this.optOuts);
  }

  private optIn(pageKey: string): void {
    const next = { ...this.optOuts };
    delete next[pageKey];
    this.optOuts = next;
    this.onOptOuts(this.optOuts);
  }
}

/**
 * The `document_start` redirect: a diff page opened without a `w`, with the
 * setting on and the page not opted out, is replaced by its `?w=1` form
 * before GitHub has rendered anything, so the reader never sees the page
 * twice. Returns whether a redirect was issued.
 */
export function redirectEarly(url: URL, optOuts: WhitespaceOptOuts): boolean {
  const page = describePage(url);
  if (!DIFF_KINDS.has(page.kind) || url.searchParams.has('w') || page.stateKey in optOuts) return false;
  return redirectWithWhitespaceHidden(url);
}

/** Replace the page with its `?w=1` form, unless this document is already that redirect's result without it. */
function redirectWithWhitespaceHidden(url: URL): boolean {
  const key = `${SESSION_PREFIX}${url.pathname}`;
  const previous = safeSessionGet(key) ?? '';
  const now = Date.now();
  if (previous.startsWith('unsupported:')) {
    if (now - Number.parseInt(previous.slice('unsupported:'.length), 10) < UNSUPPORTED_MS) return false;
  } else {
    const last = Number.parseInt(previous || '0', 10);
    const navigationStart = performance.timeOrigin;
    if (Number.isFinite(last) && last > 0 && navigationStart - last < LOOP_WINDOW_MS && navigationStart >= last) {
      // This document is the one our redirect produced, yet the parameter is
      // gone: GitHub dropped it, so leave this path alone for a while.
      safeSessionSet(key, `unsupported:${now}`);
      return false;
    }
  }
  safeSessionSet(key, String(now));
  const target = new URL(url.toString());
  target.searchParams.set('w', '1');
  window.location.replace(target.toString());
  return true;
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

/** The Files tab and its per-commit forms: `/files`, `/changes`, `/files/<sha>`, `/changes/<base>..<head>`. */
const FILES_TAB = /^(\/[^/]+\/[^/]+\/pull\/\d+)\/(?:files|changes)(?:\/[^/]+)?\/?$/;

/**
 * Point "Files changed" links (the tab, "View reviewed changes", a review's
 * commit range) at `?w=1`, so navigating there needs no redirect. Links into
 * a pull request the reader opted out of are left alone: following one would
 * read as opting back in.
 */
export function rewriteFilesLinksForWhitespace(optedOut: (pageKey: string) => boolean): void {
  for (const link of document.querySelectorAll<HTMLAnchorElement>('a[href*="/pull/"][href*="/files"], a[href*="/pull/"][href*="/changes"]')) {
    if (link.closest(`[${OWN_UI_ATTRIBUTE}]`) !== null) continue;
    let url: URL;
    try {
      url = new URL(link.href, window.location.origin);
    } catch {
      continue;
    }
    if (url.origin !== window.location.origin) continue;
    const match = FILES_TAB.exec(url.pathname);
    const pageKey = match?.[1];
    if (pageKey === undefined || optedOut(pageKey)) continue;
    if (url.searchParams.has('w')) continue;
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

/**
 * The persisted whitespace preference in the React app's embedded payload,
 * if it carries one: `"viewSettings":{"hideWhitespace":…}` today,
 * `"ignoreWhitespace":…` in the earlier payload.
 */
function readEmbeddedHideWhitespace(): boolean | null {
  for (const script of document.querySelectorAll('script[type="application/json"]')) {
    const match = /"(?:hideWhitespace|ignoreWhitespace)"\s*:\s*(true|false)/.exec(script.textContent ?? '');
    if (match !== null) return match[1] === 'true';
  }
  return null;
}
