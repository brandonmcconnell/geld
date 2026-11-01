import { connection } from 'next/server';
import { z } from 'zod';
import { currentActor } from '@/lib/session';
import { listTeams, teamMembership } from '@/lib/workspaces';
import { billingGateway } from '@/lib/billing-gateway';
import { database } from '@/lib/db';
import { json, sameOrigin } from '@/lib/http';
import { transaction } from '@/lib/transactions';
import { appendAudit } from '@/lib/audit';
export async function GET(): Promise<Response> {
  await connection();
  const actor = await currentActor();
  if (!actor) return json({ teams: [], configured: false }, 401);
  return json({ teams: await listTeams(actor.id), configured: billingGateway() !== null, testMode: true });
}
const inputSchema = z.object({ teamId: z.string(), action: z.enum(['checkout','portal','cap']), tier: z.enum(['starter','team','business']).optional(), capCents: z.number().int().min(0).max(10000000).optional(), key: z.string().uuid() });
export async function POST(request: Request): Promise<Response> {
  await connection();
  if (!sameOrigin(request)) return json({ error: 'Invalid request origin' }, 403);
  const actor = await currentActor();
  if (!actor) return json({ error: 'Sign in to manage billing' }, 401);
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: 'Invalid billing request' }, 400);
  const input = parsed.data;
  const db = database();
  if (!db || !await teamMembership(actor.id, input.teamId, true)) return json({ error: 'Only team admins can manage billing' }, 403);
  try {
    if (input.action === 'cap' && input.capCents !== undefined) {
      await transaction(db, async (sql) => { await sql.query('UPDATE subscriptions SET cap_cents = $2 WHERE team_id = $1', [input.teamId, input.capCents]); await appendAudit(sql, { teamId: input.teamId, actorId: actor.id, action: 'billing.cap', resourceType: 'subscription', resourceId: input.teamId, outcome: 'success', after: { capCents: input.capCents ?? 0 } }); });
      return json({ saved: true });
    }
    const gateway = billingGateway();
    if (!gateway) return json({ error: 'Stripe test billing is not configured' }, 503);
    const row = z.object({ stripe_customer_id: z.string().nullable(), stripe_subscription_id: z.string().nullable(), seats: z.number() }).parse((await db.query('SELECT s.stripe_customer_id,s.stripe_subscription_id,count(m.user_id)::integer AS seats FROM subscriptions s JOIN team_members m ON m.team_id = s.team_id WHERE s.team_id = $1 GROUP BY s.team_id', [input.teamId])).rows[0]);
    if (input.action === 'portal') return row.stripe_customer_id ? json({ url: await gateway.portal(row.stripe_customer_id) }) : json({ error: 'This team does not have a billing customer yet' }, 409);
    if (!input.tier) return json({ error: 'Choose a plan' }, 400);
    if (row.stripe_subscription_id) return json({ error: 'Use the billing portal to change an existing subscription' }, 409);
    const checkout = await gateway.checkout({ teamId: input.teamId, actorId: actor.id, email: actor.email, tier: input.tier, seats: Math.max(1,row.seats), customerId: row.stripe_customer_id, key: input.key });
    await transaction(db, async (sql) => { await sql.query('INSERT INTO billing_checkouts(id,team_id,actor_id,tier) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [checkout.id,input.teamId,actor.id,input.tier]); await appendAudit(sql, { teamId: input.teamId, actorId: actor.id, action: 'billing.checkout', resourceType: 'subscription', resourceId: input.teamId, outcome: 'pending', after: { tier: input.tier ?? '' } }); });
    return json({ url: checkout.url, testMode: true });
  } catch { return json({ error: 'Billing could not be updated. No live billing is enabled.' }, 503); }
}
