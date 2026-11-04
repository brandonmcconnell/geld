import 'server-only';
import { queueTeamCheckoutCleanup } from './checkout-cleanup';
import { queueSubscriptionCancellation } from './subscription-cancellation';
import { assertTeamOperations, operationSql, withTeamOperation } from './team-operation';
import { z } from 'zod';
import { revocationFor, effectivePermission } from '@geld/domain';
import type { Permission } from '@geld/domain';
import { database } from './db';
import { encryptCredential, decryptCredential } from './crypto';
import { transaction } from './transactions';
import { contentStore } from './content-store';
import { accessAdapter, processGrantUnlocked, repoRowSchema, refFor } from './team-access';
import { registrySchema, installationTokenSource } from './repository-apps';
import { backgroundUserTokenSource } from './background-tokens';
const grantSnapshotSchema = z.object({
  id: z.string(),
  team_id: z.string(),
  repo_id: z.string(),
  provider_user_id: z.string(),
  provider_login: z.string(),
  provider_grant_id: z.string(),
  provider_group_id: z.string().nullable(),
  mechanism: z.enum(['provider_team', 'collaborator']),
  source: z.enum(['sync', 'request_access', 'audit']),
  permission: z.enum(['read', 'triage', 'write', 'maintain', 'admin']),
  previous_permission: z.enum(['none', 'read', 'triage', 'write', 'maintain', 'admin']),
});
export const cleanupSchema = z.object({
  grant: grantSnapshotSchema,
  repo: repoRowSchema.extend({ removed_at: z.coerce.date().nullable() }),
  installation: z.object({ external_id: z.string(), registry_id: z.string() }).nullable(),
  adminId: z.string().nullable(),
});
const contentSchema = z.object({ teamId: z.string() });
/** Erasure does not wait indefinitely for an external provider. Only encrypted cleanup references survive, for seven days. */
async function prepareUnlocked(userId: string): Promise<void> {
  const pool = database();
  const db = pool ? operationSql(pool) : null;
  if (!pool || !db) throw new Error('Account storage is unavailable');
  const personal = z
    .array(z.object({ id: z.string() }))
    .parse((await db.query('SELECT id FROM teams WHERE personal_owner_id=$1', [userId])).rows);
  const grants = z
    .array(grantSnapshotSchema)
    .parse(
      (
        await db.query(
          "SELECT g.* FROM grants g WHERE (g.user_id=$1 OR g.team_id IN(SELECT id FROM teams WHERE personal_owner_id=$1)) AND g.state<>'revoked' AND g.provider_grant_id IS NOT NULL AND g.provider_login IS NOT NULL AND g.provider_user_id IS NOT NULL AND g.previous_permission='none'",
          [userId],
        )
      ).rows,
    );
  for (const grant of grants) {
    const repo = repoRowSchema.parse((await db.query('SELECT * FROM team_repos WHERE id=$1', [grant.repo_id])).rows[0]);
    const installation = z
      .object({ external_id: z.string(), registry_id: z.string() })
      .safeParse(
        (
          await db.query(
            "SELECT i.external_id,i.registry_id FROM app_installations i JOIN team_app_installations t ON t.installation_id=i.id WHERE t.team_id=$1 AND i.host=$2 AND i.account_slug=$3 AND i.state='verified'",
            [repo.team_id, repo.host, repo.owner],
          )
        ).rows[0],
      );
    const admin = z
      .object({ user_id: z.string() })
      .safeParse(
        (
          await db.query(
            "SELECT user_id FROM team_members WHERE team_id=$1 AND user_id<>$2 AND role='admin' ORDER BY created_at LIMIT 1",
            [repo.team_id, userId],
          )
        ).rows[0],
      );
    const payload = {
      grant,
      repo,
      installation: installation.success ? installation.data : null,
      adminId: admin.success ? admin.data.user_id : null,
    };
    const cleanupId = crypto.randomUUID();
    await db.query("INSERT INTO erasure_jobs(id,kind,encrypted_payload) VALUES($1,'provider_access',$2)", [
      cleanupId,
      await encryptCredential(JSON.stringify(payload)),
    ]);
    await db.query("UPDATE grants SET state='revoking' WHERE id=$1", [grant.id]);
    // Best effort using the still-valid actor connection. Provider outage cannot prevent account erasure.
    try {
      if (await processGrantUnlocked(grant.id, userId, true))
        await db.query(
          "UPDATE erasure_jobs SET state='completed',encrypted_payload=NULL,completed_at=now() WHERE id=$1",
          [cleanupId],
        );
    } catch {
      /* The bounded cleanup worker retries independently. */
    }
  }
  for (const team of personal) {
    const id = crypto.randomUUID();
    await db.query("INSERT INTO erasure_jobs(id,kind,encrypted_payload) VALUES($1,'content',$2)", [
      id,
      await encryptCredential(JSON.stringify({ teamId: team.id })),
    ]);
    try {
      await contentStore().deleteTeam(team.id);
      await db.query(
        "UPDATE erasure_jobs SET state='completed',encrypted_payload=NULL,completed_at=now() WHERE id=$1",
        [id],
      );
    } catch {
      /* Customer storage may be unavailable. Retry without retaining identity credentials. */
    }
  }
  await transaction(pool, async (sql) => {
    await assertTeamOperations(sql);
    for (const team of personal) await queueTeamCheckoutCleanup(sql, team.id);
    const subscriptions = z
      .array(z.object({ stripe_subscription_id: z.string() }))
      .parse(
        (
          await sql.query(
            'SELECT s.stripe_subscription_id FROM subscriptions s JOIN teams t ON t.id=s.team_id WHERE t.personal_owner_id=$1 AND s.stripe_subscription_id IS NOT NULL',
            [userId],
          )
        ).rows,
      );
    for (const sub of subscriptions) await queueSubscriptionCancellation(sql, sub.stripe_subscription_id);
    const teams = z
      .array(z.object({ team_id: z.string() }))
      .parse((await sql.query('SELECT team_id FROM team_members WHERE user_id=$1', [userId])).rows);
    for (const team of teams) {
      await sql.query(
        'UPDATE subscriptions SET seats=GREATEST(1,(SELECT count(*) FROM team_members WHERE team_id=$1 AND user_id<>$2)) WHERE team_id=$1',
        [team.team_id, userId],
      );
      await sql.query(
        "INSERT INTO outbox_jobs(id,team_id,kind,resource_id,idempotency_key) VALUES($1,$2,'sync_seats',$2,$3)",
        [crypto.randomUUID(), team.team_id, `erasure-seats:${crypto.randomUUID()}`],
      );
    }
    await sql.query(
      'DELETE FROM \"ssoProvider\" WHERE \"providerId\" IN(SELECT t.provider_id FROM team_sso_providers t JOIN teams g ON g.id=t.team_id WHERE g.personal_owner_id=$1)',
      [userId],
    );
    await sql.query('DELETE FROM teams WHERE personal_owner_id=$1', [userId]);
    await sql.query('UPDATE relay_channels SET enabled=false WHERE user_id=$1', [userId]);
    // Shared-team security records retain structural history, with direct personal identifiers removed.
    await sql.query('UPDATE grants SET provider_login=NULL,provider_user_id=NULL WHERE user_id=$1', [userId]);
  });
}
async function cleanupAccess(raw: unknown): Promise<boolean> {
  const input = cleanupSchema.parse(raw);
  const { grant: g, repo: r } = input;
  const pool = database();
  const db = pool ? operationSql(pool) : null;
  if (!db) return false;
  let source = input.adminId ? await backgroundUserTokenSource(input.adminId, r.provider, r.owner, r.host) : null;
  if (r.provider === 'github' && input.installation) {
    const app = registrySchema.safeParse(
      (await db.query('SELECT * FROM repository_apps WHERE id=$1', [input.installation.registry_id])).rows[0],
    );
    if (app.success && app.data.permissions.administration === 'write' && /^\d+$/.test(r.external_id))
      source = await installationTokenSource(app.data, input.installation.external_id, [Number(r.external_id)]);
  }
  if (!source) return false;
  const adapter = await accessAdapter(r.provider, r.team_id, r.owner, source, r.host);
  const ref = refFor(r);
  const user = await adapter.user(ref, g.provider_login);
  if (!user.ok || user.value.id !== g.provider_user_id) return false;
  const others = z
    .array(z.object({ permission: z.enum(['read', 'triage', 'write', 'maintain', 'admin']) }))
    .parse(
      (
        await db.query(
          "SELECT g.permission FROM grants g JOIN team_repos r ON r.id=g.repo_id WHERE r.provider=$1 AND r.host=$2 AND r.external_id=$3 AND g.provider_user_id=$4 AND g.team_id<>$5 AND g.state='active'",
          [r.provider, r.host, r.external_id, g.provider_user_id, g.team_id],
        )
      ).rows,
    );
  const highest = others.reduce<Permission>(
    (best, other) => (effectivePermission(best, other.permission) === best ? other.permission : best),
    'none',
  );
  const decision = revocationFor(
    {
      id: g.id,
      teamId: g.team_id,
      userId: '',
      mechanism: g.mechanism,
      source: g.source,
      permission: g.permission,
      previous: g.previous_permission,
      state: 'revoking',
      providerGrantId: g.provider_grant_id,
    },
    user.value.permission,
    highest,
  );
  if (decision.action === 'none') {
    if (user.value.permission === 'none' && g.mechanism === 'collaborator' && /^\d+$/.test(g.provider_grant_id)) {
      const result = await adapter.revoke(ref, user.value, g.provider_grant_id);
      if (!result.ok) return false;
    } else if (decision.reason !== 'already_revoked') return false;
  } else {
    const result =
      g.mechanism === 'provider_team' && g.provider_group_id
        ? await adapter.groupMember(ref.owner, g.provider_group_id, user.value, true)
        : decision.action === 'remove'
          ? await adapter.revoke(ref, user.value, g.provider_grant_id)
          : await adapter.grant(ref, user.value, decision.permission);
    if (!result.ok) return false;
  }
  await db.query(
    "UPDATE grants SET state='revoked',revoked_at=now(),provider_login=NULL,provider_user_id=NULL WHERE id=$1",
    [g.id],
  );
  return true;
}
export async function drainErasureJobs(): Promise<void> {
  const pool = database();
  const db = pool ? operationSql(pool) : null;
  if (!db) return;
  const rows = z
    .array(z.object({ id: z.string(), kind: z.string(), encrypted_payload: z.string() }))
    .parse(
      (
        await db.query(
          "UPDATE erasure_jobs SET attempts=attempts+1,run_after=now()+interval '5 minutes' WHERE id IN(SELECT id FROM erasure_jobs WHERE state='pending' AND expires_at>now() AND run_after<=now() LIMIT 5 FOR UPDATE SKIP LOCKED) RETURNING id,kind,encrypted_payload",
        )
      ).rows,
    );
  for (const row of rows) {
    let done = false;
    try {
      const text = await decryptCredential(row.encrypted_payload);
      const value: unknown = text ? JSON.parse(text) : null;
      if (row.kind === 'content') {
        await contentStore().deleteTeam(contentSchema.parse(value).teamId);
        done = true;
      } else done = await cleanupAccess(value);
    } catch {
      /* Keep a bounded, encrypted retry. */
    }
    if (done)
      await db.query(
        "UPDATE erasure_jobs SET state='completed',encrypted_payload=NULL,completed_at=now() WHERE id=$1",
        [row.id],
      );
  }
  await db.query(
    "UPDATE erasure_jobs SET state='manual',encrypted_payload=NULL WHERE state='pending' AND expires_at<=now()",
  );
  await db.query("DELETE FROM erasure_jobs WHERE created_at<now()-interval '30 days'");
}

export async function prepareAccountErasure(userId: string): Promise<void> {
  const pool = database();
  const db = pool ? operationSql(pool) : null;
  if (!pool || !db) throw new Error('Account storage is unavailable');
  const teams = z
    .array(z.object({ id: z.string() }))
    .parse(
      (
        await db.query(
          'SELECT id FROM teams WHERE personal_owner_id=$1 UNION SELECT team_id AS id FROM grants WHERE user_id=$1 ORDER BY id',
          [userId],
        )
      ).rows,
    );
  async function lock(index: number): Promise<void> {
    const team = teams[index];
    if (!team) {
      await prepareUnlocked(userId);
      return;
    }
    const result = await withTeamOperation(team.id, () => lock(index + 1));
    if (!result.ok)
      throw new Error('An access update is finishing. Request a new deletion confirmation when it completes.');
  }
  await lock(0);
}
