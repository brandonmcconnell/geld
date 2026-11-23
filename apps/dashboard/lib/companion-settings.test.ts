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

describe('fallback settings authority', () => {
  it('persists explicit fallback independently from the normal Geld toggle and enforces paid eligibility', async () => {
    const teamId = '22222222-2222-4222-8222-222222222222';
    await db.query("INSERT INTO teams(id,name,created_by) VALUES($1,'Team','u')", [teamId]);
    await db.query("INSERT INTO team_members(team_id,user_id,role) VALUES($1,'u','admin')", [teamId]);
    await db.query('INSERT INTO subscriptions(team_id,card_on_file,cap_cents) VALUES($1,true,5000)', [teamId]);
    const input = {
      provider: 'geld',
      label: 'Geld',
      enabled: true,
      billed: false,
      safetyNet: true,
      capCents: 5000,
      teamId,
      models: [],
      automaticLadder: true,
    };
    const saved = await saveProvider(request('/api/ai/providers', input));
    expect(saved.status).toBe(200);
    expect((await db.query("SELECT settings FROM ai_providers WHERE provider='geld'")).rows).toEqual([
      { settings: expect.objectContaining({ billed: false, safetyNet: true, teamId }) },
    ]);
    expect((await db.query('SELECT safety_net,cap_cents FROM subscriptions')).rows).toEqual([
      { safety_net: true, cap_cents: 5000 },
    ]);
    await db.query('UPDATE subscriptions SET card_on_file=false');
    expect((await saveProvider(request('/api/ai/providers', input))).status).toBe(403);
    await db.query('UPDATE subscriptions SET card_on_file=true');
    expect((await saveProvider(request('/api/ai/providers', { ...input, capCents: 0 }))).status).toBe(403);
    await db.query("UPDATE team_members SET role='member'");
    expect((await saveProvider(request('/api/ai/providers', input))).status).toBe(403);
  });
});
