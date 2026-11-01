import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ManagedAccessAdapter } from '@geld/providers';
import type { Permission } from '@geld/domain';
vi.mock('server-only', () => ({}));
import { processGrantRecord, queueGrant, repoRowSchema, type GrantDependencies } from './team-access';
beforeEach(() => vi.stubEnv('TOKEN_ENCRYPTION_KEY','test-security-signing-key-at-least-32-characters'));
afterEach(() => vi.unstubAllEnvs());
async function fixture(group = false) {
  const db = new PGlite();
  for (const name of ['0001_auth.sql','0002_dashboard.sql','0003_review.sql','0004_workspaces.sql','0005_access.sql','0006_apps.sql']) await db.exec(await readFile(new URL(`../db/migrations/${name}`, import.meta.url),'utf8'));
  await db.exec("INSERT INTO users(id,name,email) VALUES('admin','Admin','admin@example.test'),('u','User','user@example.test'); INSERT INTO teams(id,name,managed_access,sync_enabled) VALUES('t','Team',true,true); INSERT INTO team_members(team_id,user_id,role) VALUES('t','admin','admin'),('t','u','member'); INSERT INTO team_repos(id,team_id,provider,host,external_id,owner,name) VALUES('a','t','github','github.com','a','org','a'),('b','t','github','github.com','b','org','b'),('c','t','github','github.com','c','org','c'); INSERT INTO provider_orgs(id,provider,host,external_id,slug) VALUES('org','github','github.com','org','org'); INSERT INTO provider_teams(id,team_id,org_id,provider,external_id,state) VALUES('pt','t','org','github','group','active')");
  const direct = new Map<string, Permission>();
  const shared = new Set(group ? ['a','b'] : []);
  let member = group;
  const actions: string[] = [];
  const adapter: ManagedAccessAdapter = {
    repository: async ref => ({ ok: true, value: { id: ref.repo, ref, private: true, permission: 'admin', url: 'https://github.com/org/repo' } }),
    user: async ref => ({ ok: true, value: { id: '42', login: 'user', permission: direct.get(ref.repo) ?? (member && shared.has(ref.repo) ? 'read' : 'none'), organisationMember: true } }),
    collaborators: async () => ({ ok: true, value: { users: [], more: false } }),
    grant: async (ref,_user,permission) => { actions.push(`grant:${ref.repo}`); direct.set(ref.repo,permission); return { ok: true, value: `direct:${ref.repo}` }; },
    revoke: async (ref,_user,id) => { actions.push(`revoke:${ref.repo}:${id}`); direct.delete(ref.repo); return { ok: true, value: undefined }; },
    createGroup: async () => ({ ok: true, value: 'group' }),
    deleteGroup: async () => ({ ok: true, value: undefined }),
    groupMember: async (_org,_group,_user,remove) => { actions.push(remove ? 'leave-group' : 'join-group'); member=!remove; return { ok: true, value: undefined }; },
    share: async ref => { shared.add(ref.repo); return { ok: true, value: undefined }; },
  };
  const run: GrantDependencies['run'] = work => db.transaction(tx => work({ query: (text,values) => tx.query(text,values) }));
  const dependencies: GrantDependencies = { sql: { query: (text,values) => db.query(text,values) }, run, adapter: async () => adapter };
  async function insert(id: string, repo: string, activeGroup = false) {
    await db.query("INSERT INTO grants(id,team_id,repo_id,user_id,provider,provider_user_id,provider_login,mechanism,permission,previous_permission,source,actor_id,state,provider_grant_id,provider_group_id,baseline_captured,mutation_started) VALUES($1,'t',$2,'u','github','42','user',$3,'read','none','sync','admin',$4,$5,$6,$7,$7)", [id,repo,activeGroup?'provider_team':'collaborator',activeGroup?'active':'pending',activeGroup?'group':null,activeGroup?'group':null,activeGroup]);
  }
  return { db, direct, actions, adapter, dependencies, insert };
}
describe('recoverable managed-access writes', () => {
  it('keeps ownership after a provider write succeeds but its final transaction fails', async () => {
    const f = await fixture();
    try {
      await f.insert('g','a');
      await f.db.exec('DELETE FROM provider_teams');
      const directDependencies = { ...f.dependencies, adapter: async () => ({ ...f.adapter, createGroup: async () => ({ ok: false, reason: 'unsupported' } satisfies Awaited<ReturnType<ManagedAccessAdapter['createGroup']>>) }) };
      await expect(processGrantRecord('g','admin',{ ...directDependencies, run: async () => { throw new Error('Lost database write'); } })).rejects.toThrow('Lost database write');
      expect(f.direct.get('a')).toBe('read');
      expect((await f.db.query('SELECT previous_permission,baseline_captured,mutation_started,direct_intent,provider_grant_id FROM grants')).rows).toEqual([{ previous_permission:'none',baseline_captured:true,mutation_started:true,direct_intent:true,provider_grant_id:'intent:g' }]);
      expect(await processGrantRecord('g','admin',directDependencies)).toBe(true);
      expect((await f.db.query('SELECT previous_permission FROM grants')).rows).toEqual([{ previous_permission:'none' }]);
      await f.db.exec("UPDATE grants SET state='revoking'");
      expect(await processGrantRecord('g','admin',directDependencies)).toBe(true);
      expect(f.direct.has('a')).toBe(false);
    } finally { await f.db.close(); }
  });
  it('can withdraw an uncertain direct write before its normal retry', async () => {
    const f = await fixture();
    try {
      await f.insert('g','a');
      await f.db.exec("UPDATE grants SET state='revoking',baseline_captured=true,mutation_started=true,direct_intent=true,provider_grant_id='intent:g'");
      expect(await processGrantRecord('g','admin',f.dependencies)).toBe(true);
      expect(f.actions).toEqual(['revoke:a:intent:g']);
      expect((await f.db.query('SELECT state FROM grants')).rows).toEqual([{ state:'revoked' }]);
    } finally { await f.db.close(); }
  });
  it('preserves another repository through withdrawal and never silently rejoins the shared group', async () => {
    const f = await fixture(true);
    try {
      await f.insert('ga','a',true); await f.insert('gb','b',true);
      await f.db.exec("UPDATE grants SET state='revoking' WHERE id='ga'");
      expect(await processGrantRecord('ga','admin',f.dependencies)).toBe(true);
      expect(f.actions).toEqual(['grant:b','leave-group']);
      expect(await f.adapter.user({provider:'github',host:'github.com',owner:'org',repo:'a'},'user')).toMatchObject({ value:{ permission:'none' } });
      expect(await f.adapter.user({provider:'github',host:'github.com',owner:'org',repo:'b'},'user')).toMatchObject({ value:{ permission:'read' } });
      expect((await f.db.query("SELECT state,mechanism,provider_group_id FROM grants WHERE id='gb'")).rows).toEqual([{state:'active',mechanism:'collaborator',provider_group_id:null}]);
      await f.insert('gc','c');
      expect(await processGrantRecord('gc','admin',f.dependencies)).toBe(true);
      expect(f.actions).toEqual(['grant:b','leave-group','grant:c']);
    } finally { await f.db.close(); }
  });
  it('retries a failed sibling conversion before removing shared membership', async () => {
    const f = await fixture(true);
    try {
      await f.insert('ga','a',true); await f.insert('gb','b',true);
      await f.db.exec("UPDATE grants SET state='revoking' WHERE id='ga'");
      let loseSave=true;
      const sql: GrantDependencies['sql'] = { query: async (text,values) => { if (loseSave && text.includes('SET direct_intent=false')) { loseSave=false; throw new Error('Lost conversion save'); } return f.dependencies.sql.query(text,values); } };
      await expect(processGrantRecord('ga','admin',{...f.dependencies,sql})).rejects.toThrow('Lost conversion save');
      expect(f.actions).toEqual(['grant:b']);
      expect(await processGrantRecord('ga','admin',f.dependencies)).toBe(true);
      expect(f.actions).toEqual(['grant:b','grant:b','leave-group']);
      expect(f.direct.get('b')).toBe('read');
    } finally { await f.db.close(); }
  });
  it('preserves genuinely pre-existing access without claiming it', async () => {
    const f = await fixture();
    try {
      await f.insert('g','a'); f.direct.set('a','write');
      expect(await processGrantRecord('g','admin',f.dependencies)).toBe(true);
      await f.db.exec("UPDATE grants SET state='revoking'");
      expect(await processGrantRecord('g','admin',f.dependencies)).toBe(true);
      expect(f.direct.get('a')).toBe('write'); expect(f.actions).toEqual([]);
    } finally { await f.db.close(); }
  });
});

