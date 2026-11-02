import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { applyBillingSnapshot } from './billing-events';
import { appendAudit } from './audit';
import { finishCredits, reserveCredits } from './credits';
import type { BillingSnapshot } from './billing-gateway';
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
    "INSERT INTO users(id,name,email) VALUES ('u','Reviewer','reviewer@example.test'),('v','Reviewer 2','second@example.test'); INSERT INTO teams(id,name) VALUES ('t','Team'); INSERT INTO team_members(team_id,user_id,role) VALUES ('t','u','admin'),('t','v','member'); INSERT INTO subscriptions(team_id,tier,seats,used_credits,cap_cents,card_on_file,stripe_customer_id,stripe_subscription_id,period_start) VALUES ('t','starter',1,39,100,true,'cus_test','sub_test','2026-10-01')",
  );
  return {
    db,
    sql: {
      query: async (text: string, values?: unknown[]) => db.query(text, values),
    },
  };
}
const snapshot: BillingSnapshot = {
  id: 'sub_test',
  customerId: 'cus_test',
  tier: 'team',
  status: 'active',
  seats: 1,
  itemId: 'si_test',
  start: Date.parse('2026-11-01') / 1000,
  end: Date.parse('2026-12-01') / 1000,
  card: true,
};
describe('signed billing event application', () => {
  it('uses actual members, resets once per period, ignores duplicates and older events', async () => {
    const { db, sql } = await fixture();
    expect(
      await applyBillingSnapshot(sql, {
        eventId: 'evt_1',
        created: 10,
        subscription: snapshot,
      }),
    ).toBe(true);
    expect((await db.query('SELECT tier,seats,used_credits,included_credits FROM subscriptions')).rows).toEqual([
      { tier: 'team', seats: 2, used_credits: 0, included_credits: 200 },
    ]);
    await db.exec('UPDATE subscriptions SET used_credits = 5');
    expect(
      await applyBillingSnapshot(sql, {
        eventId: 'evt_1',
        created: 10,
        subscription: snapshot,
      }),
    ).toBe(false);
    expect(
      await applyBillingSnapshot(sql, {
        eventId: 'evt_older',
        created: 9,
        subscription: { ...snapshot, tier: 'starter' },
      }),
    ).toBe(false);
    expect(
      await applyBillingSnapshot(sql, {
        eventId: 'evt_2',
        created: 11,
        subscription: snapshot,
      }),
    ).toBe(true);
    expect((await db.query('SELECT used_credits FROM subscriptions')).rows).toEqual([{ used_credits: 5 }]);
    expect(
      await applyBillingSnapshot(sql, {
        eventId: 'foreign',
        created: 12,
        subscription: { ...snapshot, customerId: 'someone_else' },
      }),
    ).toBe(false);
    await db.close();
  });
  it('does not refund old usage into a new period and queues each successful overage once', async () => {
    const { db, sql } = await fixture();
    const first = await reserveCredits(sql, {
      teamId: 't',
      actorId: 'u',
      credits: 2,
      key: 'first',
    });
    if (!first.ok) throw new Error('Reservation failed');
    await finishCredits(sql, first.id, true, true);
    await finishCredits(sql, first.id, true, true);
    expect(
      (await db.query("SELECT count(*)::integer AS count FROM outbox_jobs WHERE kind = 'bill_overage'")).rows,
    ).toEqual([{ count: 1 }]);
    expect((await db.query("SELECT kind FROM outbox_jobs WHERE kind LIKE 'fallback%' ORDER BY kind")).rows).toEqual([
      { kind: 'fallback_email' },
      { kind: 'fallback_summary_email' },
    ]);
    const second = await reserveCredits(sql, {
      teamId: 't',
      actorId: 'u',
      credits: 1,
      key: 'second',
    });
    if (!second.ok) throw new Error('Reservation failed');
    await applyBillingSnapshot(sql, {
      eventId: 'rollover',
      created: 10,
      subscription: snapshot,
    });
    await finishCredits(sql, second.id, false);
    expect((await db.query('SELECT used_credits,spent_cents FROM subscriptions')).rows).toEqual([
      { used_credits: 0, spent_cents: 0 },
    ]);
    await db.close();
  });
  it('chains audit hashes and blocks alteration while allowing account anonymization', async () => {
    const { db, sql } = await fixture();
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', 'test-security-signing-key-at-least-32-characters');
    const input = {
      teamId: 't',
      actorId: 'u',
      action: 'team.update',
      resourceType: 'team',
      resourceId: 't',
      outcome: 'success',
    };
    // Literal outcome stays checked by the public function contract.
    await appendAudit(sql, {
      ...input,
      outcome: 'success',
      after: { managedAccess: true },
    });
    await appendAudit(sql, {
      ...input,
      outcome: 'success',
      after: { managedAccess: false },
    });
    const rows = await db.query<{ hash: string; previous_hash: string }>(
      'SELECT hash,previous_hash FROM audit_events ORDER BY sequence',
    );
    expect(rows.rows[1]?.previous_hash).toBe(rows.rows[0]?.hash);
    await expect(db.exec("UPDATE audit_events SET action = 'forged'")).rejects.toThrow('append only');
    await expect(db.exec('DELETE FROM audit_events')).rejects.toThrow('append only');
    await db.exec("UPDATE audit_events SET actor_id = NULL WHERE actor_id = 'u'");
    await db.close();
    vi.unstubAllEnvs();
  });
});
