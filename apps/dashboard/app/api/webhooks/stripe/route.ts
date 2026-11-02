import type Stripe from 'stripe';
import { connection } from 'next/server';
import { testStripe, billingGateway } from '@/lib/billing-gateway';
import { configured } from '@/lib/env';
import { database } from '@/lib/db';
import { transaction } from '@/lib/transactions';
import { applyBillingSnapshot } from '@/lib/billing-events';
import { json, readText } from '@/lib/http';
import { bindCheckoutSubscription } from '@/lib/billing-checkouts';
export async function POST(request: Request): Promise<Response> {
  await connection();
  const stripe = testStripe();
  const gateway = billingGateway();
  const secret = configured(process.env.STRIPE_WEBHOOK_SECRET);
  const db = database();
  if (!stripe || !gateway || !secret || !db) return json({ error: 'Test billing webhooks are not configured' }, 503);
  const signature = request.headers.get('stripe-signature');
  if (!signature) return json({ error: 'Missing webhook signature' }, 400);
  const text = await readText(request);
  if (text === null) return json({ error: 'The webhook body is too large or incomplete' }, 413);
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(text, signature, secret);
  } catch {
    return json({ error: 'The webhook signature could not be verified' }, 400);
  }
  try {
    if (event.livemode) return json({ error: 'Live billing events are not accepted' }, 400);
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const customer = typeof session.customer === 'string' ? session.customer : session.customer?.id;
      const subscription = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
      if (!customer || !subscription || session.payment_status !== 'paid') return json({ received: true });
      const snapshot = await gateway.subscription(subscription);
      if (snapshot.customerId !== customer) return json({ error: 'The checkout could not be reconciled' }, 503);
      await transaction(db, async (sql) => {
        const bound = await bindCheckoutSubscription(sql, {
          checkoutId: session.id,
          requestKey: session.metadata?.checkout_key ?? null,
          customerId: customer,
          subscriptionId: subscription,
        });
        if (!bound) throw new Error('The checkout needs reconciliation');
        await applyBillingSnapshot(sql, { eventId: event.id, created: event.created, subscription: snapshot });
      });
    } else if (
      event.type === 'customer.subscription.created' ||
      event.type === 'customer.subscription.updated' ||
      event.type === 'customer.subscription.deleted'
    ) {
      const snapshot = await gateway.subscription(event.data.object.id);
      await transaction(db, (sql) =>
        applyBillingSnapshot(sql, { eventId: event.id, created: event.created, subscription: snapshot }),
      );
    }
    return json({ received: true });
  } catch {
    return json({ error: 'The billing update will be retried' }, 503);
  }
}
