import 'server-only';
import { z } from 'zod';
import { effectivePermission, revocationFor } from '@geld/domain';
import type { Permission, Provider, RepositoryRef } from '@geld/domain';
import { managedAccessAdapter } from '@geld/providers';
import { database, lockDatabase } from './db';
import type { ManagedAccessAdapter } from '@geld/providers';
import { providerTokenSource } from './session';
import { appendAudit } from './audit';
import { transaction, type SqlExecutor } from './transactions';
import { decryptCredential } from './crypto';
export const repoRowSchema = z.object({ id: z.string(), team_id: z.string(), provider: z.enum(['github','gitlab','bitbucket']), host: z.string(), owner: z.string(), name: z.string(), external_id: z.string(), approved: z.boolean(), removed_at: z.date().nullable(), settings: z.record(z.string(),z.unknown()) });
export type TeamRepository = z.infer<typeof repoRowSchema>;
export const refFor = (r: TeamRepository): RepositoryRef => ({ provider: r.provider, host: r.host, owner: r.owner, repo: r.name });
export async function accessAdapter(provider: Provider, teamId: string, owner?: string) {
  const db = database();
  const config = db ? z.object({ settings: z.object({ path: z.enum(['legacy_groups','atlassian_groups','direct_users']).default('direct_users'), organisationId: z.string().optional(), directoryId: z.string().optional() }), encrypted_credential: z.string().nullable() }).safeParse((await db.query('SELECT settings,encrypted_credential FROM provider_connections WHERE team_id = $1 AND provider = $2', [teamId,provider])).rows[0]) : null;
  const key = config?.success && config.data.encrypted_credential ? await decryptCredential(config.data.encrypted_credential) : null;
  return managedAccessAdapter({ provider, source: await providerTokenSource(provider,owner), ...(provider === 'bitbucket' ? { bitbucket: { path: config?.success ? config.data.settings.path : 'direct_users', ...(config?.success && config.data.settings.organisationId ? { organisationId: config.data.settings.organisationId } : {}), ...(config?.success && config.data.settings.directoryId ? { directoryId: config.data.settings.directoryId } : {}), ...(key ? { adminSource: { get: async () => ({ status: 'ok', token: key, refreshed: false }) } } : {}) } } : {}) });
}
export async function providerAdmin(repo: TeamRepository): Promise<boolean> {
  const current = await (await accessAdapter(repo.provider, repo.team_id,repo.owner)).repository(refFor(repo));
  return current.ok && current.value.permission === 'admin';
}
export async function queueGrant(sql: SqlExecutor, repo: TeamRepository, userId: string, actorId: string, source: 'sync'|'request_access'|'audit'): Promise<void> {
  const link = z.object({ external_id: z.string(), login: z.string() }).safeParse((await sql.query('SELECT external_id,login FROM provider_user_links WHERE user_id = $1 AND provider = $2 AND host = $3', [userId,repo.provider,repo.host])).rows[0]);
  if (!link.success) return;
  const id = crypto.randomUUID();
  const created = await sql.query("INSERT INTO grants(id,team_id,repo_id,user_id,provider,provider_user_id,provider_login,mechanism,permission,previous_permission,source,actor_id) VALUES ($1,$2,$3,$4,$5,$6,$7,'collaborator','read','none',$8,$9) ON CONFLICT DO NOTHING RETURNING id", [id,repo.team_id,repo.id,userId,repo.provider,link.data.external_id,link.data.login,source,actorId]);
  if (created.rows.length) await sql.query("INSERT INTO outbox_jobs(id,team_id,kind,resource_id,idempotency_key) VALUES ($1,$2,'grant',$3,$4)", [crypto.randomUUID(),repo.team_id,id,`grant:${id}`]);
}
const grantSchema = z.object({ id: z.string(), team_id: z.string(), repo_id: z.string(), user_id: z.string().nullable(), provider_login: z.string(), provider_user_id: z.string(), provider_grant_id: z.string().nullable(), provider_group_id: z.string().nullable(), mechanism: z.enum(['provider_team','collaborator']), source: z.enum(['sync','request_access','audit']), state: z.enum(['pending','active','revoking','revoked','drifted']), permission: z.enum(['read','triage','write','maintain','admin']), previous_permission: z.enum(['none','read','triage','write','maintain','admin']), actor_id: z.string().nullable(), baseline_captured: z.boolean(), mutation_started: z.boolean(), direct_intent: z.boolean() });
export interface GrantDependencies {
  readonly sql: SqlExecutor;
  readonly run: <T>(work: (sql: SqlExecutor) => Promise<T>) => Promise<T>;
  readonly adapter: (repo: TeamRepository) => Promise<ManagedAccessAdapter>;
}
export async function processGrant(id: string, actorId: string): Promise<boolean> {
  const db = database();
  if (!db) return false;
  const scope = z.object({ team_id: z.string(), provider: z.string(), host: z.string(), owner: z.string(), provider_user_id: z.string() }).safeParse((await db.query('SELECT g.team_id,g.provider,r.host,r.owner,g.provider_user_id FROM grants g JOIN team_repos r ON r.id=g.repo_id WHERE g.id=$1', [id])).rows[0]);
  if (!scope.success) return false;
  const locks = lockDatabase();
  if (!locks) return false;
  const client = await locks.connect();
  const keys = [`grant-team:${scope.data.team_id}`, `grant-user:${JSON.stringify([scope.data.provider,scope.data.host,scope.data.owner,scope.data.provider_user_id])}`];
  const held: string[] = [];
  try {
    for (const key of keys) {
      const lock = z.object({ locked: z.boolean() }).parse((await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked', [key])).rows[0]);
      if (!lock.locked) return false;
      held.push(key);
    }
    return await processGrantRecord(id, actorId, { sql: db, run: work => transaction(db, work), adapter: repo => accessAdapter(repo.provider, repo.team_id, repo.owner) });
  } finally {
    try { for (const key of held.reverse()) await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [key]); }
    finally { client.release(); }
  }
}
export async function processGrantRecord(id: string, actorId: string, dependencies: GrantDependencies): Promise<boolean> {
  const db = dependencies.sql;
  const parsed = grantSchema.safeParse((await db.query('SELECT * FROM grants WHERE id = $1', [id])).rows[0]); if (!parsed.success) return false;
  const g = parsed.data;
  const repo = repoRowSchema.parse((await db.query('SELECT * FROM team_repos WHERE id = $1', [g.repo_id])).rows[0]);
  const adapter = await dependencies.adapter(repo); const ref = refFor(repo);
  const authority = await adapter.repository(ref);
  if (!authority.ok || authority.value.permission !== 'admin') return false;
  const user = await adapter.user(ref,g.provider_login); if (!user.ok || user.value.id !== g.provider_user_id) return false;
  if (g.state === 'revoking') {
    if (g.mechanism === 'provider_team' && g.provider_group_id) {
      await db.query('INSERT INTO provider_group_exclusions(team_id,provider,host,owner,provider_user_id,provider_group_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING', [g.team_id,repo.provider,repo.host,repo.owner,g.provider_user_id,g.provider_group_id]);
      const siblings = z.array(grantSchema).parse((await db.query("SELECT * FROM grants WHERE team_id=$1 AND provider_user_id=$2 AND provider_group_id=$3 AND id<>$4 AND state IN('active','pending')", [g.team_id,g.provider_user_id,g.provider_group_id,g.id])).rows);
      for (const sibling of siblings) {
        const siblingRepo = repoRowSchema.parse((await db.query('SELECT * FROM team_repos WHERE id=$1', [sibling.repo_id])).rows[0]);
        if (siblingRepo.provider !== repo.provider || siblingRepo.host !== repo.host || siblingRepo.owner !== repo.owner) continue;
        const siblingAdapter = await dependencies.adapter(siblingRepo);
        const siblingAuthority = await siblingAdapter.repository(refFor(siblingRepo));
        if (!siblingAuthority.ok || siblingAuthority.value.permission !== 'admin') return false;
        const siblingUser = await siblingAdapter.user(refFor(siblingRepo),sibling.provider_login);
        if (!siblingUser.ok || siblingUser.value.id !== sibling.provider_user_id) return false;
        if (siblingUser.value.permission !== 'none' && siblingUser.value.permission !== sibling.permission) return false;
        await db.query("UPDATE grants SET direct_intent=true,mutation_started=true,baseline_captured=true,mechanism='collaborator',provider_grant_id=$2 WHERE id=$1 AND state IN('active','pending')", [sibling.id,`intent:${sibling.id}`]);
        const written = await siblingAdapter.grant(refFor(siblingRepo), { ...siblingUser.value, permission: 'none' }, sibling.permission);
        if (!written.ok) return false;
        await db.query("UPDATE grants SET direct_intent=false,provider_grant_id=$2,provider_group_id=NULL WHERE id=$1 AND state IN('active','pending')", [sibling.id,written.value]);
      }
    }
    if (!g.provider_grant_id) { await db.query("UPDATE grants SET state='revoked',revoked_at=now() WHERE id=$1",[id]); return true; }
    if (g.mechanism === 'collaborator' && user.value.permission === 'none' && /^\d+$/.test(g.provider_grant_id)) { const r=await adapter.revoke(ref,user.value,g.provider_grant_id); if(r.ok){await db.query("UPDATE grants SET state='revoked',revoked_at=now() WHERE id=$1",[id]);return true;} return false; }
    if (user.value.permission === 'none') {
      const removed = g.mechanism === 'provider_team' && g.provider_group_id ? await adapter.groupMember(ref.owner,g.provider_group_id,user.value,true) : await adapter.revoke(ref,user.value,g.provider_grant_id);
      if (!removed.ok && removed.reason !== 'not_found') return false;
      await db.query("UPDATE grants SET state='revoked',revoked_at=now() WHERE id=$1",[id]); return true;
    }
    const others = z.array(z.object({ permission: z.enum(['read','triage','write','maintain','admin']) })).parse((await db.query("SELECT permission FROM grants WHERE provider = $1 AND provider_user_id = $2 AND repo_id IN (SELECT id FROM team_repos WHERE provider=$1 AND host=$3 AND external_id=$4) AND team_id <> $5 AND state = 'active'", [repo.provider,g.provider_user_id,repo.host,repo.external_id,repo.team_id])).rows);
    const highest = others.reduce<Permission>((best,other) => effectivePermission(best,other.permission) === best ? other.permission : best, 'none');
    const decision = revocationFor({ id:g.id,teamId:g.team_id,userId:g.user_id ?? '',mechanism:g.mechanism,source:g.source,permission:g.permission,previous:g.previous_permission,state:g.state,providerGrantId:g.provider_grant_id },user.value.permission,highest);
    if (decision.action === 'none') { if (decision.reason === 'drifted') await db.query("UPDATE grants SET state='drifted' WHERE id=$1",[id]); return decision.reason === 'already_revoked'; }
    const result = g.mechanism === 'provider_team' && g.provider_group_id
      ? await adapter.groupMember(ref.owner,g.provider_group_id,user.value,true)
      : decision.action === 'remove' ? await adapter.revoke(ref,user.value,g.provider_grant_id ?? undefined) : await adapter.grant(ref,user.value,decision.permission);
    if (!result.ok) return false;
    await dependencies.run(async (sql) => { await sql.query("UPDATE grants SET state='revoked',revoked_at=now() WHERE id=$1",[id]); await appendAudit(sql,{teamId:g.team_id,actorId,action:'access.revoke',resourceType:'grant',resourceId:id,outcome:'success',before:{permission:g.permission},after:{permission:decision.action === 'restore' ? decision.permission : 'none'}}); }); return true;
  }
  if (g.state === 'pending' && g.provider_grant_id && !g.direct_intent && !g.provider_grant_id.startsWith('intent:')) {
    if (user.value.permission === g.permission) { await db.query("UPDATE grants SET state='active' WHERE id=$1",[id]); return true; }
    if (g.mechanism !== 'provider_team') return false;
  }
  if (g.state !== 'pending' || repo.removed_at || !repo.approved) return g.state === 'active';
  if (!g.baseline_captured && user.value.permission !== 'none') { await db.query("UPDATE grants SET state='active',baseline_captured=true,previous_permission=$2,permission=$2 WHERE id=$1",[id,user.value.permission]); return true; }
  if (!g.baseline_captured) await db.query('UPDATE grants SET baseline_captured=true,previous_permission=$2 WHERE id=$1',[id,user.value.permission]);
  if (g.mutation_started && effectivePermission(g.permission,user.value.permission) === g.permission && user.value.permission !== g.permission && user.value.permission !== 'none') { await db.query("UPDATE grants SET state='drifted' WHERE id=$1",[id]); return false; }
  let group: string | null = null;
  const excluded = await db.query('SELECT 1 FROM provider_group_exclusions WHERE team_id=$1 AND provider=$2 AND host=$3 AND owner=$4 AND provider_user_id=$5 LIMIT 1', [g.team_id,repo.provider,repo.host,repo.owner,g.provider_user_id]);
  if (!g.direct_intent && !excluded.rows.length && g.source === 'sync' && user.value.organisationMember) {
    const organisation = await db.query("INSERT INTO provider_orgs(id,provider,host,external_id,slug) VALUES ($1,$2,$3,$4,$4) ON CONFLICT(provider,host,external_id) DO UPDATE SET slug=EXCLUDED.slug RETURNING id",[crypto.randomUUID(),repo.provider,repo.host,ref.owner]);
    const org = z.object({id:z.string()}).parse(organisation.rows[0]);
    await db.query('INSERT INTO team_provider_orgs(team_id,org_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',[g.team_id,org.id]);
    const existing = z.object({external_id:z.string()}).safeParse((await db.query("SELECT external_id FROM provider_teams WHERE team_id=$1 AND org_id=$2 AND state='active'",[g.team_id,org.id])).rows[0]);
    if (existing.success) group=existing.data.external_id;
    else {
      const created = await adapter.createGroup(ref.owner,`geld-${g.team_id.slice(0,8)}`);
      if (created.ok) { group=created.value; await db.query("INSERT INTO provider_teams(id,team_id,org_id,provider,external_id,state) VALUES ($1,$2,$3,$4,$5,'active') ON CONFLICT(team_id,provider,org_id) DO UPDATE SET external_id=EXCLUDED.external_id,state='active'",[crypto.randomUUID(),g.team_id,org.id,repo.provider,group]); }
      else if (created.reason !== 'unsupported') return false;
    }
  }
  let providerGrantId: string | null = null;
  if (group) {
    await db.query("UPDATE grants SET mutation_started=true,provider_grant_id=$2,provider_group_id=$2,mechanism='provider_team' WHERE id=$1",[id,group]);
    const shared = await adapter.share(ref,group,'read'); if (!shared.ok) return false;
    const joined = await adapter.groupMember(ref.owner,group,user.value); if (!joined.ok) return false; providerGrantId=group;
  } else {
    await db.query("UPDATE grants SET mutation_started=true,direct_intent=true,provider_grant_id=$2,mechanism='collaborator' WHERE id=$1",[id,`intent:${id}`]);
    const granted = await adapter.grant(ref,{...user.value,permission:'none'},g.permission); if (!granted.ok) return false; providerGrantId=granted.value; }
  // Verify actual permission, including invitation acceptance, before reporting active.
  const confirmed = await adapter.user(ref,g.provider_login);
  const active = confirmed.ok && confirmed.value.permission !== 'none';
  await dependencies.run(async(sql)=>{await sql.query("UPDATE grants SET state=CASE WHEN state='revoking' THEN state ELSE $2 END,direct_intent=false,provider_grant_id=$3,provider_group_id=$4,mechanism=$5 WHERE id=$1",[id,active?'active':'pending',providerGrantId,group,group?'provider_team':'collaborator']);await appendAudit(sql,{teamId:g.team_id,actorId,action:'access.grant',resourceType:'grant',resourceId:id,outcome:active?'success':'pending',before:{permission:user.value.permission},after:{permission:'read',mechanism:group?'provider_team':'collaborator'}});});
  return active;
}
