import { beforeEach, describe, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({
  contains: vi.fn(async (_request: { origins: string[] }) => false),
  request: vi.fn(async (_request: { origins: string[] }) => false),
  send: vi.fn(async () => ({ ok: true })),
  register: vi.fn(async (_value: unknown) => undefined),
  unregister: vi.fn(async (_value: unknown) => undefined),
}));
vi.mock('wxt/browser', () => ({ browser: {
  permissions: { contains: api.contains, request: api.request },
  runtime: { sendMessage: api.send },
  scripting: { registerContentScripts: api.register, unregisterContentScripts: api.unregister },
} }));
import { enableProviderAccess, grantedProviderHosts, syncOptionalProviders } from './provider-access';
import { OPTIONAL_PROVIDER_ORIGINS, withoutRequiredProviderOrigins } from './provider-access-spec';

beforeEach(() => { vi.clearAllMocks(); api.contains.mockResolvedValue(false); api.request.mockResolvedValue(false); });

describe('optional cloud provider access', () => {
  it('keeps existing GitHub access and strips only the new cloud origins from required access', () => {
    expect(withoutRequiredProviderOrigins(['storage', 'https://github.com/*', 'https://api.github.com/*', ...OPTIONAL_PROVIDER_ORIGINS.gitlab, ...OPTIONAL_PROVIDER_ORIGINS.bitbucket, 'https://custom.example/*']))
      .toEqual(['storage', 'https://github.com/*', 'https://api.github.com/*', 'https://custom.example/*']);
  });

  it('never asks permission or registers provider code during startup without a grant', async () => {
    await syncOptionalProviders(3);
    expect(await grantedProviderHosts()).toEqual([]);
    expect(api.request).not.toHaveBeenCalled();
    expect(api.register).not.toHaveBeenCalled();
    expect(api.unregister).toHaveBeenCalledTimes(4);
  });

  it('registers only granted native provider scripts, including the Bitbucket MAIN helper', async () => {
    api.contains.mockImplementation(async ({ origins }) => origins.includes('https://bitbucket.org/*') && origins.includes('https://api.bitbucket.org/*'));
    await syncOptionalProviders(3);
    expect(await grantedProviderHosts()).toEqual(['bitbucket.org']);
    expect(api.register.mock.calls).toEqual([
      [[{ id: 'geld-bitbucket-main', matches: ['https://bitbucket.org/*'], js: ['content-scripts/bitbucket-whitespace.js'], runAt: 'document_start', world: 'MAIN', persistAcrossSessions: true },
        { id: 'geld-bitbucket', matches: ['https://bitbucket.org/*'], js: ['content-scripts/bitbucket.js'], css: ['content-scripts/bitbucket.css'], runAt: 'document_start', persistAcrossSessions: true }]],
    ]);
    api.contains.mockResolvedValue(false); api.register.mockClear();
    await syncOptionalProviders(3);
    expect(api.register).not.toHaveBeenCalled();
  });

  it('uses the supported scripting MAIN world on Firefox MV2 with an optional capability grant', async () => {
    api.request.mockResolvedValue(true);
    await enableProviderAccess('bitbucket', 2);
    expect(api.request).toHaveBeenCalledWith({ origins: OPTIONAL_PROVIDER_ORIGINS.bitbucket, permissions: ['scripting'] });
    api.contains.mockResolvedValue(true);
    await syncOptionalProviders(2);
    expect(api.contains).toHaveBeenCalledWith({ origins: OPTIONAL_PROVIDER_ORIGINS.bitbucket, permissions: ['scripting'] });
    expect(JSON.stringify(api.register.mock.calls)).toContain('MAIN');
  });

  it('rejects and rolls back incomplete registrations instead of reporting a missing MAIN bridge as enabled', async () => {
    api.contains.mockImplementation(async ({ origins }) => origins.includes('https://bitbucket.org/*'));
    api.register.mockRejectedValueOnce(new Error('MAIN unsupported'));
    await expect(syncOptionalProviders(3)).rejects.toThrow('MAIN unsupported');
    expect(api.unregister.mock.calls.filter(([value]) => JSON.stringify(value).includes('geld-bitbucket-main'))).toHaveLength(2);
  });

  it('requests exact provider origins only on enable and serializes registration in the background', async () => {
    expect(await enableProviderAccess('bitbucket')).toBe(false);
    expect(api.request).toHaveBeenCalledWith({ origins: ['https://bitbucket.org/*', 'https://api.bitbucket.org/*'] });
    expect(api.send).not.toHaveBeenCalled();
    api.request.mockResolvedValue(true);
    expect(await enableProviderAccess('gitlab')).toBe(true);
    expect(api.send).toHaveBeenCalledWith({ type: 'geld:sync-provider-access' });
    expect(api.register).not.toHaveBeenCalled();
  });
});
