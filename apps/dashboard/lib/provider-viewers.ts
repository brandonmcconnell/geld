import 'server-only';
import { createApiTransport } from '@geld/github';
import { providerProfileIdentity } from '@geld/domain/identities';
import { providerTokenSource } from './session';

export async function connectedProviderViewers(): Promise<Record<string, string>> {
  const profiles = await Promise.allSettled((['github', 'gitlab', 'bitbucket'] satisfies ('github' | 'gitlab' | 'bitbucket')[]).map(async provider => {
    const host = provider === 'github' ? 'github.com' : provider === 'gitlab' ? 'gitlab.com' : 'bitbucket.org';
    const api = createApiTransport({
      baseUrl: provider === 'github' ? 'https://api.github.com/' : provider === 'gitlab' ? 'https://gitlab.com/api/v4/' : 'https://api.bitbucket.org/2.0/',
      source: await providerTokenSource(provider),
      fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(5000) }),
    });
    const result = await api.request('user');
    const identity = result.ok ? providerProfileIdentity(provider, result.value) : null;
    return identity ? { provider, host, username: identity.username } : null;
  }));
  const viewers: Record<string, string> = {};
  for (const profile of profiles) if (profile.status === 'fulfilled' && profile.value) {
    viewers[profile.value.provider] = profile.value.username;
    viewers[`${profile.value.provider}@${profile.value.host}`] = profile.value.username;
  }
  return viewers;
}
