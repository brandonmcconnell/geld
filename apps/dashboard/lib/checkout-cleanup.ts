import 'server-only';
import { z } from 'zod';
import type { BillingGateway } from './billing-gateway';
import type { SqlExecutor } from './transactions';
import { decryptCredential, encryptCredential } from './crypto';
import { assertTeamOperations } from './team-operation';
import { resourceDigest } from './resource-digest';
const snapshotSchema = z.object({
  id: z.string(),
  teamId: z.string(),
  requestKey: z.string(),
  createdAt: z.iso.datetime(),
  customerId: z.string().nullable(),
  subscriptionId: z.string().nullable(),
});
const payloadSchema = z.object({ encryptedCheckout: z.string() });
export async function queueTeamCheckoutCleanup(sql: SqlExecutor, teamId: string): Promise<void> {
  await assertTeamOperations(sql);
  // Checkout creation takes these locks in the same order. Freeze before reading
  // rows so a concurrent checkout cannot commit between the snapshot and erasure.
  await sql.query('UPDATE teams SET deleting_at=COALESCE(deleting_at,now()) WHERE id=$1', [teamId]);
  await sql.query('SELECT team_id FROM subscriptions WHERE team_id=$1 FOR UPDATE', [teamId]);
  const rows = z
    .array(
      z.object({
        id: z.string(),
        request_key: z.string(),
        created_at: z.date(),
        subscription_id: z.string().nullable(),
        stripe_customer_id: z.string().nullable(),
      }),
    )
    .parse(
      (
        await sql.query(
          "SELECT c.id,c.request_key,c.created_at,c.subscription_id,s.stripe_customer_id FROM billing_checkouts c JOIN subscriptions s ON s.team_id=c.team_id WHERE c.team_id=$1 AND c.state IN('creating','pending','completed') FOR UPDATE OF c",
          [teamId],
        )
      ).rows,
    );
  for (const row of rows) {
    const digest = resourceDigest({ checkout: row.request_key });
    const encryptedCheckout = await encryptCredential(
      JSON.stringify({
        id: row.id,
        teamId,
        requestKey: row.request_key,
        createdAt: row.created_at.toISOString(),
        customerId: row.stripe_customer_id,
        subscriptionId: row.subscription_id,
      }),
    );
    await sql.query(
      "INSERT INTO outbox_jobs(id,team_id,kind,resource_id,idempotency_key,payload) VALUES($1,NULL,'checkout_cleanup',$2,$3,$4) ON CONFLICT DO NOTHING",
      [crypto.randomUUID(), digest, `checkout-cleanup:${digest}`, JSON.stringify({ encryptedCheckout })],
    );
  }
}
export async function cleanupCheckout(
  payload: unknown,
  key: string,
  gateway: Pick<BillingGateway, 'checkoutState' | 'expireCheckout' | 'cancelSubscription' | 'findCheckouts'>,
  now = Date.now(),
): Promise<boolean> {
  const envelope = payloadSchema.parse(payload);
  const text = await decryptCredential(envelope.encryptedCheckout);
  if (!text) return false;
  const snapshot = snapshotSchema.parse(JSON.parse(text));
  if (snapshot.subscriptionId) {
    await gateway.cancelSubscription(snapshot.subscriptionId, `${key}:subscription`);
    return true;
  }
  let ids: readonly string[] = [snapshot.id];
  if (snapshot.id.startsWith('pending:')) {
    if (!gateway.findCheckouts) return false;
    const createdAt = Date.parse(snapshot.createdAt);
    const closesAt = createdAt + 25 * 60 * 60 * 1000;
    const found = await gateway.findCheckouts({
      teamId: snapshot.teamId,
      requestKey: snapshot.requestKey,
      createdAfter: createdAt - 300000,
      createdBefore: closesAt,
      customerId: snapshot.customerId,
    });
    if (!found.complete) return false;
    ids = found.ids;
    if (!ids.length) return now > closesAt;
  }
  for (const id of ids) {
    let state = await gateway.checkoutState(id);
    if (state.teamId !== snapshot.teamId) return false;
    if (state.status === 'open') {
      try {
        await gateway.expireCheckout(id);
      } catch {
        /* Completion can win the race with expiration. */
      }
      state = await gateway.checkoutState(id);
      if (state.teamId !== snapshot.teamId) return false;
    }
    if (state.status === 'open') return false;
    if (state.status === 'complete') {
      if (!state.subscriptionId) return false;
      await gateway.cancelSubscription(state.subscriptionId, `${key}:${id}`);
    }
  }
  return true;
}
