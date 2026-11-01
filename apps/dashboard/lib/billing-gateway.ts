import 'server-only';
import Stripe from 'stripe';
import { configured, dashboardOrigin } from './env';
import { planFor, type Tier } from '@geld/domain';
export interface BillingSnapshot { readonly id: string; readonly customerId: string; readonly tier: Tier; readonly status: string; readonly seats: number; readonly itemId: string | null; readonly start: number; readonly end: number; readonly card: boolean }
export interface BillingGateway {
  checkout(input: { readonly teamId: string; readonly actorId: string; readonly email: string; readonly tier: Tier; readonly seats: number; readonly customerId: string | null; readonly key: string }): Promise<{ readonly id: string; readonly url: string }>;
  portal(customerId: string): Promise<string>;
  subscription(id: string): Promise<BillingSnapshot>;
  updateSeats(itemId: string, seats: number, key: string): Promise<void>;
  overage(customerId: string, subscriptionId: string, cents: number, reservationId: string): Promise<void>;
}
function priceId(tier: Tier): string | null {
  return tier === 'starter' ? configured(process.env.STRIPE_PRICE_STARTER) : tier === 'team' ? configured(process.env.STRIPE_PRICE_TEAM) : tier === 'business' ? configured(process.env.STRIPE_PRICE_BUSINESS) : null;
}
export function testStripe(): Stripe | null {
  const secret = configured(process.env.STRIPE_SECRET_KEY);
  return secret?.startsWith('sk_test_') ? new Stripe(secret, { maxNetworkRetries: 2, timeout: 15000 }) : null;
}
export function billingGateway(): BillingGateway | null {
  const stripe = testStripe();
  if (!stripe) return null;
  return {
    async checkout(input) {
      const price = priceId(input.tier);
      if (!price) throw new Error('This test price is not configured');
      const verifiedPrice = await stripe.prices.retrieve(price);
      if (verifiedPrice.livemode || !verifiedPrice.active || verifiedPrice.currency !== 'usd' || verifiedPrice.unit_amount !== planFor(input.tier).centsPerSeat || verifiedPrice.recurring?.interval !== 'month' || verifiedPrice.recurring.interval_count !== 1) throw new Error('The test price must match this monthly plan');
      const result = await stripe.checkout.sessions.create({ mode: 'subscription', line_items: [{ price, quantity: input.seats }], ...(input.customerId ? { customer: input.customerId } : { customer_email: input.email }), client_reference_id: input.teamId, metadata: { team_id: input.teamId, actor_id: input.actorId }, subscription_data: { metadata: { team_id: input.teamId } }, payment_method_collection: 'always', success_url: `${dashboardOrigin()}/settings/billing?checkout=complete`, cancel_url: `${dashboardOrigin()}/settings/billing?checkout=cancelled` }, { idempotencyKey: input.key });
      if (!result.url || result.livemode) throw new Error('A test checkout could not be created');
      return { id: result.id, url: result.url };
    },
    async portal(customerId) {
      const result = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: `${dashboardOrigin()}/settings/billing` });
      return result.url;
    },
    async subscription(id) {
      const subscription = await stripe.subscriptions.retrieve(id);
      if (subscription.livemode) throw new Error('Live subscriptions are not supported');
      const item = subscription.items.data[0];
      const tier: Tier = item?.price.id === priceId('starter') ? 'starter' : item?.price.id === priceId('team') ? 'team' : item?.price.id === priceId('business') ? 'business' : 'free';
      const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
      const customer = await stripe.customers.retrieve(customerId);
      const card = !!subscription.default_payment_method || (!customer.deleted && !!customer.invoice_settings.default_payment_method);
      return { id, customerId, tier: subscription.status === 'canceled' || subscription.status === 'incomplete_expired' ? 'free' : tier, status: subscription.status, seats: item?.quantity ?? 1, itemId: item?.id ?? null, start: item?.current_period_start ?? subscription.billing_cycle_anchor, end: item?.current_period_end ?? subscription.billing_cycle_anchor, card };
    },
    async updateSeats(itemId, seats, key) { await stripe.subscriptionItems.update(itemId, { quantity: seats, proration_behavior: 'create_prorations' }, { idempotencyKey: key }); },
    async overage(customerId, subscriptionId, cents, reservationId) { await stripe.invoiceItems.create({ customer: customerId, subscription: subscriptionId, amount: cents, currency: 'usd', description: 'Geld AI credit overage', metadata: { reservation_id: reservationId } }, { idempotencyKey: `credit:${reservationId}` }); },
  };
}
