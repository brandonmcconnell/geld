// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ has: vi.fn(async () => false), enable: vi.fn(async () => true) }));
vi.mock('../lib/provider-access', () => ({ hasProviderAccess: api.has, enableProviderAccess: api.enable }));
import { mountProviderAccess } from './provider-access';

beforeEach(() => { document.body.replaceChildren(); vi.clearAllMocks(); api.has.mockResolvedValue(false); api.enable.mockResolvedValue(true); });
describe('provider enable controls', () => {
  it('shows explicit enable actions and requests nothing until activation', async () => {
    const host = document.createElement('section'); document.body.append(host);
    const enabled = vi.fn(); mountProviderAccess(host, enabled);
    await Promise.resolve();
    expect(api.enable).not.toHaveBeenCalled();
    const button = host.querySelector<HTMLButtonElement>('[data-provider-enable="gitlab"]');
    expect(button?.textContent).toBe('Enable GitLab'); button?.click();
    await vi.waitFor(() => expect(button?.textContent).toBe('GitLab enabled'));
    expect(button?.disabled).toBe(true); expect(enabled).toHaveBeenCalledOnce();
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Reload open GitLab tabs');
  });

  it('leaves denied access available without pretending the provider was enabled', async () => {
    api.enable.mockResolvedValue(false); const host = document.createElement('section'); document.body.append(host); mountProviderAccess(host);
    await Promise.resolve(); const button = host.querySelector<HTMLButtonElement>('[data-provider-enable="bitbucket"]'); button?.click();
    await vi.waitFor(() => expect(host.querySelector('[role="status"]')?.textContent).toContain('was not granted'));
    expect(button?.disabled).toBe(false); expect(button?.textContent).toBe('Enable Bitbucket');
  });
});
