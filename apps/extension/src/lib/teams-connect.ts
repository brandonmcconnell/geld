import { connectionFrom, resolverFor, TEAMS_SCOPES, type Connection, type FetchLike } from '@geld/review/link-resolvers/index';
import { callbackFor, GELD_ORIGIN, pkceChallenge, proxyTokens, randomString, signInTab, type AppConnectResult } from './app-connect';

/**
 * Connect Microsoft Teams: Geld's multi-tenant Entra app, delegated Graph scopes, the reader's own access. Microsoft
 * redeems a code for a web app only with its client secret, so the exchange and every refresh go through Geld's token
 * proxy on geld.sh, which adds the secret and stores nothing; PKCE ties the code to this page.
 */

export const TEAMS_CLIENT_ID: string = import.meta.env.WXT_GELD_TEAMS_CLIENT_ID ?? '';
export const TEAMS_REDIRECT = callbackFor('teams');
export const TEAMS_ORIGINS = ['https://graph.microsoft.com/*', `${GELD_ORIGIN}/*`];

export function teamsAuthorizeUrl(clientId: string, state: string, challenge: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    response_mode: 'query',
    redirect_uri: TEAMS_REDIRECT,
    scope: TEAMS_SCOPES.join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return `https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize?${params}`;
}

export async function connectTeams(existing: readonly Connection[]): Promise<AppConnectResult> {
  if (TEAMS_CLIENT_ID === '') return { ok: false, message: 'Microsoft Teams is not set up in this build of Geld yet' };
  const verifier = randomString(48);
  const state = randomString(24);
  const answer = await signInTab(teamsAuthorizeUrl(TEAMS_CLIENT_ID, state, await pkceChallenge(verifier)), TEAMS_REDIRECT, state, 'Microsoft');
  if ('message' in answer) return { ok: false, message: answer.message };
  const fetchImpl: FetchLike = (input, init) => fetch(input, init);
  const tokens = await proxyTokens(fetchImpl, 'teams', { grant: 'code', code: answer.code, verifier });
  if ('message' in tokens) return { ok: false, message: tokens.message };
  const draft = { service: 'teams' as const, label: '', host: null, secret: tokens.accessToken, email: null };
  const identified = await resolverFor('teams')?.identify(draft, fetchImpl);
  if (identified === undefined || !identified.ok) return { ok: false, message: identified?.message ?? 'Microsoft did not say who signed in' };
  const same = existing.find((connection) => connection.service === 'teams' && connection.account === identified.identity.account && connection.covers[0] === identified.identity.covers[0]);
  const connection: Connection = { ...connectionFrom(same?.id ?? crypto.randomUUID(), draft, identified.identity), refresh: tokens.refreshToken, expiresAt: tokens.expiresAt };
  return { ok: true, connection: same === undefined ? connection : { ...connection, label: same.label, use: same.use } };
}
