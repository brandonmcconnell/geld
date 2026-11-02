import { z } from 'zod';
import { canSpend } from '@geld/domain';
import type { SqlExecutor } from './transactions';
const subscriptionSchema = z.object({ tier: z.enum(['free','starter','team','business','enterprise']), seats: z.number().int(), used_credits: z.number().int(), cap_cents: z.number().int(), spent_cents: z.number().int(), card_on_file: z.boolean(), status: z.string(), period_start: z.date(), stripe_subscription_id: z.string().nullable(),included_credits:z.number().int(),negotiated_overage_cents:z.number().int().nullable(),contract_verified:z.boolean() });
export type CreditReservation = { readonly ok: true; readonly id: string } | { readonly ok: false; readonly reason: 'upgrade' | 'cap' | 'card' | 'quote' | 'forbidden' | 'duplicate' | 'unavailable' };
export async function reserveCredits(sql: SqlExecutor, input: { readonly teamId: string; readonly actorId: string; readonly credits: number; readonly key: string }): Promise<CreditReservation> {
  const subscription = await sql.query('SELECT s.* FROM subscriptions s JOIN team_members m ON m.team_id = s.team_id WHERE s.team_id = $1 AND m.user_id = $2 AND EXISTS(SELECT 1 FROM teams t WHERE t.id=s.team_id AND t.deleting_at IS NULL) FOR UPDATE OF s', [input.teamId, input.actorId]);
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
export async function finishCredits(sql: SqlExecutor, id: string, success: boolean, fallback?:boolean): Promise<void> {
  const result = await sql.query("UPDATE credit_reservations SET state = $2,fallback=COALESCE($3,fallback),settled_at = CASE WHEN $2='settled' THEN now() ELSE settled_at END WHERE id = $1 AND state = 'reserved' RETURNING team_id,credits,overage_cents,period_start,billing_subscription_id,fallback,settled_at", [id, success ? 'settled' : 'refunded',fallback??null]);
  const reservation = z.object({ team_id: z.string(), credits: z.number().int(), overage_cents: z.number().int(), period_start: z.date().nullable(), billing_subscription_id: z.string().nullable(),fallback:z.boolean(),settled_at:z.date().nullable() }).safeParse(result.rows[0]);
  if (!success && reservation.success) await sql.query('UPDATE subscriptions SET used_credits = GREATEST(0,used_credits-$2), spent_cents = GREATEST(0,spent_cents-$3) WHERE team_id = $1 AND period_start = $4 AND stripe_subscription_id IS NOT DISTINCT FROM $5', [reservation.data.team_id, reservation.data.credits, reservation.data.overage_cents, reservation.data.period_start, reservation.data.billing_subscription_id]);
  if (success && reservation.success && reservation.data.overage_cents > 0) await sql.query("INSERT INTO outbox_jobs(id,team_id,kind,resource_id,idempotency_key) VALUES ($1,$2,'bill_overage',$3,$4) ON CONFLICT DO NOTHING", [crypto.randomUUID(), reservation.data.team_id, id, `bill:${id}`]);
  if(success&&reservation.success&&reservation.data.fallback&&reservation.data.settled_at&&reservation.data.overage_cents>0){
    const team=reservation.data.team_id;
    const first=await sql.query('UPDATE subscriptions SET first_fallback_at=now() WHERE team_id=$1 AND first_fallback_at IS NULL RETURNING team_id',[team]);
    if(first.rows.length)await sql.query("INSERT INTO outbox_jobs(id,team_id,kind,resource_id,idempotency_key) VALUES($1,$2,'fallback_email',$3,$4) ON CONFLICT DO NOTHING",[crypto.randomUUID(),team,id,`fallback:${team}`]);
    const end=new Date(reservation.data.settled_at);end.setUTCHours(0,0,0,0);end.setUTCDate(end.getUTCDate()+7-(end.getUTCDay()+6)%7);const start=new Date(end.getTime()-7*86400000);
    await sql.query("INSERT INTO outbox_jobs(id,team_id,kind,resource_id,idempotency_key,payload,run_after) VALUES($1,$2,'fallback_summary_email',$3,$4,$5,$6) ON CONFLICT DO NOTHING",[crypto.randomUUID(),team,id,`fallback-summary:${team}:${start.toISOString()}`,JSON.stringify({start:start.toISOString(),end:end.toISOString()}),end]);
  }

}

export function creditError(reason:Extract<CreditReservation,{ok:false}>['reason']):string{switch(reason){case'upgrade':return'Choose a paid plan to use AI guides and the assistant.';case'cap':return'This team has reached its spending cap. Ask an admin to increase it.';case'card':return'Included credits are used up. Add a payment method before using overage.';case'quote':return'Contact Geld to configure this Enterprise credit agreement.';case'forbidden':return'You are not a member of the selected billable team.';case'duplicate':return'This request was already attempted. Refresh its result before trying again.';case'unavailable':return'Billing is temporarily unavailable.';}}
