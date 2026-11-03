// @vitest-environment happy-dom
// @vitest-environment-options {"url":"https://bitbucket.org/"}
import { DEFAULT_SETTINGS } from '@geld/core';
import { createBitbucketWhitespaceMode } from './whitespace-mode';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startBitbucketNativeWhitespace, WHITESPACE_REQUEST, WHITESPACE_RESPONSE } from './whitespace-main';
const HEAD = 'a'.repeat(40);
let cleanup = (): void => undefined;
afterEach(() => { cleanup();Reflect.deleteProperty(window, 'parcelRequirecbf3');document.body.innerHTML = '';vi.useRealTimers(); });
function nativeFixture(options: { raw?: unknown; present?: boolean; loaderRemovesRegion?: boolean } = {}) {
  window.history.replaceState(null, '', 'https://bitbucket.org/acme/repo/pull-requests/42/diff');
  document.body.innerHTML = '<section data-testid="pr-header"><div data-qa="pr-branches-and-state-styles"></div><div>#42 • Updated</div></section><section id="pull-request-tabs-1-tab" role="tabpanel"><button aria-live="polite" type="button">Global diff settings</button><button aria-haspopup="true" aria-expanded="false">All changes</button><section role="region" aria-label="Diff"></section></section>';
  let head = HEAD, base = 'b'.repeat(40);
  const raw: unknown = Object.hasOwn(options, 'raw') ? options.raw : false;
  let state = { global: { locale: 'en' }, diffSettings: { globalShouldIgnoreWhitespace: raw, isDialogOpen: false, isDialogLoading: false }, repository: { pullRequest: { isDiffsLoading: false, isDiffStatLoading: false, diffErrorCode: null, diffStatErrorCode: null, diff: [], diffStat: [] } } };
  if (options.present === false) Reflect.deleteProperty(state.diffSettings, 'globalShouldIgnoreWhitespace');
  const listeners = new Set<() => void>();const actions: unknown[] = [];
  const panel = document.querySelector('#pull-request-tabs-1-tab')!, region = panel.querySelector('[role="region"]')!;
  const spinner = document.createElement('div');spinner.innerHTML = '<span data-testid="diff-loading-spinner-wrapper"><svg data-testid="diff-loading-spinner" role="none" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7"></circle></svg></span>';
  const beginLoading = (): void => {
    region.remove();panel.append(spinner);state = { ...state, repository: { pullRequest: { ...state.repository.pullRequest, isDiffsLoading: true, isDiffStatLoading: true } } };
  };
  const store = { getState: () => state, subscribe: (callback: () => void) => { listeners.add(callback);return () => listeners.delete(callback); }, dispatch: (action: { type: string; payload: { shouldIgnoreWhitespace: boolean | undefined } }) => {
    actions.push(action);state = { ...state, diffSettings: { ...state.diffSettings, globalShouldIgnoreWhitespace: action.payload.shouldIgnoreWhitespace } };if (options.loaderRemovesRegion) beginLoading();listeners.forEach(run => run());
  } };
  const lookup = (id: string): unknown => id === 'jSBTO' ? { bitbucketStore: store } : id === 'fozrM' ? { UPDATE_GLOBAL_SHOULD_IGNORE_WHITESPACE_SUCCESS: 'diffSettings/UPDATE_GLOBAL_SHOULD_IGNORE_WHITESPACE_SUCCESS' } : id === 'cZORy' ? { getCurrentPullRequestId: () => 42, getCurrentPullRequestUrlPieces: () => ({ owner: 'acme', slug: 'repo' }), getPullRequestSourceHash: () => head, getPullRequestDestinationHash: () => base, getPullRequestSourceRepo: () => ({ full_name: 'acme/repo' }) } : null;
  const modules = new Map(['jSBTO', 'fozrM', 'cZORy'].map(id => [id, lookup(id)]));
  const loader = vi.fn((id: string) => modules.get(id));
  Reflect.set(window, 'parcelRequirecbf3', loader);
  const received: unknown[] = [];const response = (e: Event): void => { if (e instanceof CustomEvent && typeof e.detail === 'string') received.push(JSON.parse(e.detail)); };
  document.addEventListener(WHITESPACE_RESPONSE, response);
  const stop = startBitbucketNativeWhitespace(document, window);
  cleanup = () => { stop();document.removeEventListener(WHITESPACE_RESPONSE, response); };
  const request = (active = true, hide = true): void => { document.dispatchEvent(new CustomEvent(WHITESPACE_REQUEST, { detail: JSON.stringify({ id: 'test', active, hide }) })); };
  return { actions, received, loader, modules, request, stop, beginLoading, startFlags: () => { state = { ...state, repository: { pullRequest: { ...state.repository.pullRequest, isDiffsLoading: true, isDiffStatLoading: true } } };listeners.forEach(run => run()); }, mountLoader: () => { region.remove();panel.append(spinner); }, mountRegion: () => { spinner.remove();panel.append(region); }, notify: () => listeners.forEach(run => run()), completeSources: () => { state = { ...state, repository: { pullRequest: { ...state.repository.pullRequest, isDiffsLoading: false, isDiffStatLoading: false, diff: [], diffStat: [] } } };listeners.forEach(run => run()); }, finishLoading: () => { spinner.remove();panel.append(region);state = { ...state, repository: { pullRequest: { ...state.repository.pullRequest, isDiffsLoading: false, isDiffStatLoading: false, diff: [], diffStat: [] } } };listeners.forEach(run => run()); }, fail: () => { Reflect.set(state.repository.pullRequest, 'diffErrorCode', 'unknown');listeners.forEach(run => run()); }, raw: () => Object.getOwnPropertyDescriptor(state.diffSettings, 'globalShouldIgnoreWhitespace'), outside: (value: boolean | undefined) => store.dispatch({ type: 'diffSettings/UPDATE_GLOBAL_SHOULD_IGNORE_WHITESPACE_SUCCESS', payload: { shouldIgnoreWhitespace: value } }), getter: (get: () => unknown) => Object.defineProperty(state.diffSettings, 'globalShouldIgnoreWhitespace', { configurable: true, get }), refs(nextHead: string, nextBase: string) { head = nextHead;base = nextBase;listeners.forEach(run => run()); }, unhydrate() { Reflect.deleteProperty(state.global, 'locale'); }, settle() { state = { ...state, repository: { pullRequest: { ...state.repository.pullRequest, isDiffsLoading: true, isDiffStatLoading: true } } };listeners.forEach(run => run());state = { ...state, repository: { pullRequest: { ...state.repository.pullRequest, isDiffsLoading: false, isDiffStatLoading: false, diff: [], diffStat: [] } } };listeners.forEach(run => run()); } };
}
describe('fixed native Bitbucket whitespace bridge', () => {
  it('retains the owned mode when native DiffLoader unmounts the region until both replacement sources settle', () => {
    vi.useFakeTimers();const f = nativeFixture({ raw: undefined, loaderRemovesRegion: true });
    f.request();expect(document.querySelector('[role="region"]')).toBeNull();expect(f.actions).toHaveLength(1);
    vi.advanceTimersByTime(1_500);expect(f.actions).toHaveLength(1);expect(f.received.at(-1)).toMatchObject({ status: 'pending', value: null });
    f.completeSources();vi.advanceTimersByTime(500);expect(f.actions).toHaveLength(1);expect(f.received.at(-1)).toMatchObject({ status: 'pending', value: null });
    f.finishLoading();expect(f.received.at(-1)).toMatchObject({ status: 'ready', value: true });
    f.stop();expect(f.actions).toEqual([true, undefined].map(value => ({ type: 'diffSettings/UPDATE_GLOBAL_SHOULD_IGNORE_WHITESPACE_SUCCESS', payload: { shouldIgnoreWhitespace: value } })));
    expect(f.raw()).toMatchObject({ value: undefined });
  });
  it.each([false, true])('observes a fast async native loader mount before SUCCESS without waiting for the timer, transparent=%s', async transparent => {
    vi.useFakeTimers();const f = nativeFixture({ raw: undefined });f.request();f.startFlags();
    f.mountLoader();if (transparent) document.querySelector('[data-testid="diff-loading-spinner-wrapper"]')!.setAttribute('style', 'opacity:0');
    await Promise.resolve();f.completeSources();expect(f.actions).toHaveLength(1);expect(f.received.at(-1)).toMatchObject({ status: 'pending', value: null });
    f.mountRegion();await Promise.resolve();expect(f.received.at(-1)).toMatchObject({ status: 'ready', value: true });expect(f.actions).toHaveLength(1);
  });
  it.each(['disable', 'alert'])('restores exact undefined on %s during native region removal without reacquiring', async action => {
    const f = nativeFixture({ raw: undefined, loaderRemovesRegion: true });f.request();
    if (action === 'disable') f.request(false);
    else { document.body.insertAdjacentHTML('beforeend', '<div role="alert">Try again</div>');await Promise.resolve(); }
    expect(f.actions).toHaveLength(2);expect(f.raw()).toMatchObject({ value: undefined });
    document.querySelector('[role="alert"]')?.remove();f.finishLoading();f.notify();
    expect(f.actions).toHaveLength(2);expect(f.received.at(-1)).not.toMatchObject({ value: true });
  });
  it.each(['removed', 'replacement', 'duplicate', 'hidden', 'owned', 'wrong-shape'])('does not retain a settled empty region after the witnessed spinner is %s', change => {
    const f = nativeFixture({ raw: undefined, loaderRemovesRegion: true });f.request();f.completeSources();
    expect(f.actions).toHaveLength(1);expect(f.received.at(-1)).toMatchObject({ status: 'pending' });
    const spinner = document.querySelector('[data-testid="diff-loading-spinner"]')!;
    if (change === 'removed') spinner.remove();
    else if (change === 'replacement') spinner.replaceWith(spinner.cloneNode(true));
    else if (change === 'duplicate') spinner.after(spinner.cloneNode(true));
    else if (change === 'hidden') spinner.parentElement!.setAttribute('hidden', '');
    else if (change === 'owned') spinner.parentElement!.setAttribute('data-geld-ui', '');
    else spinner.setAttribute('viewBox', '0 0 99 99');
    f.notify();expect(f.actions).toHaveLength(2);expect(f.raw()?.value).toBeUndefined();
  });
  it('requires the qualified region to belong to the current diff panel', () => {
    const f = nativeFixture();document.body.append(document.querySelector('[role="region"]')!);f.request();expect(f.actions).toEqual([]);
  });
  it('cannot acquire from a native loading spinner without a previously qualified region', () => {
    const f = nativeFixture();f.beginLoading();f.request();expect(f.actions).toEqual([]);
  });
  it.each(['duplicate-region', 'changed-panel', 'changed-head', 'missing-control', 'settled-missing-region', 'native-error', 'native-alert', 'changed-header', 'changed-opener', 'changed-comparison'])('restores instead of retaining loading custody after %s', failure => {
    const f = nativeFixture({ raw: undefined, loaderRemovesRegion: true });f.request();expect(f.actions).toHaveLength(1);
    if (failure === 'duplicate-region') document.querySelector('[role="tabpanel"]')!.insertAdjacentHTML('beforeend', '<section role="region" aria-label="Diff"></section><section role="region" aria-label="Diff"></section>');
    else if (failure === 'changed-panel') { const panel = document.querySelector('[role="tabpanel"]')!;panel.replaceWith(panel.cloneNode(true)); }
    else if (failure === 'changed-head') f.refs('c'.repeat(40), 'b'.repeat(40));
    else if (failure === 'missing-control') document.querySelector('[aria-haspopup]')!.remove();
    else if (failure === 'settled-missing-region') { f.finishLoading();document.querySelector('[role="region"]')!.remove(); }
    else if (failure === 'native-error') f.fail();
    else if (failure === 'changed-header' || failure === 'changed-opener' || failure === 'changed-comparison') {
      const node = document.querySelector(failure === 'changed-header' ? '[data-testid="pr-header"]' : failure === 'changed-opener' ? 'button[aria-live]' : 'button[aria-haspopup]')!;node.replaceWith(node.cloneNode(true));
    }
    else document.body.insertAdjacentHTML('beforeend', '<div role="alert">Try again</div>');
    f.notify();expect(f.actions).toHaveLength(2);expect(f.raw()).toMatchObject({ value: undefined });expect(f.received.at(-1)).not.toMatchObject({ status: 'ready' });
  });

  it('admits the hydrated own-undefined Off shape and restores that exact raw field on stop', () => {
    // Native initial global JSON has locale but omits the preference; the audited LoadGlobal reducer creates this own undefined field.
    const f = nativeFixture({ raw: undefined });expect(f.raw()).toMatchObject({ value: undefined });
    f.request();expect(f.actions).toEqual([{ type: 'diffSettings/UPDATE_GLOBAL_SHOULD_IGNORE_WHITESPACE_SUCCESS', payload: { shouldIgnoreWhitespace: true } }]);
    f.settle();expect(f.received.at(-1)).toMatchObject({ status: 'ready', value: true });f.stop();
    expect(f.actions.at(-1)).toEqual({ type: 'diffSettings/UPDATE_GLOBAL_SHOULD_IGNORE_WHITESPACE_SUCCESS', payload: { shouldIgnoreWhitespace: undefined } });
    expect(f.raw()).toMatchObject({ value: undefined });
    expect(f.received.every(value => value !== null && typeof value === 'object' && 'value' in value && (value.value === null || typeof value.value === 'boolean'))).toBe(true);
  });
  it('restores own undefined after the hydrated review context is cleared', () => {
    const f = nativeFixture({ raw: undefined });f.request();f.settle();f.refs('', '');f.stop();
    expect(f.actions.at(-1)).toMatchObject({ payload: { shouldIgnoreWhitespace: undefined } });expect(f.raw()?.value).toBeUndefined();
  });
  it.each([{ present: false }, { raw: null }, { raw: 'false' }, { raw: 0 }])('declines missing or non-native preference shape %j', options => {
    const f = nativeFixture(options);f.request();expect(f.actions).toEqual([]);expect(f.received.at(-1)).toMatchObject({ status: 'pending' });
  });
  it('does not evaluate an accessor masquerading as the native own preference field', () => {
    const f = nativeFixture();const getter = vi.fn(() => undefined);f.getter(getter);f.request();expect(f.actions).toEqual([]);expect(getter).not.toHaveBeenCalled();
  });
  it('requires hydration before admitting undefined Off', () => {
    const f = nativeFixture({ raw: undefined });f.unhydrate();f.request();expect(f.actions).toEqual([]);
  });
  it('does not restore undefined over an independent same-true native action', () => {
    const f = nativeFixture({ raw: undefined });f.request();f.settle();f.outside(true);f.stop();
    expect(f.actions).toHaveLength(2);expect(f.raw()?.value).toBe(true);
  });
  it('does not accept undefined through the external boolean request protocol', () => {
    const f = nativeFixture({ raw: undefined });
    document.dispatchEvent(new CustomEvent(WHITESPACE_REQUEST, { detail: JSON.stringify({ id: 'test', active: true, hide: undefined }) }));
    expect(f.actions).toEqual([]);
  });

  it('ignores the retained native hidden sticky-header All changes copy', () => {
    const f = nativeFixture();
    // Shape retained from native PR27, installed-browser-run-41393246257.
    document.body.insertAdjacentHTML('afterbegin', '<div id="sticky-header-content" aria-hidden="true" class="css-ywatm8 e9jxcmf0"><div class="css-1pr3oy0"><div class="css-u5wwvt"><div class="css-yad6bi"><div class="css-1jq12gq"><div class="css-gcolar"><div role="presentation"><button aria-expanded="false" aria-haspopup="true" class="css-7ko8p0" tabindex="-1" type="button"><span class="css-178ag6o">All changes</span></button></div></div></div></div></div></div></div>');
    const sticky = document.querySelector('#sticky-header-content')!, original = sticky.outerHTML;f.request();
    expect(f.actions).toHaveLength(1);expect(sticky.outerHTML).toBe(original);
  });
  it('requires the comparison control in the current diff panel', () => {
    const f = nativeFixture(), other = document.createElement('section');other.setAttribute('role', 'tabpanel');other.id = 'other-native-panel';
    other.append(document.querySelector('[aria-haspopup]')!);document.body.append(other);f.request();
    expect(f.actions).toEqual([]);
  });
  it('rejects two actionable comparison controls in the current panel', () => {
    const f = nativeFixture(), control = document.querySelector('[aria-haspopup]')!;control.after(control.cloneNode(true));f.request();
    expect(f.actions).toEqual([]);
  });
  it.each(['hidden', 'inert', 'aria-hidden', 'display', 'visibility', 'opacity'])('does not acquire from a %s-only comparison control', hiding => {
    const f = nativeFixture(), control = document.querySelector('[aria-haspopup]')!, wrapper = document.createElement('div');control.before(wrapper);wrapper.append(control);
    if (hiding === 'display') wrapper.style.display = 'none';
    else if (hiding === 'visibility') wrapper.style.visibility = 'hidden';
    else if (hiding === 'opacity') wrapper.style.opacity = '0';
    else wrapper.setAttribute(hiding, hiding === 'aria-hidden' ? 'true' : '');
    f.request();expect(f.actions).toEqual([]);
  });
  it('ignores owned and unrelated-panel copies while retaining the one native comparison control', () => {
    const f = nativeFixture(), control = document.querySelector('[aria-haspopup]')!, owned = document.createElement('div'), other = document.createElement('section');
    owned.dataset.geldUi = '';owned.append(control.cloneNode(true));control.after(owned);
    other.setAttribute('role', 'tabpanel');other.append(control.cloneNode(true));document.body.append(other);f.request();
    expect(f.actions).toHaveLength(1);
  });
  it('restores the captured scalar after SPA navigation clears the native PR selectors', () => {
    const f = nativeFixture();f.request();f.settle();window.history.replaceState(null, '', '/acme/repo/commits');f.refs('', '');f.request(false);
    expect(f.actions.at(-1)).toMatchObject({ payload: { shouldIgnoreWhitespace: false } });
  });
  it('restores on MAIN stop even after native PR refs were cleared', () => {
    const f = nativeFixture();f.request();f.settle();f.refs('', '');f.stop();expect(f.actions.at(-1)).toMatchObject({ payload: { shouldIgnoreWhitespace: false } });
  });
  it('stands down before any native alert action can seed the settings form', async () => {
    const f = nativeFixture();f.request();f.settle();
    const flag = document.createElement('div');flag.setAttribute('role', 'alert');flag.innerHTML = '<button type="button">Take me to diff settings</button>';document.body.append(flag);
    await Promise.resolve();expect(f.actions.at(-1)).toMatchObject({ payload: { shouldIgnoreWhitespace: false } });flag.remove();f.settle();f.request();expect(f.actions).toHaveLength(2);
  });
  it('does not acquire while a native settings retry flag is already present', () => {
    const f = nativeFixture();const flag = document.createElement('div');flag.setAttribute('role', 'alert');flag.textContent = 'Try again';document.body.append(flag);f.request();expect(f.actions).toEqual([]);
  });
  it('ignores empty, hidden, and Geld-owned alert shells', () => {
    const f = nativeFixture();document.body.insertAdjacentHTML('beforeend', '<div role="alert"></div><div hidden role="alert">Take me to diff settings</div><div style="display:none" role="alert">Try again</div><div data-geld-ui role="alert">Geld status</div>');f.request();expect(f.actions).toHaveLength(1);
  });
  it('re-handshakes the current isolated client after a MAIN replacement restores its old lease', () => {
    const f = nativeFixture(), client = createBitbucketWhitespaceMode(document, () => undefined);
    client.update({ ...DEFAULT_SETTINGS, enabled: true, hideWhitespace: true });f.settle();
    const replacement = startBitbucketNativeWhitespace(document, window);
    expect(f.actions).toEqual([true, false, true].map(value => ({ type: 'diffSettings/UPDATE_GLOBAL_SHOULD_IGNORE_WHITESPACE_SUCCESS', payload: { shouldIgnoreWhitespace: value } })));
    client.stop();replacement();
  });
  it('restores the old leased store and refuses a replacement on the same route', () => {
    const f = nativeFixture();f.request();f.settle();f.modules.set('jSBTO', { bitbucketStore: {} });f.request();
    expect(f.actions.map(action => action && typeof action === 'object' && 'payload' in action ? action.payload : null)).toEqual([{ shouldIgnoreWhitespace: true }, { shouldIgnoreWhitespace: false }]);
    expect(f.received.at(-1)).toMatchObject({ status: 'legacy' });
  });
  it('accepts native prefixes without claiming full hashes, and revokes same-head target changes', () => {
    const f = nativeFixture();f.refs(HEAD.slice(0, 12), 'b'.repeat(12));f.request();f.settle();
    expect(f.received.at(-1)).toMatchObject({ status: 'ready', comparison: JSON.stringify(['acme/repo', '42', 'acme/repo', HEAD.slice(0, 12), 'b'.repeat(12)]) });
    f.refs(HEAD.slice(0, 12), 'c'.repeat(12));expect(f.actions).toHaveLength(2);expect(f.received.at(-1)).toMatchObject({ status: 'pending' });
  });
  it('does not lease the unhydrated default preference and bounds unsupported startup', () => {
    vi.useFakeTimers();const f = nativeFixture();f.unhydrate();f.request();expect(f.actions).toEqual([]);expect(f.received.at(-1)).toMatchObject({ status: 'pending' });
    vi.advanceTimersByTime(10_500);expect(f.actions).toEqual([]);expect(f.received.at(-1)).toMatchObject({ status: 'legacy' });
  });

  it('only emits the audited SUCCESS boolean action and waits for both native sources', () => {
    const f = nativeFixture();f.request();expect(f.actions).toEqual([{ type: 'diffSettings/UPDATE_GLOBAL_SHOULD_IGNORE_WHITESPACE_SUCCESS', payload: { shouldIgnoreWhitespace: true } }]);
    expect(f.received.at(-1)).toMatchObject({ comparison: JSON.stringify(['acme/repo', '42', 'acme/repo', HEAD, 'b'.repeat(40)]), status: 'pending', value: null });f.settle();expect(f.received.at(-1)).toMatchObject({ comparison: JSON.stringify(['acme/repo', '42', 'acme/repo', HEAD, 'b'.repeat(40)]), status: 'ready', value: true });
    f.request(false);expect(f.actions.at(-1)).toMatchObject({ payload: { shouldIgnoreWhitespace: false } });
  });
  it('refuses unknown settings openers before requiring native modules', () => {
    const f = nativeFixture();document.querySelector('button')!.textContent = 'Preferences';f.request();expect(f.actions).toEqual([]);expect(f.loader).not.toHaveBeenCalled();expect(f.received.at(-1)).toMatchObject({ status: 'pending' });
  });
  it('refuses partial comparisons and mismatched native review owners', () => {
    const f = nativeFixture();document.querySelector('[aria-haspopup]')!.textContent = 'Latest commit';f.request();expect(f.actions).toEqual([]);expect(f.received.at(-1)).toMatchObject({ status: 'legacy' });
  });
  it('ignores synthetic clicks and arbitrary protocol payloads', () => {
    const f = nativeFixture();f.request();f.settle();document.querySelector('button')!.click();expect(f.actions).toHaveLength(1);
    document.dispatchEvent(new CustomEvent(WHITESPACE_REQUEST, { detail: JSON.stringify({ id: 'test', active: true, hide: { action: 'Save' } }) }));expect(f.actions).toHaveLength(1);
  });
});
