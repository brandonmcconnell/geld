import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { teamCheckout, bindCheckoutSubscription } from './billing-checkouts';
import { cleanupCheckout, queueTeamCheckoutCleanup } from './checkout-cleanup';
beforeEach(() => vi.stubEnv('TOKEN_ENCRYPTION_KEY', 'synthetic-checkout-cleanup-key-at-least-32-characters'));
afterEach(() => vi.unstubAllEnvs());
async function fixture(id: string, state: 'creating' | 'pending', erase = true) {
  const db = new PGlite();
  const directory = new URL('../db/migrations/', import.meta.url);
  for (const name of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort())
    await db.exec(await readFile(new URL(name, directory), 'utf8'));
  await db.exec("INSERT INTO teams(id,name) VALUES('t','Team'); INSERT INTO subscriptions(team_id) VALUES('t')");
  await db.query("INSERT INTO billing_checkouts(id,team_id,tier,state,request_key) VALUES($1,'t','starter',$2,$3)", [
    id,
    state,
    crypto.randomUUID(),
  ]);
  await db.transaction((tx) => queueTeamCheckoutCleanup({ query: (text, values) => tx.query(text, values) }, 't'));
  if (erase) await db.exec("DELETE FROM teams WHERE id='t'");
  const job = (
    await db.query<{ payload: unknown; idempotency_key: string }>('SELECT payload,idempotency_key FROM outbox_jobs')
  ).rows[0];
  if (!job) throw new Error('Cleanup job missing');
  return { db, job };
}
describe('checkout cleanup after erasure', () => {
  it('freezes billing before snapshotting and rejects new checkouts and late completion binding', async () => {
    const f = await fixture('cs_test_freeze', 'pending', false);
    try {
      expect((await f.db.query("SELECT deleting_at IS NOT NULL AS frozen FROM teams WHERE id='t'")).rows).toEqual([
        { frozen: true },
      ]);
      const checkout = vi.fn(async () => ({ id: 'must-not-create', url: 'https://example.test' }));
      const run = <T>(work: (sql: import('./transactions').SqlExecutor) => Promise<T>) =>
        f.db.transaction((tx) => work({ query: (text, values) => tx.query(text, values) }));
      expect(
        await teamCheckout(
          { teamId: 't', actorId: 'u', tier: 'starter' },
          {
            run,
            gateway: {
              checkout,
              checkoutState: async () => ({ status: 'open', teamId: 't', url: null }),
              expireCheckout: async () => undefined,
            },
          },
        ),
      ).toEqual({ ok: false, reason: 'forbidden' });
      expect(checkout).not.toHaveBeenCalled();
      expect(
        await run((sql) =>
          bindCheckoutSubscription(sql, {
            checkoutId: 'cs_test_freeze',
            requestKey: null,
            customerId: 'cus',
            subscriptionId: 'sub',
          }),
        ),
      ).toBe(false);
      expect(
        (await f.db.query("SELECT subscription_id FROM billing_checkouts WHERE id='cs_test_freeze'")).rows,
      ).toEqual([{ subscription_id: null }]);
    } finally {
      await f.db.close();
    }
  });
  it('keeps an encrypted independent job and cancels a subscription when completion wins the expiration race', async () => {
    const f = await fixture('cs_test_pending', 'pending');
    try {
      let completed = false;
      const canceled: string[] = [];
      expect(JSON.stringify(f.job)).not.toContain('cs_test_pending');
      const gateway = {
        checkoutState: async () =>
          ({
            status: completed ? 'complete' : 'open',
            teamId: 't',
            url: null,
            subscriptionId: completed ? 'sub_late' : null,
          }) satisfies Awaited<ReturnType<Parameters<typeof cleanupCheckout>[2]['checkoutState']>>,
        expireCheckout: async () => {
          completed = true;
          throw new Error('Checkout completed during expiration');
        },
        cancelSubscription: async (id: string) => {
          canceled.push(id);
        },
      };
      expect(await cleanupCheckout(f.job.payload, f.job.idempotency_key, gateway)).toBe(true);
      expect(canceled).toEqual(['sub_late']);
    } finally {
      await f.db.close();
    }
  });
  it('reconciles uncertain creation without creating another checkout and waits for the original creation window to close', async () => {
    const f = await fixture(`pending:${crypto.randomUUID()}`, 'creating');
    try {
      const canceled: string[] = [];
      let ids: readonly string[] = [];
      const gateway = {
        findCheckouts: vi.fn(async () => ({ ids, complete: true })),
        checkoutState: async () =>
          ({ status: 'complete', teamId: 't', url: null, subscriptionId: 'sub_recovered' }) satisfies Awaited<
            ReturnType<Parameters<typeof cleanupCheckout>[2]['checkoutState']>
          >,
        expireCheckout: async () => undefined,
        cancelSubscription: async (id: string) => {
          canceled.push(id);
        },
      };
      expect(await cleanupCheckout(f.job.payload, f.job.idempotency_key, gateway)).toBe(false);
      expect(
        await cleanupCheckout(f.job.payload, f.job.idempotency_key, gateway, Date.now() + 26 * 60 * 60 * 1000),
      ).toBe(true);
      ids = ['cs_test_recovered'];
      expect(await cleanupCheckout(f.job.payload, f.job.idempotency_key, gateway)).toBe(true);
      expect(canceled).toEqual(['sub_recovered']);
      expect(gateway.findCheckouts).toHaveBeenCalledTimes(3);
    } finally {
      await f.db.close();
    }
  });
});
