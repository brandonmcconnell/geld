import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('next/server', () => ({ connection: async () => undefined }));
vi.mock('./session', () => ({
  currentActor: async () => ({ id: 'reader', name: 'Reader', email: 'reader@example.test' }),
}));
let db: PGlite;
const sql = { query: async (text: string, values?: unknown[]) => db.query(text, values) };
vi.mock('./db', () => ({ database: () => ({ ...sql, connect: async () => ({ ...sql, release: () => undefined }) }) }));
import { encryptCredential } from './crypto';
import { storedAppUserSource } from './repository-apps';
import { resourceDigest } from './resource-digest';
import { GET } from '../app/api/apps/authorize/route';
describe('reader repository authorization', () => {
  it('links an actor-bound App token without granting installation administration and rejects state replay', async () => {
    db = new PGlite();
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', 'synthetic-native-app-key-at-least-32-characters');
    vi.stubEnv('BETTER_AUTH_URL', 'https://dashboard.example.test');
    const directory = new URL('../db/migrations/', import.meta.url);
    for (const name of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort())
      await db.exec(await readFile(new URL(name, directory), 'utf8'));
    await db.exec(
      "INSERT INTO users(id,name,email) VALUES('reader','Reader','reader@example.test');INSERT INTO teams(id,name,personal_owner_id) VALUES('personal','Personal','reader');INSERT INTO team_members(team_id,user_id,role) VALUES('personal','reader','admin');",
    );
    await db.query(
      "INSERT INTO repository_apps(id,host,fingerprint,permissions,app_id,slug,client_id,encrypted_secret,encrypted_private_key,encrypted_webhook_secret) VALUES('app','github.com','fingerprint','{}','1','geld-reader','repo-client',$1,$2,$3)",
      [
        await encryptCredential('synthetic-client-secret'),
        await encryptCredential('unused-private-key'),
        await encryptCredential('synthetic-webhook-secret'),
      ],
    );
    const state = crypto.randomUUID();
    await db.query(
      "INSERT INTO app_flows(id,actor_id,team_id,kind,app_id,state_digest,settings) VALUES('flow','reader','personal','authorize','app',$1,'{\"personal\":true}')",
      [resourceDigest(state)],
    );
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
      calls.push(input);
      if (input === 'https://github.com/login/oauth/access_token') {
        expect(init?.method).toBe('POST');
        return Response.json({ access_token: 'synthetic-user-token', expires_in: 3600 });
      }
      if (input === 'https://api.github.com/user') {
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer synthetic-user-token');
        return Response.json({ id: 123, login: 'reader' });
      }
      throw new Error('Unexpected provider call');
    });
    const request = new Request(
      `https://dashboard.example.test/api/apps/authorize?${new URLSearchParams({ state, code: 'synthetic-code' })}`,
    );
    const response = await GET(request);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://dashboard.example.test/connect?repositories=select');
    expect(calls).toEqual(['https://github.com/login/oauth/access_token', 'https://api.github.com/user']);
    const stored = await db.query<{ encrypted_access: string }>('SELECT encrypted_access FROM app_user_tokens');
    expect(stored.rows[0]?.encrypted_access).toMatch(/^v1\./);
    expect(JSON.stringify(stored.rows)).not.toContain('synthetic-user-token');
    expect((await db.query('SELECT * FROM team_app_installations')).rows).toHaveLength(0);
    const source = await storedAppUserSource('reader', 'private-owner', {
      sql,
      run: (work) => db.transaction((tx) => work({ query: (text, values) => tx.query(text, values) })),
    });
    expect(await source?.get()).toMatchObject({ status: 'ok', token: 'synthetic-user-token' });
    expect((await GET(request)).status).toBe(409);
    expect(calls).toHaveLength(2);
    await db.close();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
});
