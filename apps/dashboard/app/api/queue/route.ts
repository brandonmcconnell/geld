import { connection } from 'next/server';
import { z } from 'zod';
import { resourceSchema } from '@geld/domain';
import { database } from '@/lib/db';
import { teamMembership } from '@/lib/workspaces';
import { accessAdapter, repoRowSchema, refFor } from '@/lib/team-access';
import type { PullSummary, RepositorySummary } from '@geld/domain';
import { currentActor } from '@/lib/session';
import { providerClient } from '@/lib/providers';
import { json } from '@/lib/http';
export async function GET(request: Request): Promise<Response> {
  await connection();
  const actor = await currentActor();
  if (!actor) return json({ error: 'Sign in to see your review queue', pulls: [], repositories: [] }, 401);
  const url = new URL(request.url); const teamId = url.searchParams.get('team');
  let requestedValue:unknown=null;try{requestedValue=JSON.parse(url.searchParams.get('repository')||'null');}catch{return json({error:'Invalid repository filter'},400);}
  const requested = resourceSchema.safeParse(requestedValue);
  if (teamId || requested.success) {
    if (teamId && !await teamMembership(actor.id,teamId)) return json({error:'Team not found',pulls:[],repositories:[]},404);
    const db = database();
    const repos = teamId && db ? z.array(repoRowSchema).parse((await db.query('SELECT * FROM team_repos WHERE team_id=$1 AND approved AND removed_at IS NULL',[teamId])).rows) : [];
    const refs = teamId ? repos.map(refFor).filter(ref=>!requested.success||JSON.stringify(ref)===JSON.stringify(requested.data)) : requested.success ? [requested.data] : [];
    const repositories: RepositorySummary[] = []; const pulls: PullSummary[] = []; let more = false;
    for (const ref of refs.slice(0,50)) {
      const r = await (await accessAdapter(ref.provider,teamId ?? '',ref.owner)).repository(ref);
      if (!r.ok || r.value.permission === 'none') continue;
      repositories.push(r.value); const page = await (await providerClient(ref.provider,ref.host,ref.owner)).pulls(ref,url.searchParams.get('cursor'));
      if (page.ok) { pulls.push(...page.value.items); more ||= !!page.value.cursor; }
    }
    return json({pulls,repositories,sources:[{provider:'team',error:null,more:more||refs.length>50}]});
  }
  const clients = await Promise.all([providerClient('github'), providerClient('gitlab'), providerClient('bitbucket')]);
  const results = await Promise.all(clients.map(async (client) => {
    const repositories = await client.repositories();
    if (!repositories.ok) return { provider: client.provider, repositories: [], pulls: [], more: false, error: repositories.reason };
    const selected = repositories.value.items.slice(0, 8);
    const pages = await Promise.all(selected.map((repo) => client.pulls(repo.ref)));
    const pulls: PullSummary[] = [];
    for (const page of pages) if (page.ok) pulls.push(...page.value.items);
    return { provider: client.provider, repositories: repositories.value.items, pulls, more: !!repositories.value.cursor || repositories.value.items.length > 8 || pages.some((p) => p.ok && !!p.value.cursor), error: pages.some((p) => !p.ok) ? 'Some repositories could not be loaded' : null };
  }));
  const pulls: PullSummary[] = results.flatMap((result) => result.pulls);
  const repositories: RepositorySummary[] = results.flatMap((result) => result.repositories);
  return json({ pulls, repositories, sources: results.map(({ provider, error, more }) => ({ provider, error, more })) });
}
