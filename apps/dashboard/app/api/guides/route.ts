import { readJson } from '@/lib/http';
import { auditedRoute } from '@/lib/request-audit';
import { connection } from 'next/server';
import { z } from 'zod';
import { guideCredits, pullRefSchema } from '@geld/domain';
import { planReview } from '@geld/review/planner';
import { currentActor } from '@/lib/session';
import { json, sameOrigin } from '@/lib/http';
import { database } from '@/lib/db';
import { aiConfigurations, completeConfigured } from '@/lib/ai-config';
import { reserveCredits, finishCredits, creditError } from '@/lib/credits';
import { transaction } from '@/lib/transactions';
import { reviewContext } from '@/lib/review-context';
import { demoEnabled } from '@/lib/env';
import { normalizeReviewPlan } from '@geld/review/plan';
import { providerClient } from '@/lib/providers';
import { contentStore } from '@/lib/content-store';
import { resourceDigest } from '@/lib/resource-digest';
import { authorizeGuidePublication, recordGuidePublication, recoverGuideCredits } from '@/lib/guide-publications';
import { withTeamOperation } from '@/lib/team-operation';
export const maxDuration = 300;
const inputSchema = z.object({
  ref: pullRefSchema,
  teamId: z.string().min(1).max(200).optional(),
  headSha: z.string().min(1),
  previousHeadSha: z.string().optional(),
  key: z.string().uuid(),
  sample: z.boolean().optional(),
});
async function handlePOST(request: Request): Promise<Response> {
  await connection();
  if (!sameOrigin(request)) return json({ error: 'Invalid request origin' }, 403);
  const actor = await currentActor();
  if (!actor) return json({ error: 'Sign in to create a guide' }, 401);
  const value: unknown = await readJson(request);
  const input = inputSchema.safeParse(value);
  if (!input.success) return json({ error: 'Invalid guide request' }, 400);
  try {
    const result = await reviewContext(input.data.ref);
    if (!result.ok) return json({ error: result.reason }, 503);
    const context = result.value;
    if (!context.aiAllowed)
      return json(
        {
          error: 'This repository disables AI processing in its configuration',
        },
        403,
      );
    if (context.pull.headSha !== input.data.headSha)
      return json({ error: 'This pull request changed. Reload it before planning.' }, 409);
    if (demoEnabled() && input.data.sample) {
      return json({
        sample: true,
        plan: normalizeReviewPlan(
          {
            steps: [
              {
                title: 'Keep progress tied to unchanged work',
                kind: 'fix',
                story:
                  'Accepted work stays accepted when the same change appears in the next plan. A changed fingerprint sends the step back for another look. Supporting tests check that unchanged steps keep their state.',
                why: 'New pushes should focus attention on what actually changed.',
                touches: context.files
                  .filter((file) => !file.hidden)
                  .flatMap((file) =>
                    file.hunks.map((_hunk, hunk) => ({
                      path: file.path,
                      hunk,
                    })),
                  ),
                supporting: context.files
                  .filter((file) => file.hidden)
                  .flatMap((file) =>
                    file.hunks.map((_hunk, hunk) => ({
                      path: file.path,
                      hunk,
                    })),
                  ),
                dependsOn: [],
                watch: ['Check what happens when a previously flagged step changes.'],
              },
            ],
          },
          context.files,
          {
            headSha: context.pull.headSha,
            model: 'Sample AI output',
            madeAt: new Date().toISOString(),
          },
        ),
      });
    }
    if (context.pull.state !== 'open') return json({ error: 'Guides are available for open pull requests' }, 409);
    const db = database();
    if (!db) return json({ error: 'Billing is not configured' }, 503);
    const team =
      input.data.teamId ??
      z
        .object({ team_id: z.string() })
        .safeParse(
          (
            await db.query('SELECT team_id FROM team_members WHERE user_id = $1 ORDER BY created_at LIMIT 1', [
              actor.id,
            ])
          ).rows[0],
        ).data?.team_id;
    if (!team)
      return json(
        {
          error: 'Choose a team and a paid plan to create AI guides',
          action: '/settings/billing',
        },
        402,
      );
    const entitlement = await db.query(
      'SELECT r.id FROM team_repos r JOIN team_members m ON m.team_id = r.team_id WHERE r.team_id = $1 AND m.user_id = $2 AND r.provider = $3 AND r.host = $4 AND r.owner = $5 AND r.name = $6 AND r.removed_at IS NULL AND r.approved',
      [team, actor.id, input.data.ref.provider, input.data.ref.host, input.data.ref.owner, input.data.ref.repo],
    );
    if (!entitlement.rows.length)
      return json(
        {
          error: 'Add this repository to the selected team before generating a guide',
        },
        403,
      );
    const configurations = await aiConfigurations(actor.id, team);
    if (!configurations.length)
      return json(
        {
          error: 'Add an AI provider or enable Geld-billed AI to create a guide',
          action: '/settings/providers',
        },
        402,
      );
    const changedLines = context.files.reduce((total, file) => total + file.additions + file.deletions, 0);
    const fingerprint = resourceDigest(input.data.ref);
    const priorGuide = await db.query(
      "SELECT id FROM credit_reservations WHERE team_id = $1 AND resource_fingerprint = $2 AND state = 'settled' AND head_sha <> $3 LIMIT 1",
      [team, fingerprint, context.pull.headSha],
    );
    const credits = guideCredits(changedLines, priorGuide.rows.length > 0);
    const reservation = await transaction(db, (sql) =>
      reserveCredits(sql, {
        teamId: team,
        actorId: actor.id,
        credits,
        key: input.data.key,
      }),
    );
    if (!reservation.ok)
      return json(
        { error: creditError(reservation.reason), action: '/settings/billing' },
        reservation.reason === 'forbidden' ? 403 : reservation.reason === 'duplicate' ? 409 : 402,
      );
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(240000)]);
    let succeeded = false;
    let publishing = false;
    try {
      for (const config of configurations) {
        if (signal.aborted) break;
        const plan = await planReview({
          files: context.files,
          title: context.pull.title,
          body: context.pull.body,
          headSha: context.pull.headSha,
          gateway: {
            apiKey: config.apiKey,
            baseUrl: config.baseUrl,
            model: config.model,
            fetch,
          },
          complete: (options) => completeConfigured(config, { ...options, signal }),
        });
        if (plan.ok) {
          const repository = z.object({ id: z.string() }).parse(entitlement.rows[0]);
          const authority = { teamId: team, repoId: repository.id, actorId: actor.id };
          const published = await withTeamOperation(team, async () => {
            const fresh = await (
              await providerClient(input.data.ref.provider, input.data.ref.host, input.data.ref.owner)
            ).pull(input.data.ref);
            if (!fresh.ok || fresh.value.headSha !== context.pull.headSha || fresh.value.state !== 'open')
              throw new Error('The pull request changed while the guide was planned');
            if (signal.aborted) throw new Error('The guide request was canceled');
            await transaction(db, async (sql) => {
              await recordGuidePublication(sql, {
                ...authority,
                reservationId: reservation.id,
                fingerprint,
                headSha: context.pull.headSha,
              });
              await sql.query('UPDATE credit_reservations SET fallback=$2 WHERE id=$1', [
                reservation.id,
                config.fallback,
              ]);
            });
            publishing = true;
            await contentStore().put({
              ...authority,
              number: input.data.ref.number,
              headSha: context.pull.headSha,
              plan: plan.plan,
              reservationId: reservation.id,
              authorize: (sql) => authorizeGuidePublication(sql, authority),
            });
            succeeded = true;
          });
          if (!published.ok) return json({ error: 'This team is busy. Try creating the guide again.' }, 409);
          return json({ plan: plan.plan, credits });
        }
      }
      return json(
        {
          error: 'Your AI providers could not create a guide. Check provider settings and try again.',
        },
        503,
      );
    } finally {
      if (succeeded || !publishing) await transaction(db, (sql) => finishCredits(sql, reservation.id, succeeded));
      else
        await recoverGuideCredits({
          sql: db,
          run: (work) => transaction(db, work),
          store: contentStore,
          reservationId: reservation.id,
        });
    }
  } catch {
    return json({ error: 'The guide could not be created. Try again.' }, 503);
  }
}

