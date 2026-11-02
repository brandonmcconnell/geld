import 'server-only';
import type { Provider, ProviderClient } from '@geld/domain';
import { createProviderClient } from '@geld/providers';
import { registeredEnterpriseHost, enterpriseFetch } from './enterprise';
import { currentActor, providerTokenSource } from './session';
import { demoEnabled } from './env';
import { demoClient } from './demo';

export async function providerClient(provider: Provider, host?: string, owner?: string): Promise<ProviderClient> {
  if (demoEnabled()) return demoClient(provider);
  const enterprise = provider === 'github' && host && host !== 'github.com';
  if (enterprise) {
    const actor = await currentActor();
    if (!actor || !(await registeredEnterpriseHost(host, actor.id)))
      throw new Error('Register this Enterprise host before connecting');
  }
  const source = await providerTokenSource(provider, owner, false, host);
  return createProviderClient({
    provider,
    source,
    ...(host ? { host } : {}),
    anonymousReads: true,
    ...(enterprise ? { fetch: await enterpriseFetch(host) } : {}),
  });
}
