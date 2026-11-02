import 'server-only';
import { encryptCredential } from './crypto';
import { resourceDigest } from './resource-digest';
import type { SqlExecutor } from './transactions';
/** Minimal encrypted financial reference survives account erasure solely to stop recurring billing. */
export async function queueSubscriptionCancellation(sql: SqlExecutor, subscriptionId: string): Promise<void> {
  const digest = resourceDigest({ cancelSubscription: subscriptionId });
  await sql.query(
    "INSERT INTO outbox_jobs(id,team_id,kind,resource_id,idempotency_key,payload) VALUES($1,NULL,'subscription_cancel',$2,$3,$4) ON CONFLICT DO NOTHING",
    [
      crypto.randomUUID(),
      digest,
      `cancel:${digest}`,
      JSON.stringify({
        encryptedSubscription: await encryptCredential(subscriptionId),
      }),
    ],
  );
}
