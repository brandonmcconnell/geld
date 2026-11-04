import { useSyncExternalStore } from 'react';

import type { AccountView } from './account-cookie';
import { parseAccountCookie } from './account-cookie';

export type { AccountView } from './account-cookie';

// Cache the parsed cookie so React receives a stable snapshot between changes.
let cached: { readonly cookie: string; readonly account: AccountView | null } | null = null;
const listeners = new Set<() => void>();
let stopWatching: (() => void) | null = null;

function getSnapshot(): AccountView | null {
  const cookie = document.cookie;
  if (cached === null || cached.cookie !== cookie) cached = { cookie, account: parseAccountCookie(cookie) };
  return cached.account;
}

function syncAccount(): void {
  const previous = cached?.account;
  const account = getSnapshot();
  document.documentElement.toggleAttribute('data-account', account !== null);
  if (account !== previous) listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (stopWatching === null) {
    const store = window.cookieStore ?? null;
    const timer = store === null ? window.setInterval(syncAccount, 1000) : null;
    store?.addEventListener('change', syncAccount);
    window.addEventListener('focus', syncAccount);
    stopWatching = () => {
      if (timer !== null) window.clearInterval(timer);
      store?.removeEventListener('change', syncAccount);
      window.removeEventListener('focus', syncAccount);
    };
  }
  syncAccount();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stopWatching?.();
      stopWatching = null;
    }
  };
}
const getServerSnapshot = (): undefined => undefined;

/** `undefined` while server-rendering (unknown), then the account or `null`. */
export function useAccount(): AccountView | null | undefined {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
