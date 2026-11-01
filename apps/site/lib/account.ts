import { DASHBOARD_ORIGIN } from './dashboard';
import { useSyncExternalStore } from 'react';

import type { AccountView } from './account-cookie';
import { parseAccountCookie } from './account-cookie';

export type { AccountView } from './account-cookie';

// Cookies only change through full-page navigations (sign-in callback,
// sign-out POST), so one snapshot per page load is enough. Cache it so the
// store returns a stable reference.
let cached: { readonly cookie: string; readonly account: AccountView | null } | null = null;

let shared:AccountView|null|undefined;
let requested=false;
const listeners=new Set<()=>void>();
function getSnapshot(): AccountView | null {
  if(shared!==undefined)return shared;
  const cookie = document.cookie;
  if (cached === null || cached.cookie !== cookie) cached = { cookie, account: parseAccountCookie(cookie) };
  return cached.account;
}

const subscribe = (callback:()=>void): (() => void) => {listeners.add(callback);if(!requested){requested=true;fetch(`${DASHBOARD_ORIGIN}/api/extension/session`,{credentials:'include',cache:'no-store',redirect:'error'}).then(async response=>{if(!response.ok)return;const value:unknown=await response.json();if(value&&typeof value==='object'&&'user' in value){const user=value.user;if(user&&typeof user==='object'&&'name' in user&&typeof user.name==='string')shared={login:user.name,avatarUrl:'image' in user&&typeof user.image==='string'?user.image:''};else if(user===null)shared=null;listeners.forEach(listener=>listener());}}).catch(()=>undefined);}return()=>listeners.delete(callback);};
const getServerSnapshot = (): undefined => undefined;

/** `undefined` while server-rendering (unknown), then the account or `null`. */
export function useAccount(): AccountView | null | undefined {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
