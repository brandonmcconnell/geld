import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { encryptCredential, decryptCredential } from './crypto';
describe('stored credential encryption', () => {
  it('round trips secrets and rejects tampering and rotated keys', async () => {
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', crypto.randomUUID());
    const original = crypto.randomUUID();
    const encrypted = await encryptCredential(original);
    expect(encrypted).not.toContain(original);
    expect(await decryptCredential(encrypted)).toBe(original);
    expect(await decryptCredential(`${encrypted}changed`)).toBeNull();
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', crypto.randomUUID());
    expect(await decryptCredential(encrypted)).toBeNull();
    vi.unstubAllEnvs();
  });
});
