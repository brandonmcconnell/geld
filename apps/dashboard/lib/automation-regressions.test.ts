import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { managedAccessAdapter } from '@geld/providers';
import type { SqlExecutor } from './transactions';
vi.mock('server-only', () => ({}));
import { prepareInstallationMigration, linkVerifiedInstallation } from './app-migrations';
import { recoverGuideCredits, recordGuidePublication } from './guide-publications';
import { createGeneratedContentStore } from './content-store';
import { readableRepositoryDefaults } from './review-defaults';
import { reserveCredits } from './credits';
beforeEach(() => vi.stubEnv('TOKEN_ENCRYPTION_KEY', 'test-security-signing-key-at-least-32-characters'));
afterEach(() => vi.unstubAllEnvs());
async function fixture() {
  const db = new PGlite();
  for (const name of [
    '0001_auth.sql',
    '0002_dashboard.sql',
    '0003_review.sql',
    '0004_workspaces.sql',
    '0005_access.sql',
    '0006_apps.sql',
    '0007_automation.sql',
    '0008_trackers.sql',
    '0009_tracker_oauth.sql',
    '0010_enterprise.sql',
    '0011_companion.sql',
    '0012_privacy.sql',
    '0013_access_flows.sql',
  ])
    await db.exec(await readFile(new URL(`../db/migrations/${name}`, import.meta.url), 'utf8'));
  await db.exec(
    "INSERT INTO users(id,name,email) VALUES('u','Reviewer','reviewer@example.test'); INSERT INTO teams(id,name) VALUES('t','Team'),('other','Other'); INSERT INTO team_members(team_id,user_id,role) VALUES('t','u','admin'); INSERT INTO team_repos(id,team_id,provider,host,external_id,owner,name,settings) VALUES('r','t','github','github.com','1','org','visible','{}'),('hidden','t','github','github.com','2','org','secret-name','{\"guidePolicy\":{\"trigger\":\"push\"}}'); INSERT INTO subscriptions(team_id,tier,seats,used_credits,cap_cents,card_on_file,stripe_subscription_id) VALUES('t','starter',1,39,100,true,'sub')",
  );
  const sql: SqlExecutor = { query: (text, values) => db.query(text, values) };
  const run = <T>(work: (sql: SqlExecutor) => Promise<T>) =>
    db.transaction((tx) => work({ query: (text, values) => tx.query(text, values) }));
  return { db, sql, run };
}
const plan = {
  id: 'p',
  headSha: 'head',
  madeAt: '2026-11-01T00:00:00Z',
  producer: 'ai',
  model: 'Fixture',
  steps: [],
  unassigned: [],
  excerpted: false,
} satisfies Parameters<ReturnType<typeof createGeneratedContentStore>['put']>[0]['plan'];
describe('automatic guide completion recovery', () => {
  it('atomically records a saved plan receipt and settles a lost completion exactly once', async () => {
    const f = await fixture();
    try {
      const reservation = await f.run((sql) =>
        reserveCredits(sql, { teamId: 't', actorId: 'u', credits: 2, key: 'guide' }),
      );
      if (!reservation.ok) throw new Error('Reservation failed');
      await f.db.query("INSERT INTO guide_publications(reservation_id,team_id,repo_id) VALUES($1,'t','r')", [
        reservation.id,
      ]);
      const store = createGeneratedContentStore(f);
      await store.put({ teamId: 't', repoId: 'r', number: 1, headSha: 'head', plan, reservationId: reservation.id });
      expect((await f.db.query('SELECT state FROM credit_reservations')).rows).toEqual([{ state: 'reserved' }]);
      await recoverGuideCredits({ ...f, store: () => store, reservationId: reservation.id });
      await recoverGuideCredits({ ...f, store: () => store, reservationId: reservation.id });
      expect(
        (await f.db.query('SELECT state,settled_at IS NOT NULL AS finished FROM credit_reservations')).rows,
      ).toEqual([{ state: 'settled', finished: true }]);
      expect(
        (await f.db.query("SELECT count(*)::integer AS count FROM outbox_jobs WHERE kind='bill_overage'")).rows,
      ).toEqual([{ count: 1 }]);
      const later = await f.run((sql) => reserveCredits(sql, { teamId: 't', actorId: 'u', credits: 1, key: 'later' }));
      if (!later.ok) throw new Error('Later reservation failed');
      await store.put({
        teamId: 't',
        repoId: 'r',
        number: 1,
        headSha: 'head',
        plan: { ...plan, id: 'replacement' },
        reservationId: later.id,
      });
      expect(await store.hasPublication(reservation.id)).toBe(true);
      expect((await store.get('t', 'r', 1, 'head'))?.id).toBe('replacement');
      await store.deleteTeam('t');
      expect(await store.hasPublication(reservation.id)).toBe(false);
    } finally {
      await f.db.close();
    }
  });
  it('keeps unknown publication outcomes reserved and refunds only a confirmed absent receipt', async () => {
    const f = await fixture();
    try {
      const reservation = await f.run((sql) =>
        reserveCredits(sql, { teamId: 't', actorId: 'u', credits: 2, key: 'guide' }),
      );
      if (!reservation.ok) throw new Error('Reservation failed');
      await f.db.query("INSERT INTO guide_publications(reservation_id,team_id,repo_id) VALUES($1,'t','r')", [
        reservation.id,
      ]);
      await expect(
        recoverGuideCredits({
          ...f,
          reservationId: reservation.id,
          store: () => ({
            hasPublication: async () => {
              throw new Error('Storage unavailable');
            },
          }),
        }),
      ).rejects.toThrow('Storage unavailable');
      expect((await f.db.query('SELECT state FROM credit_reservations')).rows).toEqual([{ state: 'reserved' }]);
      await recoverGuideCredits({
        ...f,
        reservationId: reservation.id,
        store: () => ({ hasPublication: async (id) => id === 'another-reservation' }),
      });
      expect((await f.db.query('SELECT state FROM credit_reservations')).rows).toEqual([{ state: 'refunded' }]);
      expect((await f.db.query('SELECT used_credits,spent_cents FROM subscriptions')).rows).toEqual([
        { used_credits: 39, spent_cents: 0 },
      ]);
    } finally {
      await f.db.close();
    }
  });
});
describe('shared installation migrations', () => {
  it('keeps other teams on the old App and fences new links when the last team starts retiring it', async () => {
    const f = await fixture();
    try {
      for (const id of ['old', 'next']) {
        await f.db.query(
          "INSERT INTO repository_apps(id,fingerprint,permissions,app_id,slug,client_id,encrypted_secret,encrypted_private_key,encrypted_webhook_secret) VALUES($1,$1,'{}',$1,$1,$1,'unused','unused','unused')",
          [id],
        );
        await linkVerifiedInstallation(f.sql, {
          id,
          externalId: id,
          appId: id,
          fingerprint: id,
          registryId: id,
          owner: 'org',
          permissions: { contents: 'read' },
        });
      }
      await f.db.exec(
        "INSERT INTO team_app_installations(team_id,installation_id) VALUES('t','old'),('t','next'),('other','old')",
      );
      expect(
        await f.run((sql) => prepareInstallationMigration(sql, { teamId: 't', oldId: 'old', newId: 'next' })),
      ).toBe('shared');
      expect((await f.db.query("SELECT state FROM app_installations WHERE id='old'")).rows).toEqual([
        { state: 'verified' },
      ]);
      expect((await f.db.query("SELECT team_id FROM team_app_installations WHERE installation_id='old'")).rows).toEqual(
        [{ team_id: 'other' }],
      );
      await f.db.exec("INSERT INTO team_app_installations(team_id,installation_id) VALUES('other','next')");
      expect(
        await f.run((sql) => prepareInstallationMigration(sql, { teamId: 'other', oldId: 'old', newId: 'next' })),
      ).toBe('exclusive');
      expect(
        await linkVerifiedInstallation(f.sql, {
          id: 'late',
          externalId: 'old',
          appId: 'old',
          fingerprint: 'old',
          registryId: 'old',
          owner: 'org',
          permissions: { contents: 'read' },
        }),
      ).toBeNull();
      expect((await f.db.query("SELECT state FROM app_installations WHERE id='old'")).rows).toEqual([
        { state: 'migrating' },
      ]);
    } finally {
      await f.db.close();
    }
  });
});
describe('review defaults visibility', () => {
  it('checks the member’s provider authority before returning repository names or settings', async () => {
    const f = await fixture();
    try {
      const result = await readableRepositoryDefaults(f.sql, 't', async () =>
        managedAccessAdapter({
          provider: 'github',
          source: { get: async () => ({ status: 'ok', token: 'fixture', refreshed: false }) },
          fetch: async (url) =>
            url.includes('secret-name')
              ? new Response(null, { status: 404 })
              : Response.json({
                  id: 1,
                  name: 'visible',
                  owner: { login: 'org' },
                  private: true,
                  html_url: 'https://github.com/org/visible',
                  permissions: { pull: true },
                }),
        }),
      );
      expect(result).toEqual([{ id: 'r', owner: 'org', name: 'visible', settings: {} }]);
      expect(JSON.stringify(result)).not.toContain('secret-name');
      expect(JSON.stringify(result)).not.toContain('push');
    } finally {
      await f.db.close();
    }
  });
});

