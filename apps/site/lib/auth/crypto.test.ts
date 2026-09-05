import { describe, expect, it } from 'vitest';

import { open, randomToken, seal } from './crypto';

describe('seal/open', () => {
  it('round-trips and never repeats ciphertext', async () => {
    const a = await seal('{"token":"gho_x"}', 'secret-one');
    const b = await seal('{"token":"gho_x"}', 'secret-one');
    expect(a).not.toBe(b);
    expect(await open(a, 'secret-one')).toBe('{"token":"gho_x"}');
    expect(await open(b, 'secret-one')).toBe('{"token":"gho_x"}');
  });

  it('rejects the wrong secret, tampering and malformed input', async () => {
    const sealed = await seal('payload', 'secret-one');
    expect(await open(sealed, 'secret-two')).toBeNull();
    const [version, iv, ciphertext] = sealed.split('.');
    const flipped = `${version}.${iv}.${(ciphertext ?? '').startsWith('A') ? 'B' : 'A'}${(ciphertext ?? '').slice(1)}`;
    expect(await open(flipped, 'secret-one')).toBeNull();
    expect(await open('v0.abc.def', 'secret-one')).toBeNull();
    expect(await open('not a cookie', 'secret-one')).toBeNull();
    expect(await open(`${sealed}.extra`, 'secret-one')).toBeNull();
  });

  it('produces URL-safe state tokens', () => {
    const token = randomToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(randomToken()).not.toBe(token);
  });
});
