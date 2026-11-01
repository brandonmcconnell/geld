import 'server-only';
import { headers } from 'next/headers';
import { z } from 'zod';
import type { Provider } from '@geld/domain';
import type { TokenSource } from '@geld/github';
import { getAuth } from './auth';
import { demoEnabled } from './env';
import { ensurePersonalWorkspace } from './workspaces';

const userSchema = z.object({ id: z.string(), name: z.string(), email: z.string(), image: z.string().nullable().optional() });
export type Actor = z.infer<typeof userSchema>;
export async function currentActor(): Promise<Actor | null> {
  const auth = getAuth();
  if (!auth) return demoEnabled() ? { id: 'demo-user', name: 'Demo reviewer', email: 'reviewer@example.test' } : null;
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    const parsed = userSchema.safeParse(session?.user);
    if (!parsed.success) return null;
    await ensurePersonalWorkspace(parsed.data);
    return parsed.data;
  } catch {
    return null;
  }
}

export async function providerTokenSource(provider: Provider, owner?: string): Promise<TokenSource> {
  const auth = getAuth();
  if (!auth) return { get: async () => ({ status: 'signed-out', reason: 'Connect a provider' }) };
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) return { get: async () => ({ status: 'signed-out', reason: 'Sign in' }) };
  if (provider === 'github') { const { storedAppUserSource } = await import('./repository-apps'); const source = await storedAppUserSource(session.user.id,owner); if (source) return source; }
  const accounts = await auth.api.listUserAccounts({ headers: requestHeaders });
  const account = provider === 'github'
    ? accounts.find((a) => a.providerId === 'github-repository') ?? accounts.find((a) => a.providerId === 'github-oauth') ?? accounts.find((a) => a.providerId === 'github')
    : accounts.find((a) => a.providerId === provider);
  return {
    async get(options = {}) {
      if (!account) return { status: 'signed-out', reason: 'Connect a provider' };
      try {
        if (options.force) await auth.api.refreshToken({ headers: requestHeaders, body: { accountId: account.id } });
        const result = await auth.api.getAccessToken({ headers: requestHeaders, body: { accountId: account.id } });
        return typeof result.accessToken === 'string' ? { status: 'ok', token: result.accessToken, refreshed: options.force === true } : { status: 'signed-out', reason: 'Reconnect the provider' };
      } catch {
        return { status: 'unavailable', message: 'Reconnect the provider or try again later' };
      }
    },
  };
}

export async function providerViewer(provider: Provider): Promise<string | null> {
  const { createApiTransport } = await import('@geld/github');
  const baseUrl = provider === 'github' ? 'https://api.github.com/' : provider === 'gitlab' ? 'https://gitlab.com/api/v4/' : 'https://api.bitbucket.org/2.0/';
  const api = createApiTransport({ baseUrl, source: await providerTokenSource(provider) });
  const result = await api.request('user');
  if (!result.ok) return null;
  const parsed = z.object({ login: z.string().optional(), username: z.string().optional(), nickname: z.string().optional(), display_name: z.string().optional() }).safeParse(result.value);
  return parsed.success ? parsed.data.login ?? parsed.data.username ?? parsed.data.nickname ?? parsed.data.display_name ?? null : null;
}

export async function syncProviderProfiles(userId: string): Promise<Record<string,string>> {
  const { createApiTransport } = await import('@geld/github'); const { database } = await import('./db');
  const viewers: Record<string,string> = {}; const db = database();
  await Promise.all((['github','gitlab','bitbucket'] satisfies Provider[]).map(async provider => {
    const api = createApiTransport({ baseUrl: provider === 'github' ? 'https://api.github.com/' : provider === 'gitlab' ? 'https://gitlab.com/api/v4/' : 'https://api.bitbucket.org/2.0/', source: await providerTokenSource(provider) });
    const result = await api.request('user'); if (!result.ok) return;
    const p = z.object({ id:z.union([z.number(),z.string()]).optional(),account_id:z.string().optional(),login:z.string().optional(),username:z.string().optional(),nickname:z.string().optional() }).safeParse(result.value);
    if (!p.success) return; const login = p.data.login ?? p.data.username ?? p.data.nickname; const id = p.data.account_id ?? p.data.id;
    if (!login || id === undefined) return; viewers[provider] = login;
    if (db) await db.query('INSERT INTO provider_user_links(user_id,provider,host,external_id,login) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,provider,host) DO UPDATE SET external_id=EXCLUDED.external_id,login=EXCLUDED.login',[userId,provider,provider === 'github' ? 'github.com' : provider === 'gitlab' ? 'gitlab.com' : 'bitbucket.org',String(id),login]);
  })); return viewers;
}
