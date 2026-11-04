import 'server-only';
import { headers } from 'next/headers';
import { z } from 'zod';
import type { Provider } from '@geld/domain';
import { providerProfileIdentity } from '@geld/domain/identities';
import type { TokenSource } from '@geld/github';
import { getAuth } from './auth';
import { demoEnabled } from './env';
import { ensurePersonalWorkspace } from './workspaces';

const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  image: z.string().nullable().optional(),
});
export type Actor = z.infer<typeof userSchema>;
export async function currentActor(): Promise<Actor | null> {
  const auth = getAuth();
  if (!auth)
    return demoEnabled()
      ? {
          id: 'demo-user',
          name: 'Demo reviewer',
          email: 'reviewer@example.test',
        }
      : null;
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

export async function providerTokenSource(
  provider: Provider,
  owner?: string,
  identity = false,
  host = 'github.com',
  broad = false,
): Promise<TokenSource> {
  const auth = getAuth();
  if (!auth)
    return {
      get: async () => ({ status: 'signed-out', reason: 'Connect a provider' }),
    };
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) return { get: async () => ({ status: 'signed-out', reason: 'Sign in' }) };
  const repositorySource =
    provider === 'github' && !identity && !broad
      ? await (await import('./repository-apps')).storedAppUserSource(session.user.id, owner, host)
      : null;
  const accounts = await auth.api.listUserAccounts({ headers: requestHeaders });
  const account =
    provider === 'github' && host !== 'github.com'
      ? accounts.find((a) => a.providerId === `github@${host}`)
      : provider === 'github'
        ? broad
          ? (accounts.find((a) => a.providerId === 'github-oauth') ??
            accounts.find((a) => a.providerId === 'github-repository') ??
            accounts.find((a) => a.providerId === 'github'))
          : identity
            ? accounts.find((a) => a.providerId === 'github')
            : (accounts.find((a) => a.providerId === 'github-repository') ??
              accounts.find((a) => a.providerId === 'github-oauth') ??
              accounts.find((a) => a.providerId === 'github'))
        : accounts.find((a) => a.providerId === provider);
  const identitySource: TokenSource = {
    async get(options = {}) {
      if (!account) return { status: 'signed-out', reason: 'Connect a provider' };
      try {
        if (options.force)
          await auth.api.refreshToken({
            headers: requestHeaders,
            body: { accountId: account.id },
          });
        const result = await auth.api.getAccessToken({
          headers: requestHeaders,
          body: { accountId: account.id },
        });
        return typeof result.accessToken === 'string'
          ? {
              status: 'ok',
              token: result.accessToken,
              refreshed: options.force === true,
            }
          : { status: 'signed-out', reason: 'Reconnect the provider' };
      } catch {
        return {
          status: 'unavailable',
          message: 'Reconnect the provider or try again later',
        };
      }
    },
  };
  return repositorySource
    ? {
        get: (options) => repositorySource.get(options),
        alternatives: [...(repositorySource.alternatives ?? []), identitySource],
      }
    : identitySource;
}

export async function providerViewer(provider: Provider, host = 'github.com', owner?: string): Promise<string | null> {
  const { createApiTransport } = await import('@geld/github');
  const { githubEndpoints } = await import('@geld/domain');
  const { enterpriseFetch } = await import('./enterprise');
  const baseUrl =
    provider === 'github'
      ? githubEndpoints(host).api
      : provider === 'gitlab'
        ? 'https://gitlab.com/api/v4/'
        : 'https://api.bitbucket.org/2.0/';
  const api = createApiTransport({
    baseUrl,
    source: await providerTokenSource(provider, owner, false, host),
    ...(provider === 'github' && host !== 'github.com' ? { fetch: await enterpriseFetch(host) } : {}),
  });
  const result = await api.request('user');
  if (!result.ok) return null;
  return providerProfileIdentity(provider, result.value)?.username ?? null;
}

export async function syncProviderProfiles(userId: string): Promise<Record<string, string>> {
  const { createApiTransport } = await import('@geld/github');
  const { database } = await import('./db');
  const viewers: Record<string, string> = {};
  const db = database();
  await Promise.allSettled(
    (['github', 'gitlab', 'bitbucket'] satisfies Provider[]).map(async (provider) => {
      const api = createApiTransport({
        baseUrl:
          provider === 'github'
            ? 'https://api.github.com/'
            : provider === 'gitlab'
              ? 'https://gitlab.com/api/v4/'
              : 'https://api.bitbucket.org/2.0/',
        source: await providerTokenSource(provider),
        fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(5000) }),
      });
      const result = await api.request('user');
      if (!result.ok) return;
      const identity = providerProfileIdentity(provider, result.value);
      if (!identity) return;
      const host = provider === 'github' ? 'github.com' : provider === 'gitlab' ? 'gitlab.com' : 'bitbucket.org';
      viewers[provider] = identity.username;
      viewers[`${provider}@${host}`] = identity.username;
      if (db)
        await db.query(
          'INSERT INTO provider_user_links(user_id,provider,host,external_id,login) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,provider,host) DO UPDATE SET external_id=EXCLUDED.external_id,login=EXCLUDED.login',
          [userId, provider, host, identity.externalId, identity.username],
        );
    }),
  );
  return viewers;
}
