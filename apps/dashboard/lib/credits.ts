import { z } from 'zod';
import { canSpend } from '@geld/domain';
import type { SqlExecutor } from './transactions';
const subscriptionSchema = z.object({ tier: z.enum(['free','starter','team','business','enterprise']), seats: z.number().int(), used_credits: z.number().int(), cap_cents: z.number().int(), spent_cents: z.number().int(), card_on_file: z.boolean(), status: z.string(), period_start: z.date(), stripe_subscription_id: z.string().nullable(),included_credits:z.number().int(),negotiated_overage_cents:z.number().int().nullable(),contract_verified:z.boolean() });
export type CreditReservation = { readonly ok: true; readonly id: string } | { readonly ok: false; readonly reason: 'upgrade' | 'cap' | 'card' | 'quote' | 'forbidden' | 'duplicate' | 'unavailable' };
export async function reserveCredits(sql: SqlExecutor, input: { readonly teamId: string; readonly actorId: string; readonly credits: number; readonly key: string }): Promise<CreditReservation> {
  const subscription = await sql.query('SELECT s.* FROM subscriptions s JOIN team_members m ON m.team_id = s.team_id WHERE s.team_id = $1 AND m.user_id = $2 FOR UPDATE OF s', [input.teamId, input.actorId]);
  if (!subscription.rows.length) return { ok: false, reason: 'forbidden' };
  const parsed = subscriptionSchema.safeParse(subscription.rows[0]);
  if (!parsed.success) return { ok: false, reason: 'unavailable' };
  const s = parsed.data;
  if (!['active','trialing'].includes(s.status)) return { ok: false, reason: 'upgrade' };
  const prior = await sql.query('SELECT id FROM credit_reservations WHERE team_id = $1 AND idempotency_key = $2', [input.teamId, input.key]);
  if (prior.rows.length) return { ok: false, reason: 'duplicate' };
  const decision = canSpend({ tier: s.tier, seats: s.seats, used: s.used_credits, requested: input.credits, capCents: s.cap_cents, spentCents: s.spent_cents, card: s.card_on_file,...(s.tier==='enterprise'&&s.contract_verified&&s.negotiated_overage_cents!==null?{negotiated:{included:s.included_credits,overageCents:s.negotiated_overage_cents}}:{}) });
  if (!decision.allowed) return { ok: false, reason: decision.reason };
  const id = crypto.randomUUID();
  await sql.query('INSERT INTO credit_reservations(id,team_id,actor_id,idempotency_key,credits,overage_cents,period_start,billing_subscription_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [id, input.teamId, input.actorId, input.key, input.credits, decision.overageCents, s.period_start, s.stripe_subscription_id]);
  await sql.query('UPDATE subscriptions SET used_credits = used_credits + $2, spent_cents = spent_cents + $3 WHERE team_id = $1', [input.teamId, input.credits, decision.overageCents]);
  return { ok: true, id };
}
export async function finishCredits(sql: SqlExecutor, id: string, success: boolean): Promise<void> {
  const result = await sql.query("UPDATE credit_reservations SET state = $2,settled_at = CASE WHEN $2='settled' THEN now() ELSE settled_at END WHERE id = $1 AND state = 'reserved' RETURNING team_id,credits,overage_cents,period_start,billing_subscription_id", [id, success ? 'settled' : 'refunded']);
  const reservation = z.object({ team_id: z.string(), credits: z.number().int(), overage_cents: z.number().int(), period_start: z.date().nullable(), billing_subscription_id: z.string().nullable() }).safeParse(result.rows[0]);
  if (!success && reservation.success) await sql.query('UPDATE subscriptions SET used_credits = GREATEST(0,used_credits-$2), spent_cents = GREATEST(0,spent_cents-$3) WHERE team_id = $1 AND period_start = $4 AND stripe_subscription_id IS NOT DISTINCT FROM $5', [reservation.data.team_id, reservation.data.credits, reservation.data.overage_cents, reservation.data.period_start, reservation.data.billing_subscription_id]);
  if (success && reservation.success && reservation.data.overage_cents > 0) await sql.query("INSERT INTO outbox_jobs(id,team_id,kind,resource_id,idempotency_key) VALUES ($1,$2,'bill_overage',$3,$4) ON CONFLICT DO NOTHING", [crypto.randomUUID(), reservation.data.team_id, id, `bill:${id}`]);
}