describe('sync checks for outside accounts',()=>{
  it('requires explicit repository approval before granting an outsider access to a newly synced repository',async()=>{
    const f=await fixture();
    try {
      await f.insert('g','a');
      await f.db.exec("INSERT INTO provider_user_links(user_id,provider,host,external_id,login) VALUES('u','github','github.com','42','user')");
      const adapter:ManagedAccessAdapter={...f.adapter,user:async(ref,login)=>{const current=await f.adapter.user(ref,login);return current.ok?{...current,value:{...current.value,organisationMember:false}}:current;}};
      const dependencies={...f.dependencies,adapter:async()=>adapter};
      expect(await processGrantRecord('g','admin',dependencies)).toBe(true);
      expect(f.actions).toEqual([]);
      expect((await f.db.query('SELECT kind,state FROM access_requests')).rows).toEqual([{kind:'repository_access',state:'pending'}]);
      const repo=repoRowSchema.parse((await f.db.query("SELECT * FROM team_repos WHERE id='a'")).rows[0]);
      await queueGrant(f.dependencies.sql,repo,'u','admin','request_access');
      expect((await f.db.query('SELECT id,source FROM grants')).rows).toEqual([{id:'g',source:'request_access'}]);
      expect(await processGrantRecord('g','admin',dependencies)).toBe(true);
      expect(f.actions).toEqual(['grant:a']);
    } finally {await f.db.close();}
  });
});
