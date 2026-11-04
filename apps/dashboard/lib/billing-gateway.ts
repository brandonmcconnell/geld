import 'server-only';
import { assertTeamOperations } from './team-operation';
import Stripe from 'stripe';
import { configured, dashboardOrigin } from './env';
import { planFor, type Tier } from '@geld/domain';
export interface BillingSnapshot {
  readonly id: string;
  readonly customerId: string;
  readonly tier: Tier;
  readonly status: string;
  readonly seats: number;
  readonly itemId: string | null;
  readonly start: number;
  readonly end: number;
  readonly card: boolean;
}
export interface CheckoutInput {
  readonly teamId: string;
  readonly tier: 'starter' | 'team' | 'business';
  readonly seats: number;
  readonly customerId: string | null;
  readonly key: string;
  readonly actorId?: string;
  readonly email?: string;
}
export interface CheckoutState {
  readonly status: 'open' | 'complete' | 'expired';
  readonly teamId: string | null;
  readonly url: string | null;
  readonly subscriptionId?: string | null;
}
export interface BillingGateway {
  checkout(input: CheckoutInput): Promise<{ readonly id: string; readonly url: string }>;
  checkoutState(id: string): Promise<CheckoutState>;
  expireCheckout(id: string): Promise<void>;
  findCheckouts?(input: {
    readonly teamId: string;
    readonly requestKey: string;
    readonly createdAfter: number;
    readonly createdBefore: number;
    readonly customerId: string | null;
  }): Promise<{ readonly ids: readonly string[]; readonly complete: boolean }>;
  portal(customerId: string): Promise<string>;
  subscription(id: string): Promise<BillingSnapshot>;
  cancelSubscription(id: string, key: string): Promise<void>;
  updateSeats(itemId: string, seats: number, key: string): Promise<void>;
  overage(customerId: string, subscriptionId: string, cents: number, reservationId: string): Promise<void>;
}
function priceId(tier: Tier): string | null {
  return tier === 'starter'
    ? configured(process.env.STRIPE_PRICE_STARTER)
    : tier === 'team'
      ? configured(process.env.STRIPE_PRICE_TEAM)
      : tier === 'business'
        ? configured(process.env.STRIPE_PRICE_BUSINESS)
        : null;
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
      await assertTeamOperations();
      const price = priceId(input.tier);
      if (!price) throw new Error('This test price is not configured');
      const verifiedPrice = await stripe.prices.retrieve(price);
      if (
        verifiedPrice.livemode ||
        !verifiedPrice.active ||
        verifiedPrice.currency !== 'usd' ||
        verifiedPrice.unit_amount !== planFor(input.tier).centsPerSeat ||
        verifiedPrice.recurring?.interval !== 'month' ||
        verifiedPrice.recurring.interval_count !== 1
      )
        throw new Error('The test price must match this monthly plan');
      const result = await stripe.checkout.sessions.create(
        {
          mode: 'subscription',
          line_items: [{ price, quantity: input.seats }],
          ...(input.customerId ? { customer: input.customerId } : input.email ? { customer_email: input.email } : {}),
          client_reference_id: input.teamId,
          metadata: {
            team_id: input.teamId,
            checkout_key: input.key,
            ...(input.actorId ? { actor_id: input.actorId } : {}),
          },
          subscription_data: { metadata: { team_id: input.teamId } },
          payment_method_collection: 'always',
          success_url: `${dashboardOrigin()}/settings/billing?checkout=complete&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${dashboardOrigin()}/settings/billing?checkout=cancelled`,
        },
        { idempotencyKey: input.key },
      );
      if (!result.url || result.livemode) throw new Error('A test checkout could not be created');
      return { id: result.id, url: result.url };
    },
    async checkoutState(id) {
      const result = await stripe.checkout.sessions.retrieve(id);
      if (result.livemode || !result.status) throw new Error('The test checkout could not be verified');
      return {
        status: result.status,
        teamId: result.metadata?.team_id ?? null,
        url: result.url,
        subscriptionId:
          typeof result.subscription === 'string' ? result.subscription : (result.subscription?.id ?? null),
      };
    },
    async findCheckouts(input) {
      const ids: string[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 100; page++) {
        const result = await stripe.checkout.sessions.list({
          limit: 100,
          created: { gte: Math.floor(input.createdAfter / 1000), lte: Math.floor(input.createdBefore / 1000) },
          ...(input.customerId ? { customer: input.customerId } : {}),
          ...(cursor ? { starting_after: cursor } : {}),
        });
        for (const session of result.data) {
          if (session.livemode) throw new Error('Live billing is disabled');
          if (session.metadata?.team_id === input.teamId && session.metadata.checkout_key === input.requestKey)
            ids.push(session.id);
        }
        if (!result.has_more) return { ids, complete: true };
        cursor = result.data.at(-1)?.id;
        if (!cursor) throw new Error('Checkout pagination changed');
      }
      return { ids, complete: false };
    },
    async expireCheckout(id) {
      await assertTeamOperations();
      const result = await stripe.checkout.sessions.expire(id, {}, { idempotencyKey: `expire:${id}` });
      if (result.livemode || result.status !== 'expired') throw new Error('The test checkout could not be closed');
    },
    async portal(customerId) {
      const result = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${dashboardOrigin()}/settings/billing`,
      });
      return result.url;
    },
    async subscription(id) {
      const subscription = await stripe.subscriptions.retrieve(id);
      if (subscription.livemode) throw new Error('Live subscriptions are not supported');
      const item = subscription.items.data[0];
      const tier: Tier =
        item?.price.id === priceId('starter')
          ? 'starter'
          : item?.price.id === priceId('team')
            ? 'team'
            : item?.price.id === priceId('business')
              ? 'business'
              : 'free';
      const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
      const customer = await stripe.customers.retrieve(customerId);
      const card =
        !!subscription.default_payment_method ||
        (!customer.deleted && !!customer.invoice_settings.default_payment_method);
      return {
        id,
        customerId,
        tier: subscription.status === 'canceled' || subscription.status === 'incomplete_expired' ? 'free' : tier,
        status: subscription.status,
        seats: item?.quantity ?? 1,
        itemId: item?.id ?? null,
        start: item?.current_period_start ?? subscription.billing_cycle_anchor,
        end: item?.current_period_end ?? subscription.billing_cycle_anchor,
        card,
      };
    },
    async cancelSubscription(id, key) {
      await assertTeamOperations();
      const subscription = await stripe.subscriptions.retrieve(id);
      if (subscription.livemode) throw new Error('Live billing is disabled');
      if (subscription.status !== 'canceled')
        await stripe.subscriptions.cancel(id, { invoice_now: false, prorate: false }, { idempotencyKey: key });
    },
    async updateSeats(itemId, seats, key) {
      await assertTeamOperations();
      await stripe.subscriptionItems.update(
        itemId,
        { quantity: seats, proration_behavior: 'create_prorations' },
        { idempotencyKey: key },
      );
    },
    async overage(customerId, subscriptionId, cents, reservationId) {
      await assertTeamOperations();
      await stripe.invoiceItems.create(
        {
          customer: customerId,
          subscription: subscriptionId,
          amount: cents,
          currency: 'usd',
          description: 'Geld AI credit overage',
          metadata: { reservation_id: reservationId },
        },
        { idempotencyKey: `credit:${reservationId}` },
      );
    },
  };
}
