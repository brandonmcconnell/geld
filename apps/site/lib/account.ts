import { useSyncExternalStore } from 'react';

import type { AccountView } from './account-cookie';
import { parseAccountCookie } from './account-cookie';

export type { AccountView } from './account-cookie';

// Cookies only change through full-page navigations (sign-in callback,
// sign-out POST), so one snapshot per page load is enough. Cache it so the
// store returns a stable reference.
let cached: { readonly cookie: string; readonly account: AccountView | null } | null = null;

function getSnapshot(): AccountView | null {
  const cookie = document.cookie;
  if (cached === null || cached.cookie !== cookie) cached = { cookie, account: parseAccountCookie(cookie) };
  return cached.account;
}

const subscribe = (): (() => void) => () => {};
const getServerSnapshot = (): undefined => undefined;

/** `undefined` while server-rendering (unknown), then the account or `null`. */
export function useAccount(): AccountView | null | undefined {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
