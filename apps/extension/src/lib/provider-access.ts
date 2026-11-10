import { browser } from 'wxt/browser';
import { isNightlyPaused } from '../nightly/state';
import { OPTIONAL_PROVIDER_ORIGINS } from './provider-access-spec';
import type { OptionalProvider } from './provider-access-spec';

export async function hasProviderAccess(provider: OptionalProvider, manifestVersion = import.meta.env.MANIFEST_VERSION): Promise<boolean> {
  try { return await browser.permissions.contains({ origins: OPTIONAL_PROVIDER_ORIGINS[provider], ...(manifestVersion === 2 ? { permissions: ['scripting'] } : {}) }); }
  catch { return false; }
}

export async function enableProviderAccess(provider: OptionalProvider, manifestVersion = import.meta.env.MANIFEST_VERSION): Promise<boolean> {
  const granted = await browser.permissions.request({ origins: OPTIONAL_PROVIDER_ORIGINS[provider], ...(manifestVersion === 2 ? { permissions: ['scripting'] } : {}) });
  if (granted) {
    const response: unknown = await browser.runtime.sendMessage({ type: 'geld:sync-provider-access' });
    if (typeof response !== 'object' || response === null || Reflect.get(response, 'ok') !== true) throw new Error('Provider registration failed.');
  }
  return granted;
}

export async function grantedProviderHosts(): Promise<string[]> {
  const hosts: string[] = [];
  for (const provider of ['gitlab', 'bitbucket'] as const) if (await hasProviderAccess(provider)) hosts.push(provider === 'gitlab' ? 'gitlab.com' : 'bitbucket.org');
  return hosts;
}

export function isOptionalProviderScript(id: string): boolean {
  return /^(?:geld-gitlab|geld-bitbucket)(?:-main)?$/.test(id);
}

let queue: Promise<void> = Promise.resolve();

export function syncOptionalProviders(manifestVersion = import.meta.env.MANIFEST_VERSION): Promise<void> {
  const sync = async (): Promise<void> => {
    const paused = __GELD_NIGHTLY__ && await isNightlyPaused();
    for (const provider of ['gitlab', 'bitbucket'] as const) {
      const id = `geld-${provider}`, mainId = `${id}-main`, granted = await hasProviderAccess(provider, manifestVersion);
      const matches = [OPTIONAL_PROVIDER_ORIGINS[provider][0] ?? ''];
      for (const scriptId of [id, mainId]) await browser.scripting.unregisterContentScripts({ ids: [scriptId] }).catch(() => undefined);
      if (!granted || paused) continue;
      const scripts: Parameters<typeof browser.scripting.registerContentScripts>[0] = [];
      if (provider === 'bitbucket') scripts.push({ id: mainId, matches, js: ['content-scripts/bitbucket-whitespace.js'], runAt: 'document_start', world: 'MAIN', persistAcrossSessions: true });
      scripts.push({ id, matches, js: [`content-scripts/${provider}.js`], css: [`content-scripts/${provider}.css`], runAt: 'document_start', persistAcrossSessions: true });
      try { await browser.scripting.registerContentScripts(scripts); }
      catch (error) {
        for (const scriptId of [id, mainId]) await browser.scripting.unregisterContentScripts({ ids: [scriptId] }).catch(() => undefined);
        throw error;
      }
    }
  };
  const run = queue.catch(() => undefined).then(sync);
  queue = run;
  return run;
}

export function isProviderAccessSync(value: unknown): boolean { return typeof value === 'object' && value !== null && Reflect.get(value, 'type') === 'geld:sync-provider-access'; }