describe('automatic publication ownership', () => {
  it('refuses a replaced job claim or a reservation that has already been refunded', async () => {
    const f = await fixture();
    try {
      const reservation = await f.run((sql) =>
        reserveCredits(sql, { teamId: 't', actorId: 'u', credits: 1, key: 'claim-test' }),
      );
      if (!reservation.ok) throw new Error('Reservation failed');
      await f.db.exec(
        "INSERT INTO outbox_jobs(id,team_id,kind,resource_id,idempotency_key,state,locked_at,lock_token) VALUES('job','t','automatic_guide','r','job-key','running',now(),'new-claim')",
      );
      const publication = {
        reservationId: reservation.id,
        teamId: 't',
        repoId: 'r',
        fingerprint: 'fingerprint',
        headSha: 'head',
        claim: { id: 'job', token: 'old-claim' },
      };
      await expect(f.run((sql) => recordGuidePublication(sql, publication))).rejects.toThrow('claim changed');
      expect((await f.db.query('SELECT reservation_id FROM guide_publications')).rows).toEqual([]);
      await f.db.exec("UPDATE credit_reservations SET state='refunded'");
      await expect(
        f.run((sql) => recordGuidePublication(sql, { ...publication, claim: { id: 'job', token: 'new-claim' } })),
      ).rejects.toThrow('reservation changed');
      expect((await f.db.query('SELECT reservation_id FROM guide_publications')).rows).toEqual([]);
    } finally {
      await f.db.close();
    }
  });
});