async function readGET(request: Request): Promise<Response> {
  await connection();
  const actor = await currentActor();
  if (!actor) return json({ plan: null }, 401);
  const db = database();
  if (!db) return json({ plan: null }, 503);
  const url = new URL(request.url);
  const query = Object.fromEntries(url.searchParams);
  const ref = pullRefSchema.safeParse({
    ...query,
    number: Number(query.number),
  });
  if (!ref.success) return json({ error: 'Invalid pull request' }, 400);
  const team = url.searchParams.get('teamId');
  if (!team) return json({ plan: null });
  const repo = z
    .object({ id: z.string() })
    .safeParse(
      (
        await db.query(
          'SELECT r.id FROM team_repos r JOIN team_members m ON m.team_id=r.team_id WHERE r.team_id=$1 AND m.user_id=$2 AND r.provider=$3 AND r.host=$4 AND r.owner=$5 AND r.name=$6 AND r.approved AND r.removed_at IS NULL AND EXISTS(SELECT 1 FROM teams t WHERE t.id=r.team_id AND t.deleting_at IS NULL AND t.content_erasing_at IS NULL)',
          [team, actor.id, ref.data.provider, ref.data.host, ref.data.owner, ref.data.repo],
        )
      ).rows[0],
    );
  if (!repo.success) return json({ plan: null }, 403);
  const context = await reviewContext(ref.data);
  if (!context.ok) return json({ plan: null }, 403);
  return json({
    plan: await contentStore().get(team, repo.data.id, ref.data.number, context.value.pull.headSha),
  });
}

export const POST = auditedRoute(handlePOST, 'guides.post');

export const GET = auditedRoute(readGET, 'guides.get');
