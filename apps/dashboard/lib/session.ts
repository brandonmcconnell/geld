import 'server-only';
import { headers } from 'next/headers';
import { z } from 'zod';
import type { Provider } from '@geld/domain';
import type { TokenSource } from '@geld/github';
import { getAuth } from './auth';
import { demoEnabled } from './env';

const userSchema = z.object({ id: z.string(), name: z.string(), email: z.string(), image: z.string().nullable().optional() });
export type Actor = z.infer<typeof userSchema>;
export async function currentActor(): Promise<Actor | null> {
  const auth = getAuth();
  if (!auth) return demoEnabled() ? { id: 'demo-user', name: 'Demo reviewer', email: 'reviewer@example.test' } : null;
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    const parsed = userSchema.safeParse(session?.user);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function providerTokenSource(provider: Provider): Promise<TokenSource> {
  const auth = getAuth();
  if (!auth) return { get: async () => ({ status: 'signed-out', reason: 'Connect a provider' }) };
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) return { get: async () => ({ status: 'signed-out', reason: 'Sign in' }) };
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
