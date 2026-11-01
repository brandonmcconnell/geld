import type Stripe from 'stripe';
import { connection } from 'next/server';
import { z } from 'zod';
import { testStripe, billingGateway } from '@/lib/billing-gateway';
import { configured } from '@/lib/env';
import { database } from '@/lib/db';
import { transaction } from '@/lib/transactions';
import { applyBillingSnapshot } from '@/lib/billing-events';
import { json } from '@/lib/http';
export async function POST(request: Request): Promise<Response> {
  await connection();
  const stripe = testStripe(); const gateway = billingGateway(); const secret = configured(process.env.STRIPE_WEBHOOK_SECRET); const db = database();
  if (!stripe || !gateway || !secret || !db) return json({ error: 'Test billing webhooks are not configured' }, 503);
  const signature = request.headers.get('stripe-signature');
  if (!signature) return json({ error: 'Missing webhook signature' }, 400);
  let event: Stripe.Event;
  try { event = await stripe.webhooks.constructEventAsync(await request.text(), signature, secret); } catch { return json({ error: 'The webhook signature could not be verified' }, 400); }
  try {
    if (event.livemode) return json({ error: 'Live billing events are not accepted' }, 400);
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const customer = typeof session.customer === 'string' ? session.customer : session.customer?.id;
      const subscription = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
      if (!customer || !subscription || session.payment_status !== 'paid') return json({ received: true });
      const pending = z.object({ team_id: z.string() }).safeParse((await db.query('SELECT team_id FROM billing_checkouts WHERE id = $1 AND state = \'pending\'', [session.id])).rows[0]);
      if (pending.success) await db.query('UPDATE subscriptions SET stripe_customer_id = $2,stripe_subscription_id = $3 WHERE team_id = $1 AND (stripe_subscription_id IS NULL OR stripe_subscription_id = $3)', [pending.data.team_id,customer,subscription]);
      const snapshot = await gateway.subscription(subscription);
      await transaction(db, async (sql) => { await applyBillingSnapshot(sql, { eventId: event.id, created: event.created, subscription: snapshot }); await sql.query('UPDATE billing_checkouts SET state = \'completed\' WHERE id = $1', [session.id]); });
    } else if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const snapshot = await gateway.subscription(event.data.object.id);
      await transaction(db, (sql) => applyBillingSnapshot(sql, { eventId: event.id, created: event.created, subscription: snapshot }));
    }
    return json({ received: true });
  } catch { return json({ error: 'The billing update will be retried' }, 503); }
}
