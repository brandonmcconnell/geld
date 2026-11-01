import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  contains: vi.fn(async () => true),
  unregister: vi.fn(async () => undefined),
  register: vi.fn(async () => undefined),
}));
vi.mock('wxt/browser', () => ({ browser: {
  permissions: { contains: api.contains },
  scripting: { unregisterContentScripts: api.unregister, registerContentScripts: api.register },
} }));

import { syncEnterpriseHosts } from './enterprise';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('enterprise host removal', () => {
  it('removes the GitHub page-world portal when no enterprise hosts remain', async () => {
    await syncEnterpriseHosts([], 3);
    expect(api.unregister).toHaveBeenCalledWith({ ids: ['geld-enterprise'] });
    expect(api.unregister).toHaveBeenCalledWith({ ids: ['geld-enterprise-portal'] });
    expect(api.register).not.toHaveBeenCalled();
  });
});
