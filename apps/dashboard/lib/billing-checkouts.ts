import 'server-only';
import { z } from 'zod';
import type { BillingGateway, CheckoutInput } from './billing-gateway';
import type { SqlExecutor } from './transactions';
import { encryptCredential, decryptCredential } from './crypto';

const paidTier = z.enum(['starter', 'team', 'business']);
const requestSchema = z
  .object({
    teamId: z.string(),
    tier: paidTier,
    seats: z.number().int().positive(),
    customerId: z.string().nullable(),
    key: z.string().uuid(),
  })
  .strict();
const checkoutSchema = z.object({
  id: z.string(),
  team_id: z.string(),
  tier: paidTier,
  state: z.enum(['creating', 'pending', 'completed', 'expired']),
  request_key: z.string(),
  encrypted_request: z.string().nullable(),
  subscription_id: z.string().nullable(),
  created_at: z.date(),
});
const subscriptionSchema = z.object({
  stripe_customer_id: z.string().nullable(),
  stripe_subscription_id: z.string().nullable(),
  status: z.string(),
  seats: z.number().int(),
});
export interface CheckoutDependencies {
  readonly run: <T>(work: (sql: SqlExecutor) => Promise<T>) => Promise<T>;
  readonly gateway: Pick<BillingGateway, 'checkout' | 'checkoutState' | 'expireCheckout'>;
  readonly encrypt?: (value: string) => Promise<string>;
  readonly decrypt?: (value: string) => Promise<string | null>;
  readonly now?: () => number;
}
export type CheckoutResult =
  | { readonly ok: true; readonly id: string; readonly url: string }
  | {
      readonly ok: false;
      readonly reason: 'forbidden' | 'existing' | 'pending' | 'confirming' | 'reconcile' | 'unavailable';
    };
type Preparation =
  | { readonly ok: true; readonly entry: z.infer<typeof checkoutSchema> }
  | { readonly ok: false; readonly reason: 'forbidden' | 'existing' };
export const endedSubscription = (status: string): boolean => status === 'canceled' || status === 'incomplete_expired';

export async function teamCheckout(
  input: { readonly teamId: string; readonly actorId: string; readonly tier: z.infer<typeof paidTier> },
  dependencies: CheckoutDependencies,
): Promise<CheckoutResult> {
  const encrypt = dependencies.encrypt ?? encryptCredential;
  const decrypt = dependencies.decrypt ?? decryptCredential;
  const now = dependencies.now ?? Date.now;
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const prepared = await dependencies.run(async (sql): Promise<Preparation> => {
        const team = await sql.query('SELECT id FROM teams WHERE id=$1 AND deleting_at IS NULL FOR NO KEY UPDATE', [
          input.teamId,
        ]);
        if (!team.rows.length) return { ok: false, reason: 'forbidden' };
        const raw = await sql.query(
          "SELECT s.stripe_customer_id,s.stripe_subscription_id,s.status,(SELECT count(*)::integer FROM team_members m WHERE m.team_id=s.team_id) AS seats FROM subscriptions s WHERE s.team_id=$1 AND EXISTS(SELECT 1 FROM team_members m WHERE m.team_id=s.team_id AND m.user_id=$2 AND m.role='admin') AND EXISTS(SELECT 1 FROM teams t WHERE t.id=s.team_id AND t.deleting_at IS NULL) FOR UPDATE OF s",
          [input.teamId, input.actorId],
        );
        const subscription = subscriptionSchema.safeParse(raw.rows[0]);
        if (!subscription.success) return { ok: false, reason: 'forbidden' };
        if (subscription.data.stripe_subscription_id && !endedSubscription(subscription.data.status))
          return { ok: false, reason: 'existing' };
        const current = await sql.query(
          "SELECT * FROM billing_checkouts WHERE team_id=$1 AND state IN ('creating','pending') FOR UPDATE",
          [input.teamId],
        );
        if (current.rows.length) return { ok: true, entry: checkoutSchema.parse(current.rows[0]) };
        const key = crypto.randomUUID();
        const payload: CheckoutInput = {
          teamId: input.teamId,
          tier: input.tier,
          seats: Math.max(1, subscription.data.seats),
          customerId: subscription.data.stripe_customer_id,
          key,
        };
        const encrypted = await encrypt(JSON.stringify(payload));
        const created = await sql.query(
          "INSERT INTO billing_checkouts(id,team_id,actor_id,tier,state,request_key,encrypted_request) VALUES($1,$2,$3,$4,'creating',$5,$6) RETURNING *",
          [`pending:${key}`, input.teamId, input.actorId, input.tier, key, encrypted],
        );
        return { ok: true, entry: checkoutSchema.parse(created.rows[0]) };
      });
      if (!prepared.ok) return prepared;
      const entry = prepared.entry;
      if (entry.state === 'pending') {
        const state = await dependencies.gateway.checkoutState(entry.id);
        if (state.teamId !== input.teamId) return { ok: false, reason: 'reconcile' };
        if (state.status === 'complete') return { ok: false, reason: 'confirming' };
        if (state.status === 'open' && entry.tier === input.tier)
          return state.url ? { ok: true, id: entry.id, url: state.url } : { ok: false, reason: 'unavailable' };
        if (state.status === 'open') await dependencies.gateway.expireCheckout(entry.id);
        await dependencies.run((sql) =>
          sql.query(
            "UPDATE billing_checkouts SET state='expired',encrypted_request=NULL WHERE id=$1 AND state='pending'",
            [entry.id],
          ),
        );
        continue;
      }
      if (entry.tier !== input.tier) return { ok: false, reason: 'pending' };
      if (now() - entry.created_at.getTime() > 23 * 60 * 60 * 1000) return { ok: false, reason: 'reconcile' };
      const payload = requestSchema.safeParse(JSON.parse((await decrypt(entry.encrypted_request ?? '')) ?? 'null'));
      if (!payload.success || payload.data.key !== entry.request_key || payload.data.teamId !== input.teamId)
        return { ok: false, reason: 'reconcile' };
      const created = await dependencies.gateway.checkout(payload.data);
      const saved = await dependencies.run(async (sql) => {
        await sql.query(
          "UPDATE billing_checkouts SET id=$2,state='pending',encrypted_request=NULL WHERE request_key=$1 AND state='creating'",
          [entry.request_key, created.id],
        );
        const row = z
          .object({ id: z.string(), state: z.string() })
          .safeParse(
            (await sql.query('SELECT id,state FROM billing_checkouts WHERE request_key=$1', [entry.request_key]))
              .rows[0],
          );
        return row.success && row.data.id === created.id && ['pending', 'completed'].includes(row.data.state);
      });
      if (!saved) {
        await dependencies.gateway.expireCheckout(created.id).catch(() => undefined);
        return { ok: false, reason: 'unavailable' };
      }
      return { ok: true, id: created.id, url: created.url };
    }
    return { ok: false, reason: 'pending' };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

