import { z } from 'zod';
import { planFor } from '@geld/domain';
import type { SqlExecutor } from './transactions';
import type { BillingSnapshot } from './billing-gateway';
export async function applyBillingSnapshot(
  sql: SqlExecutor,
  input: {
    readonly eventId: string;
    readonly created: number;
    readonly subscription: BillingSnapshot;
  },
): Promise<boolean> {
  const subscription = input.subscription;
  const team = z
    .object({
      team_id: z.string(),
      stripe_event_created: z.union([z.number(), z.string()]),
      period_start: z.date(),
    })
    .safeParse(
      (
        await sql.query(
          'SELECT team_id,stripe_event_created,period_start FROM subscriptions WHERE stripe_subscription_id = $1 AND stripe_customer_id = $2 FOR UPDATE',
          [subscription.id, subscription.customerId],
        )
      ).rows[0],
    );
  if (!team.success) return false;
  const previous = await sql.query(
    "INSERT INTO billing_events(id,team_id,kind) VALUES ($1,$2,'subscription') ON CONFLICT DO NOTHING RETURNING id",
    [input.eventId, team.data.team_id],
  );
  if (!previous.rows.length || input.created < Number(team.data.stripe_event_created)) return false;
  const reset = new Date(subscription.start * 1000).getTime() > team.data.period_start.getTime();
  const actualSeats = z
    .object({ seats: z.number() })
    .parse(
      (await sql.query('SELECT count(*)::integer AS seats FROM team_members WHERE team_id = $1', [team.data.team_id]))
        .rows[0],
    ).seats;
  await sql.query(
    'UPDATE subscriptions SET tier = $2,status = $3,seats = $4,stripe_item_id = $5,period_start = $6,period_end = $7,card_on_file = $8,stripe_event_created = $9,included_credits = $10,used_credits = CASE WHEN $11 THEN 0 ELSE used_credits END,spent_cents = CASE WHEN $11 THEN 0 ELSE spent_cents END WHERE team_id = $1',
    [
      team.data.team_id,
      subscription.tier,
      subscription.status,
      Math.max(1, actualSeats),
      subscription.itemId,
      new Date(subscription.start * 1000),
      new Date(subscription.end * 1000),
      subscription.card,
      input.created,
      planFor(subscription.tier).creditsPerSeat * Math.max(1, actualSeats),
      reset,
    ],
  );
  if (subscription.itemId && actualSeats !== subscription.seats)
    await sql.query(
      "INSERT INTO outbox_jobs(id,team_id,kind,resource_id,idempotency_key) VALUES ($1,$2,'sync_seats',$2,$3) ON CONFLICT DO NOTHING",
      [crypto.randomUUID(), team.data.team_id, `seats:${team.data.team_id}:${actualSeats}:${input.eventId}`],
    );
  return true;
}
