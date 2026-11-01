import { connection } from 'next/server';
import { z } from 'zod';
import { resourceSchema } from '@geld/domain';
import type { ProviderClient, PullSummary, RepositoryRef, RepositorySummary } from '@geld/domain';
import { createProviderClient } from '@geld/providers';
import { demoEnabled } from '@/lib/env';
import { database } from '@/lib/db';
import { teamMembership } from '@/lib/workspaces';
import { accessAdapter, repoRowSchema, refFor } from '@/lib/team-access';
import { storedAppUserSource } from '@/lib/repository-apps';
import { enterpriseFetch } from '@/lib/enterprise';
import { currentActor, providerTokenSource } from '@/lib/session';
import { providerClient } from '@/lib/providers';
import { json } from '@/lib/http';
import { auditedRoute } from '@/lib/request-audit';
import { readQueueCursor, nextQueueCursor } from '@/lib/queue-cursor';
const key = (ref: RepositoryRef) =>
  [
    ref.provider,
    ref.host,
    ref.provider === 'github' ? ref.owner.toLowerCase() : ref.owner,
    ref.provider === 'github' ? ref.repo.toLowerCase() : ref.repo,
  ].join('\0');
function connectionError(reason: string): string | null {
  return reason === 'signed_out'
    ? null
    : reason === 'permission'
      ? 'Review this connection’s repository permissions.'
      : reason === 'rate_limit'
        ? 'This provider has temporarily limited requests. Try again later.'
        : 'This provider could not load its repositories. Reconnect or try again.';
}
async function readGET(request: Request): Promise<Response> {
  await connection();
  const actor = await currentActor();
  if (!actor)
    return json(
      {
        error: 'Sign in to see your review queue',
        pulls: [],
        repositories: [],
      },
      401,
    );
  const url = new URL(request.url);
  const requestedTeam = url.searchParams.get('team');
  const teamId = demoEnabled() && requestedTeam === 'demo-team' ? null : requestedTeam;
  const db = database();
  const cursorRaw = url.searchParams.get('cursor');
  let requestedValue: unknown = null;
  try {
    requestedValue = JSON.parse(url.searchParams.get('repository') || 'null');
  } catch {
    return json({ error: 'Invalid repository filter' }, 400);
  }
  const requested = resourceSchema.safeParse(requestedValue);
  if (requestedValue !== null && !requested.success) return json({ error: 'Invalid repository filter' }, 400);
  if (teamId || requested.success) {
    if (teamId && !(await teamMembership(actor.id, teamId)))
      return json({ error: 'Team not found', pulls: [], repositories: [] }, 404);
    const repos =
      teamId && db
        ? z
            .array(repoRowSchema)
            .parse(
              (
                await db.query(
                  'SELECT * FROM team_repos WHERE team_id=$1 AND approved AND removed_at IS NULL ORDER BY owner,name,id',
                  [teamId],
                )
              ).rows,
            )
        : [];
    const refs = teamId
      ? repos.map(refFor).filter((ref) => !requested.success || key(ref) === key(requested.data))
      : requested.success
        ? [requested.data]
        : [];
    const cursor = readQueueCursor(cursorRaw, 'team');
    const directPage = z.coerce
      .number()
      .int()
      .positive()
      .max(4000)
      .safeParse(cursorRaw ?? 1);
    if (requested.success ? !directPage.success : !cursor) return json({ error: 'Invalid queue page' }, 400);
    const selected = requested.success ? refs : cursor ? refs.slice(cursor.batch * 8, (cursor.batch + 1) * 8) : [];
    const repositories: RepositorySummary[] = [];
    const pulls: PullSummary[] = [];
    let morePulls = false;
    let failed = false;
    for (const ref of selected) {
      const repo = await (
        await accessAdapter(ref.provider, teamId ?? '', ref.owner, undefined, ref.host)
      ).repository(ref);
      if (!repo.ok || repo.value.permission === 'none') continue;
      repositories.push(repo.value);
      const page = await (
        await providerClient(ref.provider, ref.host, ref.owner)
      ).pulls(ref, String(requested.success && directPage.success ? directPage.data : (cursor?.pullPage ?? 1)));
      if (page.ok) {
        pulls.push(...page.value.items);
        morePulls ||= !!page.value.cursor;
      } else failed = true;
    }
    const next = requested.success
      ? morePulls && directPage.success
        ? String(directPage.data + 1)
        : null
      : cursor
        ? nextQueueCursor(cursor, morePulls, refs.length > (cursor.batch + 1) * 8)
        : null;
    return json({
      pulls,
      repositories,
      nextCursor: next,
      sources: [
        {
          provider: requested.success ? 'Repository' : 'Team repositories',
          error: failed ? 'Some pull requests could not be loaded. Open the repository or try again.' : null,
          more: !!next,
        },
      ],
    });
  }
  const clients: { client: ProviderClient; label: string }[] = [];
  for (const provider of ['github', 'gitlab', 'bitbucket'] satisfies ('github' | 'gitlab' | 'bitbucket')[]) {
    clients.push({
      client: demoEnabled()
        ? await providerClient(provider)
        : createProviderClient({
            provider,
            source: await providerTokenSource(
              provider,
              undefined,
              false,
              provider === 'github' ? 'github.com' : provider === 'gitlab' ? 'gitlab.com' : 'bitbucket.org',
              provider === 'github',
            ),
          }),
      label: provider === 'github' ? 'GitHub' : provider === 'gitlab' ? 'GitLab' : 'Bitbucket',
    });
  }
  const apps = db
    ? z
        .array(z.object({ app_id: z.string(), host: z.string(), slug: z.string() }))
        .parse(
          (
            await db.query(
              "SELECT t.app_id,a.host,a.slug FROM app_user_tokens t JOIN repository_apps a ON a.id=t.app_id WHERE t.user_id=$1 AND(a.host='github.com' OR EXISTS(SELECT 1 FROM enterprise_host_teams h JOIN team_members m ON m.team_id=h.team_id WHERE h.host=a.host AND m.user_id=$1)) ORDER BY a.host,a.slug LIMIT 21",
              [actor.id],
            )
          ).rows,
        )
    : [];
  for (const app of apps.slice(0, 20)) {
    const source = await storedAppUserSource(actor.id, undefined, app.host, app.app_id);
    if (source)
      clients.push({
        client: createProviderClient({
          provider: 'github',
          host: app.host,
          source,
          ...(app.host !== 'github.com' ? { fetch: await enterpriseFetch(app.host) } : {}),
        }),
        label: app.host === 'github.com' ? `GitHub · ${app.slug}` : `GitHub Enterprise · ${app.host} · ${app.slug}`,
      });
  }
  const onlyRepositories = url.searchParams.get('repositoriesOnly') === 'true';
  const page = z.coerce
    .number()
    .int()
    .positive()
    .max(4000)
    .safeParse(cursorRaw ?? 1);
  const cursor = readQueueCursor(cursorRaw, 'personal');
  if (onlyRepositories ? !page.success : !cursor) return json({ error: 'Invalid queue page' }, 400);
  const apiPage = onlyRepositories && page.success ? page.data : Math.floor((cursor?.batch ?? 0) / 4) + 1;
  const offset = onlyRepositories ? 0 : ((cursor?.batch ?? 0) % 4) * 8;
  const hidden =
    db && url.searchParams.get('includeHidden') !== 'true'
      ? z
          .array(
            z.object({
              provider: z.string(),
              host: z.string(),
              external_id: z.string(),
            }),
          )
          .parse(
            (
              await db.query(
                'SELECT provider,host,external_id FROM repository_visibility WHERE user_id=$1 AND visible=false',
                [actor.id],
              )
            ).rows,
          )
      : [];
  const visible = (repo: RepositorySummary) =>
    !hidden.some(
      (row) => row.provider === repo.ref.provider && row.host === repo.ref.host && row.external_id === repo.id,
    );
  const results = await Promise.all(
    clients.map(async ({ client, label }) => {
      const repos = await client.repositories(String(apiPage));
      if (!repos.ok)
        return {
          label,
          repositories: [],
          pulls: [],
          morePulls: false,
          moreRepos: false,
          error: connectionError(repos.reason),
        };
      const selected = repos.value.items.slice(offset, offset + 8).filter(visible);
      const pages = onlyRepositories
        ? []
        : await Promise.all(selected.map((repo) => client.pulls(repo.ref, String(cursor?.pullPage ?? 1))));
      return {
        label,
        repositories: repos.value.items.filter(visible),
        pulls: pages.flatMap((page) => (page.ok ? page.value.items : [])),
        morePulls: pages.some((page) => page.ok && !!page.value.cursor),
        moreRepos: !!repos.value.cursor || (!onlyRepositories && repos.value.items.length > offset + 8),
        error: pages.some((page) => !page.ok)
          ? 'Some pull requests could not be loaded. Open the repository or try again.'
          : null,
      };
    }),
  );
  const morePulls = results.some((result) => result.morePulls);
  const moreRepos = results.some((result) => result.moreRepos);
  const next = onlyRepositories
    ? moreRepos && page.success
      ? String(page.data + 1)
      : null
    : cursor
      ? nextQueueCursor(cursor, morePulls, moreRepos)
      : null;
  const pulls = [
    ...new Map(
      results.flatMap((result) => result.pulls).map((pull) => [`${key(pull.ref)}:${pull.ref.number}`, pull]),
    ).values(),
  ];
  const repositories = [
    ...new Map(results.flatMap((result) => result.repositories).map((repo) => [key(repo.ref), repo])).values(),
  ];
  return json({
    pulls,
    repositories,
    nextCursor: next,
    sources: [
      ...results.map((result) => ({
        provider: result.label,
        error: result.error,
        more: !!next && (result.morePulls || result.moreRepos),
      })),
      ...(apps.length > 20
        ? [
            {
              provider: 'Additional connections',
              error:
                'This queue loads up to 20 repository App connections. Open a team or repository to review an additional connection.',
              more: false,
            },
          ]
        : []),
    ],
  });
}
export const GET = auditedRoute(readGET, 'queue.get');
