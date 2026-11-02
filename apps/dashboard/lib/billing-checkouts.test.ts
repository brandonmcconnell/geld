import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it, vi } from 'vitest';
import type { SqlExecutor } from './transactions';
import type { CheckoutInput, CheckoutState } from './billing-gateway';
vi.mock('server-only', () => ({}));
import { bindCheckoutSubscription, teamCheckout, type CheckoutDependencies } from './billing-checkouts';
import { applyBillingSnapshot } from './billing-events';
import { finishCredits, reserveCredits } from './credits';
const migrations = ['0001_auth.sql', '0002_dashboard.sql', '0003_review.sql', '0004_workspaces.sql','0005_access.sql','0006_apps.sql','0007_automation.sql','0008_trackers.sql','0009_tracker_oauth.sql','0010_enterprise.sql','0011_companion.sql','0012_privacy.sql','0013_access_flows.sql'];
async function fixture() {
  const db = new PGlite();
  for (const name of migrations) await db.exec(await readFile(new URL(`../db/migrations/${name}`, import.meta.url), 'utf8'));
  await db.exec("INSERT INTO users(id,name,email) VALUES('u','One','one@example.test'),('v','Two','two@example.test'); INSERT INTO teams(id,name) VALUES('t','Team'); INSERT INTO team_members(team_id,user_id,role) VALUES('t','u','admin'),('t','v','admin'); INSERT INTO subscriptions(team_id) VALUES('t')");
  const run: CheckoutDependencies['run'] = work => db.transaction(tx => work({ query: (text, values) => tx.query(text, values) }));
  const calls: CheckoutInput[] = [];
  const sessions = new Map<string, { id: string; url: string }>();
  const states = new Map<string, CheckoutState>();
  const expired: string[] = [];
  const gateway: CheckoutDependencies['gateway'] = {
    async checkout(input) {
      calls.push(input);
      const prior = sessions.get(input.key);
      if (prior) return prior;
      const result = { id: `cs_${sessions.size}`, url: `https://checkout.example.test/${sessions.size}` };
      sessions.set(input.key, result);
      states.set(result.id, { status: 'open', teamId: input.teamId, url: result.url });
      return result;
    },
    async checkoutState(id) { const state = states.get(id); if (!state) throw new Error('Unknown checkout'); return state; },
    async expireCheckout(id) { const state = states.get(id); if (!state || state.status !== 'open') throw new Error('Cannot expire'); expired.push(id); states.set(id, { ...state, status: 'expired' }); },
  };
  const dependencies: CheckoutDependencies = { run, gateway, encrypt: async value => `encrypted:${value}`, decrypt: async value => value.slice('encrypted:'.length) };
  return { db, run, calls, sessions, states, expired, gateway, dependencies };
}
const input = { teamId: 't', actorId: 'u', tier: 'starter' } satisfies Parameters<typeof teamCheckout>[0];
describe('durable team checkouts', () => {
  it('shares one provider idempotency key across concurrent admins and rejects a second pending row', async () => {
    const f = await fixture();
    try {
      const results = await Promise.all([teamCheckout(input, f.dependencies), teamCheckout({ ...input, actorId: 'v' }, f.dependencies)]);
      expect(results.every(result => result.ok)).toBe(true);
      expect(f.sessions.size).toBe(1);
      expect(new Set(f.calls.map(call => JSON.stringify(call))).size).toBe(1);
      expect(f.calls[0]?.seats).toBe(2);
      await expect(f.db.exec("INSERT INTO billing_checkouts(id,team_id,tier) VALUES('other','t','team')")).rejects.toThrow('billing_checkouts_one_pending');
      expect(await teamCheckout({ ...input, actorId: 'outsider' }, f.dependencies)).toEqual({ ok: false, reason: 'forbidden' });
    } finally { await f.db.close(); }
  });
  it('retries the immutable request after losing the provider response and refuses unsafe late retries', async () => {
    const f = await fixture();
    try {
      let lost = true;
      const gateway = { ...f.gateway, checkout: async (request: CheckoutInput) => { const result = await f.gateway.checkout(request); if (lost) { lost = false; throw new Error('Connection lost after creation'); } return result; } };
      expect(await teamCheckout(input, { ...f.dependencies, gateway })).toEqual({ ok: false, reason: 'unavailable' });
      await f.db.exec("UPDATE subscriptions SET seats=9; DELETE FROM team_members WHERE user_id='v'");
      expect((await teamCheckout(input, f.dependencies)).ok).toBe(true);
      expect(f.sessions.size).toBe(1);
      expect(f.calls[0]).toEqual(f.calls[1]);
      await f.db.exec("UPDATE billing_checkouts SET state='creating',created_at=now()-interval '24 hours'");
      expect(await teamCheckout(input, f.dependencies)).toEqual({ ok: false, reason: 'reconcile' });
      expect(f.calls).toHaveLength(2);
    } finally { await f.db.close(); }
  });
  it('reuses an open checkout, expires it before switching plans, and waits for completed checkout webhooks', async () => {
    const f = await fixture();
    try {
      const first = await teamCheckout(input, f.dependencies);
      expect(await teamCheckout(input, f.dependencies)).toEqual(first);
      expect(f.calls).toHaveLength(1);
      const next = await teamCheckout({ ...input, tier: 'team' }, f.dependencies);
      expect(next.ok).toBe(true);
      expect(f.expired).toEqual(['cs_0']);
      f.states.set('cs_1', { status: 'complete', teamId: 't', url: null });
      expect(await teamCheckout(input, f.dependencies)).toEqual({ ok: false, reason: 'confirming' });
      expect(f.sessions.size).toBe(2);
    } finally { await f.db.close(); }
  });
  it('binds a webhook that arrives before saving the checkout response', async () => {
    const f = await fixture();
    try {
      const gateway = { ...f.gateway, checkout: async (request: CheckoutInput) => {
        const result = await f.gateway.checkout(request);
        expect(await f.run(sql => bindCheckoutSubscription(sql, { checkoutId: result.id, requestKey: request.key, customerId: 'cus', subscriptionId: 'sub' }))).toBe(true);
        return result;
      } };
      expect((await teamCheckout(input, { ...f.dependencies, gateway })).ok).toBe(true);
      expect((await f.db.query('SELECT id,state,encrypted_request FROM billing_checkouts')).rows).toEqual([{ id: 'cs_0', state: 'completed', encrypted_request: null }]);
    } finally { await f.db.close(); }
  });
  it.each(['canceled', 'incomplete_expired'])('replaces a %s subscription without letting old events rebind or refund it', async status => {
    const f = await fixture();
    try {
      await f.db.query("UPDATE subscriptions SET stripe_customer_id='cus',stripe_subscription_id='old',status=$1,tier='starter',period_start='2026-11-01',used_credits=8", [status]);
      await f.db.exec("INSERT INTO billing_checkouts(id,team_id,tier,state,subscription_id) VALUES('old_checkout','t','starter','completed','old'); INSERT INTO credit_reservations(id,team_id,actor_id,idempotency_key,credits,overage_cents,period_start,billing_subscription_id) VALUES('old_credit','t','u','old_key',5,0,'2026-11-01','old')");
      expect((await teamCheckout(input, f.dependencies)).ok).toBe(true);
      expect(await f.run(sql => bindCheckoutSubscription(sql, { checkoutId: 'cs_0', requestKey: null, customerId: 'cus', subscriptionId: 'new' }))).toBe(true);
      await f.db.exec("UPDATE subscriptions SET status='active',used_credits=2");
      expect(await f.run(sql => bindCheckoutSubscription(sql, { checkoutId: 'old_checkout', requestKey: null, customerId: 'cus', subscriptionId: 'old' }))).toBe(true);
      expect(await f.run(sql => applyBillingSnapshot(sql, { eventId: 'old_event', created: 99, subscription: { id: 'old', customerId: 'cus', tier: 'free', status: 'canceled', seats: 2, itemId: null, start: Date.parse('2026-11-01') / 1000, end: Date.parse('2026-12-01') / 1000, card: false } }))).toBe(false);
      await f.run(sql => finishCredits(sql, 'old_credit', false));
      expect((await f.db.query('SELECT stripe_subscription_id,status,used_credits FROM subscriptions')).rows).toEqual([{ stripe_subscription_id: 'new', status: 'active', used_credits: 2 }]);
      expect(await teamCheckout(input, f.dependencies)).toEqual({ ok: false, reason: 'existing' });
    } finally { await f.db.close(); }
  });
});
describe('legacy credit reservation migration', () => {
  it('backfills current-period reservations and refunds them only once', async () => {
    const db = new PGlite();
    try {
      for (const name of migrations.slice(0, 3)) await db.exec(await readFile(new URL(`../db/migrations/${name}`, import.meta.url), 'utf8'));
      await db.exec("INSERT INTO users(id,name,email) VALUES('u','One','one@example.test'); INSERT INTO teams(id,name) VALUES('t','Team'); INSERT INTO team_members(team_id,user_id,role) VALUES('t','u','admin'); INSERT INTO subscriptions(team_id,tier,used_credits,spent_cents,cap_cents,card_on_file,stripe_subscription_id) VALUES('t','starter',41,25,100,true,'sub'); INSERT INTO credit_reservations(id,team_id,actor_id,idempotency_key,credits,overage_cents) VALUES('legacy','t','u','legacy_key',2,25)");
      await db.exec(await readFile(new URL('../db/migrations/0004_workspaces.sql', import.meta.url), 'utf8'));
      for(const name of ['0005_access.sql','0006_apps.sql','0007_automation.sql','0008_trackers.sql','0009_tracker_oauth.sql','0010_enterprise.sql','0011_companion.sql','0012_privacy.sql','0013_access_flows.sql'])await db.exec(await readFile(new URL(`../db/migrations/${name}`,import.meta.url),'utf8'));
      const sql: SqlExecutor = { query: (text, values) => db.query(text, values) };
      await finishCredits(sql, 'legacy', false);
      await finishCredits(sql, 'legacy', false);
      expect((await db.query('SELECT used_credits,spent_cents FROM subscriptions')).rows).toEqual([{ used_credits: 39, spent_cents: 0 }]);
      expect((await reserveCredits(sql, { teamId: 't', actorId: 'u', credits: 1, key: 'next' })).ok).toBe(true);
    } finally { await db.close(); }
  });
});
