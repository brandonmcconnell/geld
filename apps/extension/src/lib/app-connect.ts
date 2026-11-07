import { browser } from 'wxt/browser';
import type { Connection, FetchLike } from '@geld/review/link-resolvers/index';

/**
 * What every "Connect <service>" sign-in shares: a PKCE verifier and state made here, the service's authorize page in
 * a tab the options page opened, and the code read back from that tab's address when the service sends it to the
 * static `https://www.geld.sh/connect/<service>/callback`. The code is useless without the verifier, which never
 * leaves this page.
 */

export const GELD_ORIGIN = 'https://www.geld.sh';
export const callbackFor = (service: string): string => `${GELD_ORIGIN}/connect/${service}/callback`;
/** The token proxy for services whose token exchange needs Geld's client secret (Teams, Discord). It stores nothing. */
export const tokenEndpointFor = (service: string): string => `${GELD_ORIGIN}/api/connect/${service}/token`;

const SIGN_IN_TIMEOUT_MS = 10 * 60 * 1000;

export type AppConnectResult = { readonly ok: true; readonly connection: Connection } | { readonly ok: false; readonly message: string };

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomString(bytes: number): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

/** Opens `url` in a tab and waits for the service to send it back to `redirect` with a code and the same state. */
export async function signInTab(url: string, redirect: string, state: string, name: string): Promise<{ readonly code: string } | { readonly message: string }> {
  const tab = await browser.tabs.create({ url });
  const tabId = tab.id;
  if (tabId === undefined) return { message: `The browser did not open ${name}` };
  return new Promise((resolve) => {
    const done = (answer: { readonly code: string } | { readonly message: string }): void => {
      browser.tabs.onUpdated.removeListener(onUpdated);
      browser.tabs.onRemoved.removeListener(onRemoved);
      clearTimeout(timer);
      resolve(answer);
    };
    const onUpdated = (id: number, change: { readonly url?: string }): void => {
      if (id !== tabId || change.url === undefined || !change.url.startsWith(redirect)) return;
      const params = new URL(change.url).searchParams;
      void browser.tabs.remove(tabId).catch(() => undefined);
      if (params.get('state') !== state) return done({ message: `${name} sent back a sign-in Geld did not start` });
      const error = params.get('error');
      if (error !== null) return done({ message: error === 'access_denied' ? `${name} sign-in was cancelled` : `${name} answered ${params.get('error_description') ?? error}` });
      const code = params.get('code');
      done(code === null ? { message: `${name} did not send a code` } : { code });
    };
    const onRemoved = (id: number): void => {
      if (id === tabId) done({ message: `The ${name} tab was closed before signing in finished` });
    };
    const timer = setTimeout(() => done({ message: `${name} sign-in took too long` }), SIGN_IN_TIMEOUT_MS);
    browser.tabs.onUpdated.addListener(onUpdated);
    browser.tabs.onRemoved.addListener(onRemoved);
  });
}

export interface Tokens {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresAt: number | null;
}

/** Asks Geld's token proxy for tokens: a code with its verifier, or a refresh token. */
export async function proxyTokens(fetch: FetchLike, service: string, body: { readonly grant: 'code'; readonly code: string; readonly verifier: string } | { readonly grant: 'refresh'; readonly refresh: string }): Promise<Tokens | { readonly message: string }> {
  let answer: unknown;
  try {
    const response = await fetch(tokenEndpointFor(service), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    answer = await response.json();
  } catch {
    return { message: 'Geld’s sign-in service could not be reached' };
  }
  if (typeof answer !== 'object' || answer === null) return { message: 'Geld’s sign-in service did not answer' };
  if (!('ok' in answer) || answer.ok !== true || !('accessToken' in answer) || typeof answer.accessToken !== 'string') {
    return { message: 'error' in answer && typeof answer.error === 'string' ? answer.error : 'The sign-in did not go through' };
  }
  const refresh = 'refreshToken' in answer && typeof answer.refreshToken === 'string' ? answer.refreshToken : null;
  const expires = 'expiresIn' in answer && typeof answer.expiresIn === 'number' ? answer.expiresIn : null;
  return { accessToken: answer.accessToken, refreshToken: refresh, expiresAt: expires === null ? null : Date.now() + expires * 1000 };
}
