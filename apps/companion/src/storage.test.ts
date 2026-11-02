import { mkdtemp, mkdir, writeFile, readFile, chmod, stat, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { savePairing } from './storage';
const config = {
  version: 1,
  kind: 'claude',
  brokerUrl: 'https://relay.example.test',
  channel: crypto.randomUUID(),
  secret: 'x'.repeat(64),
} satisfies Parameters<typeof savePairing>[1];
describe('pairing secret file protection', () => {
  it('restricts an existing directory and file before replacing their contents', async () => {
    const root = await mkdtemp(join(tmpdir(), 'geld-pairing-test-'));
    try {
      const folder = join(root, 'geld');
      const file = join(folder, 'companion.json');
      await mkdir(folder);
      await chmod(folder, 0o755);
      await writeFile(file, 'old');
      await chmod(file, 0o644);
      await savePairing(folder, config);
      expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(config);
      if (process.platform !== 'win32') {
        expect((await stat(folder)).mode & 0o777).toBe(0o700);
        expect((await stat(file)).mode & 0o777).toBe(0o600);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it.skipIf(process.platform === 'win32')('does not replace a symlink target with a secret', async () => {
    const root = await mkdtemp(join(tmpdir(), 'geld-pairing-link-'));
    try {
      const folder = join(root, 'geld');
      await mkdir(folder);
      const target = join(root, 'target');
      await writeFile(target, 'keep');
      await symlink(target, join(folder, 'companion.json'));
      await expect(savePairing(folder, config)).rejects.toThrow();
      expect(await readFile(target, 'utf8')).toBe('keep');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