export async function bindCheckoutSubscription(
  sql: SqlExecutor,
  input: {
    readonly checkoutId: string;
    readonly requestKey: string | null;
    readonly customerId: string;
    readonly subscriptionId: string;
  },
): Promise<boolean> {
  const candidate = checkoutSchema.safeParse(
    (
      await sql.query("SELECT * FROM billing_checkouts WHERE id=$1 OR (request_key=$2 AND state='creating')", [
        input.checkoutId,
        input.requestKey,
      ])
    ).rows[0],
  );
  if (!candidate.success) return false;
  if (
    !(
      await sql.query('SELECT id FROM teams WHERE id=$1 AND deleting_at IS NULL FOR NO KEY UPDATE', [
        candidate.data.team_id,
      ])
    ).rows.length
  )
    return false;
  const row = z
    .object({ stripe_subscription_id: z.string().nullable(), status: z.string() })
    .safeParse(
      (
        await sql.query(
          'SELECT s.stripe_subscription_id,s.status FROM subscriptions s WHERE s.team_id=$1 AND EXISTS(SELECT 1 FROM teams t WHERE t.id=s.team_id AND t.deleting_at IS NULL) FOR UPDATE OF s',
          [candidate.data.team_id],
        )
      ).rows[0],
    );
  const checkout = checkoutSchema.safeParse(
    (await sql.query('SELECT * FROM billing_checkouts WHERE request_key=$1 FOR UPDATE', [candidate.data.request_key]))
      .rows[0],
  );
  if (!checkout.success || checkout.data.state === 'expired') return false;
  if (checkout.data.state === 'completed') return checkout.data.subscription_id === input.subscriptionId;
  if (
    !row.success ||
    (row.data.stripe_subscription_id &&
      row.data.stripe_subscription_id !== input.subscriptionId &&
      !endedSubscription(row.data.status))
  )
    return false;
  const replacement = row.data.stripe_subscription_id !== input.subscriptionId;
  await sql.query(
    'UPDATE subscriptions SET stripe_customer_id=$2,stripe_subscription_id=$3,stripe_event_created=CASE WHEN $4 THEN 0 ELSE stripe_event_created END,used_credits=CASE WHEN $4 THEN 0 ELSE used_credits END,spent_cents=CASE WHEN $4 THEN 0 ELSE spent_cents END WHERE team_id=$1',
    [checkout.data.team_id, input.customerId, input.subscriptionId, replacement],
  );
  await sql.query(
    "UPDATE billing_checkouts SET id=$2,state='completed',subscription_id=$3,encrypted_request=NULL WHERE request_key=$1",
    [checkout.data.request_key, input.checkoutId, input.subscriptionId],
  );
  return true;
}
