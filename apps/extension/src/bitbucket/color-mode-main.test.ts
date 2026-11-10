// @vitest-environment happy-dom
// @vitest-environment-options {"url":"https://bitbucket.org/acme/repo/pull-requests/42"}
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BITBUCKET_COLOR_MODE_ATTRIBUTE, startBitbucketNativeColorMode } from './color-mode-main';

const stops: Array<() => void> = [];
afterEach(() => {
  stops.splice(0).forEach(stop => stop());
  Reflect.deleteProperty(window, 'parcelRequirecbf3');
  document.documentElement.removeAttribute(BITBUCKET_COLOR_MODE_ATTRIBUTE);
  vi.useRealTimers();
});

function nativeMode(initial: unknown = false) {
  let state = { diffSettings: { globalIsColorBlindModeEnabled: initial } };
  const listeners = new Set<() => void>();
  const dispatch = vi.fn();
  const store = {
    getState: () => state,
    subscribe: (callback: () => void) => { listeners.add(callback);return () => listeners.delete(callback); },
    dispatch,
  };
  const settings = {
    UPDATE_GLOBAL_IS_COLOR_BLIND_MODE_ENABLED_SUCCESS: 'diffSettings/UPDATE_GLOBAL_IS_COLOR_BLIND_MODE_ENABLED_SUCCESS',
    getGlobalIsColorBlindModeEnabled: () => state.diffSettings.globalIsColorBlindModeEnabled,
  };
  const module = { bitbucketStore: store };
  const loader = vi.fn((id: string): unknown => id === 'jSBTO' ? module : id === 'fozrM' ? settings : undefined);
  Reflect.set(window, 'parcelRequirecbf3', loader);
  return { dispatch, listeners, loader, settings, change: (value: unknown) => {
    state = { diffSettings: { globalIsColorBlindModeEnabled: value } };
    listeners.forEach(listener => listener());
  } };
}

function start(): () => void {
  const stop = startBitbucketNativeColorMode(document, window);stops.push(stop);return stop;
}

describe('native Bitbucket count color mode', () => {
  it('follows live native preference changes without dispatching any action', () => {
    const native = nativeMode();
    start();
    expect(document.documentElement.getAttribute(BITBUCKET_COLOR_MODE_ATTRIBUTE)).toBe('false');
    native.change(true);
    expect(document.documentElement.getAttribute(BITBUCKET_COLOR_MODE_ATTRIBUTE)).toBe('true');
    native.change(false);
    expect(document.documentElement.getAttribute(BITBUCKET_COLOR_MODE_ATTRIBUTE)).toBe('false');
    expect(native.dispatch).not.toHaveBeenCalled();
    expect(new Set(native.loader.mock.calls.map(([id]) => id))).toEqual(new Set(['jSBTO', 'fozrM']));
  });

  it('waits for the native store and retires its subscription when that store is replaced', () => {
    vi.useFakeTimers();
    start();
    expect(document.documentElement.hasAttribute(BITBUCKET_COLOR_MODE_ATTRIBUTE)).toBe(false);
    const first = nativeMode(true);
    vi.advanceTimersByTime(500);
    expect(document.documentElement.getAttribute(BITBUCKET_COLOR_MODE_ATTRIBUTE)).toBe('true');
    const second = nativeMode(false);
    vi.advanceTimersByTime(500);
    expect(first.listeners.size).toBe(0);
    expect(second.listeners.size).toBe(1);
    first.change(true);
    expect(document.documentElement.getAttribute(BITBUCKET_COLOR_MODE_ATTRIBUTE)).toBe('false');
  });

  it.each([undefined, null, 'true', 1])('leaves unsupported native values unclassified: %s', value => {
    const native = nativeMode(true);
    start();native.change(value);
    expect(document.documentElement.hasAttribute(BITBUCKET_COLOR_MODE_ATTRIBUTE)).toBe(false);
    expect(native.dispatch).not.toHaveBeenCalled();
  });

  it('restores the previous attribute and unsubscribes on cleanup', () => {
    const native = nativeMode(true);
    document.documentElement.setAttribute(BITBUCKET_COLOR_MODE_ATTRIBUTE, 'prior');
    const stop = start();
    expect(document.documentElement.getAttribute(BITBUCKET_COLOR_MODE_ATTRIBUTE)).toBe('true');
    stop();
    expect(document.documentElement.getAttribute(BITBUCKET_COLOR_MODE_ATTRIBUTE)).toBe('prior');
    expect(native.listeners.size).toBe(0);
  });

  it('does not overwrite an externally changed attribute while stopping', () => {
    nativeMode(true);const stop = start();
    document.documentElement.setAttribute(BITBUCKET_COLOR_MODE_ATTRIBUTE, 'external');
    stop();
    expect(document.documentElement.getAttribute(BITBUCKET_COLOR_MODE_ATTRIBUTE)).toBe('external');
  });

  it('replaces an earlier observer without accumulating subscriptions', () => {
    const native = nativeMode(true);
    start();const stop = start();
    expect(native.listeners.size).toBe(1);
    stop();
    expect(native.listeners.size).toBe(0);
    expect(document.documentElement.hasAttribute(BITBUCKET_COLOR_MODE_ATTRIBUTE)).toBe(false);
  });

  it('rejects a renamed native contract rather than guessing a preference', () => {
    const native = nativeMode(true);
    native.settings.UPDATE_GLOBAL_IS_COLOR_BLIND_MODE_ENABLED_SUCCESS = 'unknown';
    start();
    expect(document.documentElement.hasAttribute(BITBUCKET_COLOR_MODE_ATTRIBUTE)).toBe(false);
    expect(native.listeners.size).toBe(0);
  });
});
