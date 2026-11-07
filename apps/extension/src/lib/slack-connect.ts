import { browser } from 'wxt/browser';
import { connectionFrom, resolverFor, SLACK_API, SLACK_USER_SCOPES, type Connection, type FetchLike } from '@geld/review/link-resolvers/index';

/**
 * Connect Slack: the Geld Slack app's sign-in with PKCE, so no client secret exists anywhere and nothing but Slack and
 * this browser ever holds the token. Slack sends the browser back to a static page on geld.sh with a one-time code,
 * which the extension reads from the tab it opened and exchanges itself; the code is useless without the verifier,
 * which never leaves this page.
 */

export const SLACK_CLIENT_ID: string = import.meta.env.WXT_GELD_SLACK_CLIENT_ID ?? '';
export const SLACK_REDIRECT = 'https://www.geld.sh/connect/slack/callback';
export const SLACK_ORIGINS = ['https://slack.com/*', 'https://www.geld.sh/*'];

const SIGN_IN_TIMEOUT_MS = 10 * 60 * 1000;

function randomString(bytes: number): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

export function authorizeUrl(clientId: string, state: string, challenge: string, team: string | null = null): string {
  const params = new URLSearchParams({
    client_id: clientId,
    user_scope: SLACK_USER_SCOPES.join(','),
    redirect_uri: SLACK_REDIRECT,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  if (team !== null) params.set('team', team);
  return `https://slack.com/oauth/v2/authorize?${params}`;
}

export type SlackConnectResult = { readonly ok: true; readonly connection: Connection } | { readonly ok: false; readonly message: string };

/** The code Slack sent back to the tab, or why there is none. */
function waitForCode(tabId: number, state: string): Promise<{ readonly code: string } | { readonly message: string }> {
  return new Promise((resolve) => {
    const done = (answer: { readonly code: string } | { readonly message: string }): void => {
      browser.tabs.onUpdated.removeListener(onUpdated);
      browser.tabs.onRemoved.removeListener(onRemoved);
      clearTimeout(timer);
      resolve(answer);
    };
    const onUpdated = (id: number, change: { readonly url?: string }): void => {
      if (id !== tabId || change.url === undefined || !change.url.startsWith(SLACK_REDIRECT)) return;
      const params = new URL(change.url).searchParams;
      void browser.tabs.remove(tabId).catch(() => undefined);
      if (params.get('state') !== state) return done({ message: 'Slack sent back a sign-in Geld did not start' });
      const error = params.get('error');
      if (error !== null) return done({ message: error === 'access_denied' ? 'Slack sign-in was cancelled' : `Slack answered ${error}` });
      const code = params.get('code');
      done(code === null ? { message: 'Slack did not send a code' } : { code });
    };
    const onRemoved = (id: number): void => {
      if (id === tabId) done({ message: 'The Slack tab was closed before signing in finished' });
    };
    const timer = setTimeout(() => done({ message: 'Slack sign-in took too long' }), SIGN_IN_TIMEOUT_MS);
    browser.tabs.onUpdated.addListener(onUpdated);
    browser.tabs.onRemoved.addListener(onRemoved);
  });
}

export async function exchangeSlackCode(fetch: FetchLike, clientId: string, code: string, verifier: string): Promise<{ readonly token: string } | { readonly message: string }> {
  const body = new URLSearchParams({ client_id: clientId, code, code_verifier: verifier, redirect_uri: SLACK_REDIRECT, grant_type: 'authorization_code' });
  let answer: unknown;
  try {
    const response = await fetch(`${SLACK_API}/oauth.v2.access`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
    answer = await response.json();
  } catch {
    return { message: 'Slack could not be reached' };
  }
  if (typeof answer !== 'object' || answer === null) return { message: 'Slack did not answer' };
  const ok = 'ok' in answer && answer.ok === true;
  const user = 'authed_user' in answer && typeof answer.authed_user === 'object' && answer.authed_user !== null ? answer.authed_user : null;
  const token = user !== null && 'access_token' in user && typeof user.access_token === 'string' ? user.access_token : null;
  if (!ok || token === null) return { message: `Slack did not sign you in (${'error' in answer && typeof answer.error === 'string' ? answer.error : 'no token'})` };
  return { token };
}

/**
 * Runs the whole sign-in from the options page, which stays open while the reader answers Slack in a new tab. Its
 * origins must be granted first, from the reader's click.
 */
export async function connectSlack(existing: readonly Connection[]): Promise<SlackConnectResult> {
  if (SLACK_CLIENT_ID === '') return { ok: false, message: 'Slack is not set up in this build of Geld yet' };
  const verifier = randomString(48);
  const state = randomString(24);
  const tab = await browser.tabs.create({ url: authorizeUrl(SLACK_CLIENT_ID, state, await pkceChallenge(verifier)) });
  if (tab.id === undefined) return { ok: false, message: 'The browser did not open Slack' };
  const answer = await waitForCode(tab.id, state);
  if ('message' in answer) return { ok: false, message: answer.message };
  const fetchImpl: FetchLike = (input, init) => fetch(input, init);
  const exchanged = await exchangeSlackCode(fetchImpl, SLACK_CLIENT_ID, answer.code, verifier);
  if ('message' in exchanged) return { ok: false, message: exchanged.message };
  const resolver = resolverFor('slack');
  const draft = { service: 'slack' as const, label: '', host: null, secret: exchanged.token, email: null };
  const identified = await resolver?.identify(draft, fetchImpl);
  if (identified === undefined || !identified.ok) return { ok: false, message: identified?.message ?? 'Slack did not say which workspace this is' };
  const same = existing.find((connection) => connection.service === 'slack' && connection.covers[0] === identified.identity.covers[0] && connection.account === identified.identity.account);
  const connection = connectionFrom(same?.id ?? crypto.randomUUID(), draft, identified.identity);
  return { ok: true, connection: same === undefined ? connection : { ...connection, label: same.label, use: same.use } };
}

/** Signs a token out on Slack's side, best effort: removing the connection deletes it here whatever Slack says. */
export async function revokeSlack(token: string): Promise<void> {
  try {
    await fetch(`${SLACK_API}/auth.revoke`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  } catch {
    // The token is deleted on this device either way.
  }
}
