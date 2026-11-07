import { connectionFrom, DISCORD_USER_SCOPES, resolverFor, type Connection, type FetchLike } from '@geld/review/link-resolvers/index';
import { callbackFor, GELD_ORIGIN, pkceChallenge, proxyTokens, randomString, signInTab, type AppConnectResult } from './app-connect';

/**
 * Connect Discord: the reader signs in with Discord so Geld knows who they are and which servers they are in
 * (`identify`, `guilds`; nothing else). Messages are read by Geld's bot, through Geld's resolver, only where the
 * reader may see them (`resolveDiscordAsBot`). The code goes through Geld's token proxy, which adds the secret.
 */

export const DISCORD_CLIENT_ID: string = import.meta.env.WXT_GELD_DISCORD_CLIENT_ID ?? '';
export const DISCORD_REDIRECT = callbackFor('discord');
export const DISCORD_ORIGINS = ['https://discord.com/*', `${GELD_ORIGIN}/*`];

export function discordAuthorizeUrl(clientId: string, state: string, challenge: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: DISCORD_USER_SCOPES.join(' '),
    redirect_uri: DISCORD_REDIRECT,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'consent',
  });
  return `https://discord.com/oauth2/authorize?${params}`;
}

export async function connectDiscord(existing: readonly Connection[]): Promise<AppConnectResult> {
  if (DISCORD_CLIENT_ID === '') return { ok: false, message: 'Discord is not set up in this build of Geld yet' };
  const verifier = randomString(48);
  const state = randomString(24);
  const answer = await signInTab(discordAuthorizeUrl(DISCORD_CLIENT_ID, state, await pkceChallenge(verifier)), DISCORD_REDIRECT, state, 'Discord');
  if ('message' in answer) return { ok: false, message: answer.message };
  const fetchImpl: FetchLike = (input, init) => fetch(input, init);
  const tokens = await proxyTokens(fetchImpl, 'discord', { grant: 'code', code: answer.code, verifier });
  if ('message' in tokens) return { ok: false, message: tokens.message };
  const draft = { service: 'discord' as const, label: '', host: null, secret: tokens.accessToken, email: null };
  const identified = await resolverFor('discord')?.identify(draft, fetchImpl);
  if (identified === undefined || !identified.ok) return { ok: false, message: identified?.message ?? 'Discord did not say who signed in' };
  const same = existing.find((connection) => connection.service === 'discord' && connection.account === identified.identity.account);
  const connection: Connection = { ...connectionFrom(same?.id ?? crypto.randomUUID(), draft, identified.identity), refresh: tokens.refreshToken, expiresAt: tokens.expiresAt };
  return { ok: true, connection: same === undefined ? connection : { ...connection, label: same.label, use: same.use } };
}

/**
 * Discord revokes a token only with the client secret, so removing the connection deletes the token on this device
 * and the reader can remove Geld under Discord's Authorized Apps.
 */
export async function revokeDiscord(): Promise<void> {}

/** The link a server admin follows to add Geld's bot, which may only see channels and read their history. */
export function discordBotInviteUrl(clientId: string, permissions: string): string {
  return `https://discord.com/oauth2/authorize?${new URLSearchParams({ client_id: clientId, scope: 'bot', permissions })}`;
}
