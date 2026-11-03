import { useSyncExternalStore } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react', () => ({ useSyncExternalStore: vi.fn() }));

const accountCookie = `geld_account=${encodeURIComponent(JSON.stringify({ login: 'octocat', avatarUrl: 'https://example.com/avatar.png' }))}`;
const stop: (() => void)[] = [];

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  stop.splice(0).forEach((unsubscribe) => unsubscribe());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function accountStore(cookieEvents: EventTarget | null) {
  const marker = vi.fn();
  const document = { cookie: accountCookie, documentElement: { toggleAttribute: marker } };
  const window = Object.assign(new EventTarget(), {
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    ...(cookieEvents === null ? {} : { cookieStore: cookieEvents }),
  });
  vi.stubGlobal('document', document);
  vi.stubGlobal('window', window);
  const { useAccount } = await import('./account');
  // eslint-disable-next-line react-hooks/rules-of-hooks -- React's store hook is mocked to inspect its subscription contract.
  useAccount();
  const call = vi.mocked(useSyncExternalStore).mock.calls.at(-1);
  if (call === undefined) throw new Error('Account hook did not subscribe to its store');
  const [subscribe, snapshot] = call;
  return { document, window, marker, snapshot, subscribe };
}

describe('account cookie subscription', () => {
  it('refreshes the account and marker after a server action clears the cookie', async () => {
    const events = new EventTarget();
    const store = await accountStore(events);
    const changed = vi.fn();
    stop.push(store.subscribe(changed));
    expect(store.snapshot()).toEqual({ login: 'octocat', avatarUrl: 'https://example.com/avatar.png' });
    expect(store.snapshot()).toBe(store.snapshot());
    expect(store.marker).toHaveBeenLastCalledWith('data-account', true);
    changed.mockClear();

    store.document.cookie = '';
    events.dispatchEvent(new Event('change'));

    expect(changed).toHaveBeenCalledTimes(1);
    expect(store.snapshot()).toBeNull();
    expect(store.marker).toHaveBeenLastCalledWith('data-account', false);
    events.dispatchEvent(new Event('change'));
    expect(changed).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shares and cleans up polling when cookie events are unavailable', async () => {
    const store = await accountStore(null);
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = store.subscribe(first);
    const unsubscribeSecond = store.subscribe(second);
    stop.push(unsubscribeFirst, unsubscribeSecond);
    first.mockClear();
    expect(vi.getTimerCount()).toBe(1);

    store.document.cookie = '';
    vi.advanceTimersByTime(1000);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(store.marker).toHaveBeenLastCalledWith('data-account', false);

    unsubscribeFirst();
    expect(vi.getTimerCount()).toBe(1);
    unsubscribeSecond();
    expect(vi.getTimerCount()).toBe(0);
    store.document.cookie = accountCookie;
    store.window.dispatchEvent(new Event('focus'));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('clears a stale marker on subscription and rechecks when the window regains focus', async () => {
    const store = await accountStore(new EventTarget());
    store.document.cookie = '';
    const changed = vi.fn();
    stop.push(store.subscribe(changed));
    expect(store.marker).toHaveBeenLastCalledWith('data-account', false);
    changed.mockClear();

    store.document.cookie = accountCookie;
    store.window.dispatchEvent(new Event('focus'));
    expect(changed).toHaveBeenCalledTimes(1);
    expect(store.snapshot()).toEqual({ login: 'octocat', avatarUrl: 'https://example.com/avatar.png' });
    expect(store.marker).toHaveBeenLastCalledWith('data-account', true);
  });
});
