import 'server-only';
import type { Provider, ProviderClient } from '@geld/domain';
import { createProviderClient } from '@geld/providers';
import { providerTokenSource } from './session';
import { demoEnabled } from './env';
import { demoClient } from './demo';

export async function providerClient(provider: Provider, host?: string, owner?: string): Promise<ProviderClient> {
  if (demoEnabled()) return demoClient(provider);
  if (host && host !== 'github.com' && host !== 'gitlab.com' && host !== 'bitbucket.org') throw new Error('Register this Enterprise host before connecting');
  const source = await providerTokenSource(provider,owner);
  return createProviderClient({ provider, source, ...(host ? { host } : {}), anonymousReads: true });
}
