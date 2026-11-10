import { BitbucketWhitespaceLease } from './whitespace-lease';
import type { NativeWhitespaceSnapshot } from './whitespace-lease';
export const WHITESPACE_REQUEST = 'geld:bitbucket-whitespace-request';
export const WHITESPACE_READY = 'geld:bitbucket-whitespace-ready';
export const WHITESPACE_RESPONSE = 'geld:bitbucket-whitespace-response';
const TAKEOVER = 'geld:bitbucket-whitespace-takeover';
const ACTION = 'diffSettings/UPDATE_GLOBAL_SHOULD_IGNORE_WHITESPACE_SUCCESS';
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function field(value: unknown, name: string): unknown { return object(value) ? value[name] : undefined; }
interface Binding { readonly owner: object; current(): boolean; read(): unknown; dispatch(value: boolean): void; subscribe(callback: () => void): () => void; select(name: string, state: unknown): unknown }
function binding(host: Window): Binding | null {
  const loader: unknown = Reflect.get(host, 'parcelRequirecbf3');if (typeof loader !== 'function') return null;
  try {
    const module: unknown = loader.call(host, 'jSBTO'), selectors: unknown = loader.call(host, 'cZORy'), settings: unknown = loader.call(host, 'fozrM');
    const store = field(module, 'bitbucketStore'), get = field(store, 'getState'), dispatch = field(store, 'dispatch'), subscribe = field(store, 'subscribe');
    if (!object(store) || typeof get !== 'function' || typeof dispatch !== 'function' || typeof subscribe !== 'function' || !object(selectors)
      || field(settings, 'UPDATE_GLOBAL_SHOULD_IGNORE_WHITESPACE_SUCCESS') !== ACTION) return null;
    for (const name of ['getCurrentPullRequestId', 'getCurrentPullRequestUrlPieces', 'getPullRequestSourceHash', 'getPullRequestDestinationHash', 'getPullRequestSourceRepo']) if (typeof selectors[name] !== 'function') return null;
    return { owner: store, current: () => {
      try { return Reflect.get(host, 'parcelRequirecbf3') === loader && field(loader.call(host, 'jSBTO'), 'bitbucketStore') === store && loader.call(host, 'cZORy') === selectors && loader.call(host, 'fozrM') === settings; } catch { return false; }
    }, read: () => get.call(store), dispatch: value => { dispatch.call(store, { type: ACTION, payload: { shouldIgnoreWhitespace: value } }); },
      subscribe: callback => { const off: unknown = subscribe.call(store, callback);return typeof off === 'function' ? () => { off(); } : () => undefined; },
      select: (name, state) => { const fn = selectors[name];return typeof fn === 'function' ? fn.call(selectors, state) : undefined; } };
  } catch { return null; }
}
function route(doc: Document): { readonly repository: string; readonly number: string; readonly href: string } | null {
  try { const url = new URL(doc.URL), match = /^\/([^/]+\/[^/]+)\/pull-requests\/([1-9]\d*)\/diff\/?$/.exec(url.pathname);
    return url.origin === 'https://bitbucket.org' && !url.username && !url.password && url.search === '' && match?.[1] !== undefined && match[2] !== undefined ? { repository: match[1], number: match[2], href: url.origin + url.pathname } : null;
  } catch { return null; }
}
function opener(doc: Document): HTMLButtonElement | null {
  const candidates = [...doc.querySelectorAll<HTMLButtonElement>('#pull-request-tabs-1-tab[role="tabpanel"] button[aria-live="polite"][type="button"]')]
    .filter(node => node.isConnected && !node.disabled && node.closest('[data-geld-ui],[hidden],[inert],form') === null && ['Global diff settings', 'Global diff view settings'].includes(node.textContent?.trim() ?? ''));
  return candidates.length === 1 ? candidates[0] ?? null : null;
}
function nativeAlert(doc: Document, target?: Element): boolean {
  const alerts = target === undefined ? [...doc.querySelectorAll('[role="alert"]')] : [target.closest('[role="alert"]')];
  return alerts.some(node => {
    if (node === null || !node.isConnected || !node.textContent?.trim() || node.closest('[data-geld-ui],.ak-renderer-document,[data-testid="comment"],[data-testid="comment-content"],[data-qa="pr-activity"],[data-qa="pull-request-description"],[hidden],[inert],[aria-hidden="true"]') !== null) return false;
    for (let parent: Element | null = node; parent !== null; parent = parent.parentElement) {
      const style = doc.defaultView?.getComputedStyle(parent);
      if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse' || style?.opacity === '0') return false;
    }
    return true;
  });
}
/** Fixed boolean protocol; no storage, arbitrary module names or general dispatch. */
export function startBitbucketNativeWhitespace(doc: Document, host: Window): () => void {
  if (host.top !== host || new URL(doc.URL).origin !== 'https://bitbucket.org') return () => undefined;
  doc.dispatchEvent(new Event(TAKEOVER));let native: Binding | null = null, off: (() => void) | null = null, id = '', active = false, stopped = false, revoked = false, startedAt = 0;
  let lastQualified: NativeWhitespaceSnapshot | null = null;
  const read = (): NativeWhitespaceSnapshot | null => {
    let fallback: NativeWhitespaceSnapshot | null = null;
    try {
      const page = route(doc);if (native === null && active && !revoked && page !== null && doc.querySelectorAll('[data-testid="pr-header"]').length === 1 && opener(doc) !== null) {
        native = binding(host);if (native !== null) off = native.subscribe(() => tick());
      }
      if (native === null) return null;
      const state = native.read(), global = field(state, 'global'), settings = field(state, 'diffSettings'), slice = field(field(state, 'repository'), 'pullRequest');
      if (lastQualified !== null && object(settings) && typeof settings.globalShouldIgnoreWhitespace === 'boolean') fallback = { ...lastQualified, owner: native.owner, settings, current: false, detached: true, value: settings.globalShouldIgnoreWhitespace, busy: true };
      const pieces = native.select('getCurrentPullRequestUrlPieces', state), number = native.select('getCurrentPullRequestId', state), head = native.select('getPullRequestSourceHash', state), base = native.select('getPullRequestDestinationHash', state), sourceRepo = native.select('getPullRequestSourceRepo', state);
      if (!object(global) || typeof global.locale !== 'string' || !global.locale || !object(sourceRepo) || typeof sourceRepo.full_name !== 'string' || !/^[^/\s]+\/[^/\s]+$/.test(sourceRepo.full_name) || !object(settings) || !object(slice) || !object(pieces) || typeof pieces.owner !== 'string' || typeof pieces.slug !== 'string' || !Number.isSafeInteger(number)
        || typeof head !== 'string' || !/^(?:[a-f0-9]{7,40}|[a-f0-9]{64})$/i.test(head) || typeof base !== 'string' || !/^(?:[a-f0-9]{7,40}|[a-f0-9]{64})$/i.test(base) || typeof settings.globalShouldIgnoreWhitespace !== 'boolean' || typeof settings.isDialogOpen !== 'boolean'
        || typeof settings.isDialogLoading !== 'boolean' || typeof slice.isDiffsLoading !== 'boolean' || typeof slice.isDiffStatLoading !== 'boolean' || !Array.isArray(slice.diff) || !Array.isArray(slice.diffStat)) return fallback;
      const repository = `${pieces.owner}/${pieces.slug}`, source = JSON.stringify([repository, String(number), sourceRepo.full_name, head.toLowerCase(), base.toLowerCase()]);
      const current = !nativeAlert(doc) && page !== null && page.repository === repository && page.number === String(number) && opener(doc) !== null
        && doc.querySelectorAll('[role="region"][aria-label="Diff"]').length === 1
        && [...doc.querySelectorAll('[data-testid="pr-header"]')].some(node => new RegExp(`^#${page.number}\\s*•`).test(node.querySelector('[data-qa="pr-branches-and-state-styles"]')?.nextElementSibling?.textContent?.trim() ?? ''))
        && [...doc.querySelectorAll('button[aria-haspopup="true"],[role="button"][aria-haspopup="true"]')].filter(node => node.textContent?.trim() === 'All changes' && node.getAttribute('aria-expanded') === 'false').length === 1;
      const snapshot = { owner: native.owner, settings, subject: source, current, detached: page === null, value: settings.globalShouldIgnoreWhitespace, open: settings.isDialogOpen, loading: settings.isDialogLoading,
        failed: slice.diffErrorCode !== null || slice.diffStatErrorCode !== null, diffLoading: slice.isDiffsLoading, statsLoading: slice.isDiffStatLoading, busy: slice.isDiffsLoading || slice.isDiffStatLoading || slice.diffErrorCode !== null || slice.diffStatErrorCode !== null, diff: slice.diff, stats: slice.diffStat };
      if (current) lastQualified = snapshot;
      return snapshot;
    } catch { return fallback; }
  };
  const publish = (): void => {
    if (stopped || !id) return;
    const snapshot = read(), value = lease.state();
    const starting = active && !revoked && snapshot === null && Date.now() - startedAt < 10_000;
    doc.dispatchEvent(new CustomEvent(WHITESPACE_RESPONSE, { detail: JSON.stringify({ id, route: route(doc)?.href ?? '', comparison: snapshot?.subject ?? '', ...value, ...(starting ? { status: 'pending', value: null } : {}) }) }));
  };
  const lease = new BitbucketWhitespaceLease(read, value => native?.dispatch(value), () => publish());
  const request = (event: Event): void => {
    if (!(event instanceof CustomEvent) || typeof event.detail !== 'string' || event.detail.length > 512) return;
    try { const value: unknown = JSON.parse(event.detail);if (!object(value) || typeof value.id !== 'string' || !/^[a-z0-9-]{1,80}$/i.test(value.id) || typeof value.active !== 'boolean' || typeof value.hide !== 'boolean') return;
      if (id !== value.id || !active && value.active) startedAt = Date.now();
      id = value.id;active = value.active;if (native !== null && !native.current()) tick();lease.update(active, value.hide);publish();
    } catch { /* Unsupported messages cannot dispatch native actions. */ }
  };
  const click = (event: Event): void => { if (!active || !event.isTrusted || !(event.target instanceof Element)) return;
    if (nativeAlert(doc, event.target)) { lease.suspend();return; }
    const button = opener(doc);if (button !== null && button.contains(event.target)) { lease.beforePreferences();queueMicrotask(() => lease.tick()); }
  };
  const change = (event: Event): void => { if (active && event.isTrusted && event.target instanceof HTMLInputElement && event.target.id === 'diff-settings-ignore-whitespace-toggle'
    && event.target.type === 'checkbox' && event.target.closest('[role="dialog"] form') !== null && doc.querySelectorAll('#diff-settings-ignore-whitespace-toggle').length === 1) lease.preferenceIntent(!event.target.checked); };
  const submit = (event: Event): void => { if (active && event.isTrusted && event.target instanceof HTMLFormElement && event.target.closest('[role="dialog"]') !== null
    && event.target.querySelectorAll('#diff-settings-ignore-whitespace-toggle').length === 1) lease.preferenceSubmit(); };
  const tick = (): void => {
    if (revoked) return;
    if (native !== null && !native.current()) { revoked = true;lease.revoke();off?.();off = null;native = null;publish();return; }
    lease.tick();if (active) publish();
  };
  const observer = new MutationObserver(() => { if (active && nativeAlert(doc)) lease.suspend(); });
  observer.observe(doc, { childList: true, subtree: true, attributes: true, attributeFilter: ['role', 'hidden', 'inert', 'aria-hidden', 'class', 'style'], characterData: true });
  const timer = host.setInterval(tick, 500);
  const stop = (): void => { if (stopped) return;active = false;lease.stop();publish();stopped = true;observer.disconnect();host.clearInterval(timer);off?.();doc.removeEventListener(WHITESPACE_REQUEST, request);doc.removeEventListener('click', click, true);doc.removeEventListener('change', change, true);doc.removeEventListener('submit', submit, true); };
  doc.addEventListener(WHITESPACE_REQUEST, request);doc.addEventListener('click', click, true);doc.addEventListener('change', change, true);doc.addEventListener('submit', submit, true);doc.addEventListener(TAKEOVER, stop, { once: true });
  doc.dispatchEvent(new Event(WHITESPACE_READY));
  return stop;
}
