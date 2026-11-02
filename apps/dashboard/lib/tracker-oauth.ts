import 'server-only';
import { z } from 'zod';
import { createApiTransport } from '@geld/github';
import { configured, dashboardOrigin } from './env';
import { database } from './db';
import { transaction, type SqlExecutor } from './transactions';
import { encryptCredential, decryptCredential } from './crypto';
import type { TokenSource } from '@geld/github';
export const trackerOAuthProvider = z.enum(['linear', 'jira', 'asana', 'monday']);
export function trackerOAuth(provider: string) {
  const parsed = trackerOAuthProvider.safeParse(provider);
  if (!parsed.success) return null;
  const p = parsed.data;
  const prefix = p.toUpperCase();
  const clientId = configured(process.env[`${prefix}_CLIENT_ID`]);
  const secret = configured(process.env[`${prefix}_CLIENT_SECRET`]);
  if (!clientId || !secret) return null;
  return {
    provider: p,
    clientId,
    secret,
    authorize:
      p === 'linear'
        ? 'https://linear.app/oauth/authorize'
        : p === 'jira'
          ? 'https://auth.atlassian.com/authorize'
          : p === 'asana'
            ? 'https://app.asana.com/-/oauth_authorize'
            : 'https://auth.monday.com/oauth2/authorize',
    token:
      p === 'linear'
        ? 'https://api.linear.app/oauth/token'
        : p === 'jira'
          ? 'https://auth.atlassian.com/oauth/token'
          : p === 'asana'
            ? 'https://app.asana.com/-/oauth_token'
            : 'https://auth.monday.com/oauth2/token',
    scope:
      p === 'linear'
        ? 'read'
        : p === 'jira'
          ? 'read:jira-work offline_access'
          : p === 'asana'
            ? 'tasks:read'
            : 'boards:read',
    callback: `${dashboardOrigin()}/api/tracker/callback`,
  };
}
export async function exchangeTrackerToken(provider: string, input: Record<string, string>) {
  const config = trackerOAuth(provider);
  if (!config) return null;
  const url = new URL(config.token);
  const api = createApiTransport({
    baseUrl: `${url.origin}/`,
    source: { get: async () => ({ status: 'signed-out', reason: 'Tracker OAuth exchange' }) },
    anonymousWrites: true,
  });
  const body = { ...input, client_id: config.clientId, client_secret: config.secret };
  const result = await api.request(url.pathname.slice(1), {
    method: 'POST',
    ...(provider === 'jira'
      ? { body }
      : { rawBody: new URLSearchParams(body).toString(), contentType: 'application/x-www-form-urlencoded' }),
  });
  if (!result.ok) return null;
  const token = z
    .object({
      access_token: z.string(),
      refresh_token: z.string().optional(),
      expires_in: z.number().positive().optional(),
      scope: z.string().optional(),
    })
    .safeParse(result.value);
  return token.success ? token.data : null;
}
export function trackerOAuthSource(
  teamId: string,
  expected: { readonly provider: string; readonly version: string | number },
  dependencies?: { readonly sql: SqlExecutor; readonly run: <T>(work: (sql: SqlExecutor) => Promise<T>) => Promise<T> },
): TokenSource {
  return {
    async get(options = {}) {
      const pool = dependencies ? null : database();
      const db = dependencies?.sql ?? pool;
      if (!db) return { status: 'unavailable', message: 'Tracker connection storage is unavailable' };
      const run =
        dependencies?.run ??
        (<T>(work: (sql: SqlExecutor) => Promise<T>) => {
          if (!pool) throw new Error('Tracker storage is unavailable');
          return transaction(pool, work);
        });
      return run(async (sql) => {
        const row = z
          .object({
            provider: z.string(),
            config_version: z.union([z.number(), z.string()]),
            encrypted_credential: z.string().nullable(),
            encrypted_refresh: z.string().nullable(),
            expires_at: z.date().nullable(),
          })
          .safeParse(
            (
              await sql.query(
                'SELECT provider,config_version,encrypted_credential,encrypted_refresh,expires_at FROM tracker_connections WHERE team_id=$1 FOR UPDATE',
                [teamId],
              )
            ).rows[0],
          );
        if (
          row.success &&
          (row.data.provider !== expected.provider || String(row.data.config_version) !== String(expected.version))
        )
          return { status: 'signed-out', reason: 'Tracker configuration changed' };
        if (!row.success || !row.data.encrypted_credential)
          return { status: 'signed-out', reason: 'Reconnect the tracker' };
        const r = row.data;
        if ((r.expires_at && r.expires_at.getTime() < Date.now() + 60000) || (options.force && r.encrypted_refresh)) {
          const refresh = r.encrypted_refresh ? await decryptCredential(r.encrypted_refresh) : null;
          if (!refresh) return { status: 'signed-out', reason: 'Reconnect the tracker' };
          const token = await exchangeTrackerToken(r.provider, { grant_type: 'refresh_token', refresh_token: refresh });
          if (!token) return { status: 'unavailable', message: 'Reconnect the tracker' };
          await sql.query(
            'UPDATE tracker_connections SET encrypted_credential=$2,encrypted_refresh=$3,expires_at=$4 WHERE team_id=$1',
            [
              teamId,
              await encryptCredential(token.access_token),
              token.refresh_token ? await encryptCredential(token.refresh_token) : r.encrypted_refresh,
              token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null,
            ],
          );
          return { status: 'ok', token: token.access_token, refreshed: true };
        }
        const token = await decryptCredential(r.encrypted_credential ?? '');
        return token
          ? { status: 'ok', token, refreshed: false }
          : { status: 'unavailable', message: 'Reconnect the tracker' };
      });
    },
  };
}
