import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('next/server', () => ({ connection: async () => undefined }));
vi.mock('./request-audit', () => ({
  auditedRoute: <T extends unknown[]>(handler: (request: Request, ...rest: T) => Promise<Response>) => handler,
}));
vi.mock('./session', () => ({ currentActor: async () => ({ id: 'u' }) }));
let db: PGlite;
let storageCalls = 0;
vi.mock('./db', () => ({
  database: () => {
    storageCalls++;
    return {
      query: (text: string, values?: unknown[]) => db.query(text, values),
      connect: async () => ({
        query: (text: string, values?: unknown[]) => db.query(text, values),
        release: () => undefined,
      }),
    };
  },
}));
import { POST as saveProvider } from '../app/api/ai/providers/route';
import { POST as pair } from '../app/api/companion/connect/route';
const id = '11111111-1111-4111-8111-111111111111';
function request(path: string, input: unknown) {
  return new Request('https://dashboard.example' + path, {
    method: 'POST',
    headers: { origin: 'https://dashboard.example', 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}
beforeEach(async () => {
  vi.stubEnv('BETTER_AUTH_URL', 'https://dashboard.example');
  vi.stubEnv('TOKEN_ENCRYPTION_KEY', 'synthetic-companion-settings-key-at-least-32-characters');
  db = new PGlite();
  const directory = new URL('../db/migrations/', import.meta.url);
  for (const name of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort())
    await db.exec(await readFile(new URL(name, directory), 'utf8'));
  await db.exec("INSERT INTO users(id,name,email) VALUES('u','User','user@example.test')");
  await db.query(
    "INSERT INTO ai_providers(id,user_id,provider,label,encrypted_key,enabled,settings) VALUES($1,'u','claude','Claude','legacy-key',true,'{\"mode\":\"api\"}')",
    [id],
  );
  storageCalls = 0;
});
afterEach(async () => {
  await db.close();
  vi.unstubAllEnvs();
});
describe('companion setup authority', () => {
  it('rejects keys in login mode and clears a legacy key when converting an existing connection', async () => {
    const input = {
      id,
      provider: 'claude',
      mode: 'login',
      label: 'Claude',
      enabled: true,
      models: [],
      automaticLadder: true,
    };
    expect((await saveProvider(request('/api/ai/providers', { ...input, key: 'must-not-store' }))).status).toBe(400);
    expect((await db.query('SELECT encrypted_key FROM ai_providers')).rows).toEqual([{ encrypted_key: 'legacy-key' }]);
    expect((await saveProvider(request('/api/ai/providers', input))).status).toBe(200);
    expect((await db.query("SELECT encrypted_key,settings->>'mode' AS mode FROM ai_providers")).rows).toEqual([
      { encrypted_key: null, mode: 'login' },
    ]);
  });
  it('rejects incompatible public broker URLs before touching or revoking stored channels', async () => {
    for (const broker of [
      'https://relay.example/path?token=secret',
      'https://relay.example/path#fragment',
      'https://user:secret@relay.example',
      'http://relay.example',
    ]) {
      vi.stubEnv('RELAY_PUBLIC_BROKER_URL', broker);
      expect((await pair(request('/api/companion/connect', { id }))).status).toBe(503);
    }
    expect(storageCalls).toBe(0);
  });
});
