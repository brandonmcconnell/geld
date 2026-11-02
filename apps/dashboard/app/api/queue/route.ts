import { connection } from 'next/server';
import {demoEnabled} from '@/lib/env';
import { z } from 'zod';
import { resourceSchema } from '@geld/domain';
import { database } from '@/lib/db';
import { teamMembership } from '@/lib/workspaces';
import { accessAdapter, repoRowSchema, refFor } from '@/lib/team-access';
import type { PullSummary, RepositorySummary } from '@geld/domain';
import { createProviderClient } from '@geld/providers';
import { storedAppUserSource } from '@/lib/repository-apps';
import { enterpriseFetch } from '@/lib/enterprise';
import { currentActor,providerTokenSource } from '@/lib/session';
import { providerClient } from '@/lib/providers';
import { json } from '@/lib/http';
export async function GET(request: Request): Promise<Response> {
  await connection();
  const actor = await currentActor();
  if (!actor) return json({ error: 'Sign in to see your review queue', pulls: [], repositories: [] }, 401);
  const url = new URL(request.url); const requestedTeam=url.searchParams.get('team');const teamId=demoEnabled()&&requestedTeam==='demo-team'?null:requestedTeam;
  let requestedValue:unknown=null;try{requestedValue=JSON.parse(url.searchParams.get('repository')||'null');}catch{return json({error:'Invalid repository filter'},400);}
  const requested = resourceSchema.safeParse(requestedValue);
  if (teamId || requested.success) {
    if (teamId && !await teamMembership(actor.id,teamId)) return json({error:'Team not found',pulls:[],repositories:[]},404);
    const db = database();
    const repos = teamId && db ? z.array(repoRowSchema).parse((await db.query('SELECT * FROM team_repos WHERE team_id=$1 AND approved AND removed_at IS NULL',[teamId])).rows) : [];
    const refs = teamId ? repos.map(refFor).filter(ref=>!requested.success||JSON.stringify(ref)===JSON.stringify(requested.data)) : requested.success ? [requested.data] : [];
    const repositories: RepositorySummary[] = []; const pulls: PullSummary[] = []; let more = false;
    const page=z.coerce.number().int().positive().max(4000).safeParse(url.searchParams.get('cursor')??1);if(!page.success)return json({error:'Invalid queue page'},400);const selected=requested.success?refs:refs.slice((page.data-1)*8,page.data*8);
    for (const ref of selected) {
      const r = await (await accessAdapter(ref.provider,teamId ?? '',ref.owner,undefined,ref.host)).repository(ref);
      if (!r.ok || r.value.permission === 'none') continue;
      repositories.push(r.value); const page = await (await providerClient(ref.provider,ref.host,ref.owner)).pulls(ref,requested.success?url.searchParams.get('cursor'):'1');
      if (page.ok) { pulls.push(...page.value.items); more ||= requested.success&&!!page.value.cursor; }
    }
    return json({pulls,repositories,sources:[{provider:'team',error:null,more:more||!requested.success&&refs.length>page.data*8}]});
  }
  const primary=createProviderClient({provider:'github',source:await providerTokenSource('github',undefined,false,'github.com',true),anonymousReads:true});
  const clients = [demoEnabled()?await providerClient('github'):primary,await providerClient('gitlab'),await providerClient('bitbucket')];
  const db=database();
  const apps=db?z.array(z.object({app_id:z.string(),host:z.string()})).parse((await db.query('SELECT t.app_id,a.host FROM app_user_tokens t JOIN repository_apps a ON a.id=t.app_id WHERE t.user_id=$1 AND (a.host=\'github.com\' OR EXISTS(SELECT 1 FROM enterprise_host_teams h JOIN team_members m ON m.team_id=h.team_id WHERE h.host=a.host AND m.user_id=$1)) LIMIT 20',[actor.id])).rows):[];
  for(const app of apps){const source=await storedAppUserSource(actor.id,undefined,app.host,app.app_id);if(source)clients.push(createProviderClient({provider:'github',host:app.host,source,...(app.host!=='github.com'?{fetch:await enterpriseFetch(app.host)}:{})}));}
  const logicalPage=z.coerce.number().int().positive().max(4000).safeParse(url.searchParams.get('cursor')??1);if(!logicalPage.success)return json({error:'Invalid queue page'},400);
  const apiPage=Math.floor((logicalPage.data-1)/4)+1;const offset=(logicalPage.data-1)%4*8;

  const results = await Promise.all(clients.map(async (client) => {
    const repositories = await client.repositories(String(apiPage));
    if (!repositories.ok) return { provider: client.provider, repositories: [], pulls: [], more: false, error: repositories.reason };
    const selected = repositories.value.items.slice(offset, offset+8);
    const pages = await Promise.all(selected.map((repo) => client.pulls(repo.ref)));
    const pulls: PullSummary[] = [];
    for (const page of pages) if (page.ok) pulls.push(...page.value.items);
    return { provider: client.provider, repositories: repositories.value.items, pulls, more: !!repositories.value.cursor || repositories.value.items.length > offset+8 || pages.some((p) => p.ok && !!p.value.cursor), error: pages.some((p) => !p.ok) ? 'Some repositories could not be loaded' : null };
  }));
  const pulls: PullSummary[] = [...new Map(results.flatMap(result=>result.pulls).map(pull=>[JSON.stringify(pull.ref),pull])).values()];
  const repositories: RepositorySummary[] = [...new Map(results.flatMap(result=>result.repositories).map(repo=>[[repo.ref.provider,repo.ref.host,repo.ref.owner,repo.ref.repo].join('\0'),repo])).values()];
  const hidden=db&&url.searchParams.get('includeHidden')!=='true'?z.array(z.object({provider:z.string(),host:z.string(),external_id:z.string()})).parse((await db.query('SELECT provider,host,external_id FROM repository_visibility WHERE user_id=$1 AND visible=false',[actor.id])).rows):[];
  const visible=repositories.filter(repo=>!hidden.some(row=>row.provider===repo.ref.provider&&row.host===repo.ref.host&&row.external_id===repo.id));const visibleRefs=new Set(visible.map(repo=>[repo.ref.provider,repo.ref.host,repo.ref.owner,repo.ref.repo].join('\0')));
  return json({pulls:pulls.filter(pull=>visibleRefs.has([pull.ref.provider,pull.ref.host,pull.ref.owner,pull.ref.repo].join('\0'))),repositories:visible,sources:results.map(({provider,error,more})=>({provider:provider==='github'?'GitHub':provider==='gitlab'?'GitLab':'Bitbucket',error,more}))});
}
