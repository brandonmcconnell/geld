import 'server-only';
import { enterpriseFetch } from './enterprise';
import { z } from 'zod';
import { createApiTransport } from '@geld/github';
import { createProviderClient } from '@geld/providers';
import { githubEndpoints, guideCredits, shouldGenerateGuide } from '@geld/domain';
import { planReview } from '@geld/review/planner';
import { database } from './db';
import { backgroundUserTokenSource } from './background-tokens';
import { registrySchema, installationTokenSource, appTokenSource } from './repository-apps';
import { repoRowSchema, refFor } from './team-access';
import { reviewContext } from './review-context';
import { guidePolicy } from './guide-policy';
import { aiConfigurations, completeConfigured } from './ai-config';
import { reserveCredits, finishCredits } from './credits';
import { transaction } from './transactions';
import { resourceDigest } from './resource-digest';
import { contentStore } from './content-store';
import { recordGuidePublication } from './guide-publications';
import { appendAudit } from './audit';
export const automaticGuideSchema = z.object({
  repoId: z.string(),
  number: z.number().int().positive(),
  headSha: z.string(),
  event: z.enum(['created', 'push', 'force_push']),
});
export async function automaticGuide(
  payload: unknown,
  key: string,
  claim: { readonly id: string; readonly token: string },
): Promise<boolean> {
  const input = automaticGuideSchema.parse(payload);
  const db = database();
  if (!db) return false;
  const repo = repoRowSchema.safeParse(
    (
      await db.query(
        'SELECT * FROM team_repos WHERE id=$1 AND approved AND removed_at IS NULL AND team_id IN(SELECT id FROM teams WHERE deleting_at IS NULL)',
        [input.repoId],
      )
    ).rows[0],
  );
  if (!repo.success) return true;
  const r = repo.data;
  const actor = z
    .object({ user_id: z.string() })
    .safeParse(
      (
        await db.query(
          "SELECT user_id FROM team_members WHERE team_id=$1 AND role='admin' ORDER BY created_at LIMIT 1",
          [r.team_id],
        )
      ).rows[0],
    );
  if (!actor.success) return false;
  const ownSource = await backgroundUserTokenSource(actor.data.user_id, r.provider, r.owner, r.host);
  const ownClient = createProviderClient({
    provider: r.provider,
    source: ownSource,
    host: r.host,
    ...(r.provider === 'github' && r.host !== 'github.com' ? { fetch: await enterpriseFetch(r.host) } : {}),
  });
  const ref = { ...refFor(r), number: input.number };
  const access = await ownClient.pull(ref);
  if (!access.ok) return false;
  let source = ownSource;
  let organisationSource = ownSource;
  let organisationComplete = false;
  if (r.provider === 'github') {
    const installed = z
      .object({ external_id: z.string(), registry_id: z.string() })
      .safeParse(
        (
          await db.query(
            "SELECT i.external_id,i.registry_id FROM app_installations i JOIN team_app_installations t ON t.installation_id=i.id WHERE t.team_id=$1 AND i.provider='github' AND i.host=$2 AND i.account_slug=$3 AND i.state='verified'",
            [r.team_id, r.host, r.owner],
          )
        ).rows[0],
      );
    if (!installed.success) return false;
    const app = registrySchema.parse(
      (await db.query('SELECT * FROM repository_apps WHERE id=$1', [installed.data.registry_id])).rows[0],
    );
    if (!/^\d+$/.test(r.external_id)) return false;
    source = await installationTokenSource(app, installed.data.external_id, [Number(r.external_id)]);
    organisationSource = await installationTokenSource(app, installed.data.external_id);
    const appApi = createApiTransport({
      baseUrl: githubEndpoints(app.host).api,
      source: await appTokenSource(app),
      ...(app.host !== 'github.com' ? { fetch: await enterpriseFetch(app.host) } : {}),
    });
    const scope = await appApi.request(`app/installations/${encodeURIComponent(installed.data.external_id)}`);
    const selection = scope.ok
      ? z
          .object({
            repository_selection: z.enum(['all', 'selected']),
            account: z.object({ login: z.string() }),
            suspended_at: z.string().nullable(),
          })
          .safeParse(scope.value)
      : null;
    if (
      !selection?.success ||
      selection.data.suspended_at ||
      selection.data.account.login.toLowerCase() !== r.owner.toLowerCase()
    )
      return false;
    organisationComplete = selection.data.repository_selection === 'all';
  }
  const context = await reviewContext(ref, {
    client: createProviderClient({
      provider: r.provider,
      source,
      host: r.host,
      ...(r.provider === 'github' && r.host !== 'github.com' ? { fetch: await enterpriseFetch(r.host) } : {}),
    }),
    source,
    userId: actor.data.user_id,
    organisationSource,
    organisationComplete,
  });
  if (!context.ok) return false;
  const c = context.value;
  if (c.pull.headSha !== input.headSha) return true;
  const policy = await guidePolicy(r.id, input.number);
  if (!shouldGenerateGuide(policy, input.event, c.pull.state, c.pull.draft) || !c.aiAllowed) return true;
  if (await contentStore().get(r.team_id, r.id, input.number, c.pull.headSha)) return true;
  const configurations = await aiConfigurations(actor.data.user_id, r.team_id);
  if (!configurations.length) return false;
  const fingerprint = resourceDigest(ref);
  const prior = await db.query(
    "SELECT id FROM credit_reservations WHERE team_id=$1 AND resource_fingerprint=$2 AND head_sha<>$3 AND state='settled' LIMIT 1",
    [r.team_id, fingerprint, c.pull.headSha],
  );
  const credits = guideCredits(
    c.files.reduce((n, f) => n + f.additions + f.deletions, 0),
    prior.rows.length > 0,
  );
  const reservation = await transaction(db, (sql) =>
    reserveCredits(sql, { teamId: r.team_id, actorId: actor.data.user_id, credits, key }),
  );
  if (!reservation.ok) return reservation.reason === 'duplicate';
  const signal = AbortSignal.timeout(120000);
  let success = false;
  let publishing = false;
  try {
    for (const config of configurations) {
      if (signal.aborted) break;
      const plan = await planReview({
        files: c.files,
        title: c.pull.title,
        body: c.pull.body,
        headSha: c.pull.headSha,
        gateway: { apiKey: config.apiKey, baseUrl: config.baseUrl, model: config.model, fetch },
        complete: (options) => completeConfigured(config, { ...options, signal }),
      });
      if (!plan.ok) continue;
      await transaction(db, async (sql) => {
        await recordGuidePublication(sql, {
          reservationId: reservation.id,
          teamId: r.team_id,
          repoId: r.id,
          fingerprint,
          headSha: c.pull.headSha,
          claim,
        });
        await sql.query('UPDATE credit_reservations SET fallback=$2 WHERE id=$1', [reservation.id, config.fallback]);
        await appendAudit(sql, {
          teamId: r.team_id,
          actorId: actor.data.user_id,
          action: 'guide.automatic',
          resourceType: 'repository',
          resourceId: r.id,
          outcome: 'pending',
          after: { credits, event: input.event },
        });
      });
      publishing = true;
      await contentStore().put({
        teamId: r.team_id,
        repoId: r.id,
        number: input.number,
        headSha: c.pull.headSha,
        plan: plan.plan,
        reservationId: reservation.id,
      });
      success = true;
      return true;
    }
    return false;
  } finally {
    if (success || !publishing) await transaction(db, (sql) => finishCredits(sql, reservation.id, success));
  }
}
