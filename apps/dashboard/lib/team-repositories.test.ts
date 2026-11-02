import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import type { SqlExecutor } from './transactions';
vi.mock('server-only',()=>({}));
import { addTeamRepository,approveTeamRepository } from './team-repositories';
import { claimAccessJobs,finishAccessJob } from './access-jobs';
import { changeBitbucketConnection } from './provider-connections';
beforeEach(()=>vi.stubEnv('TOKEN_ENCRYPTION_KEY','test-security-signing-key-at-least-32-characters'));
afterEach(()=>vi.unstubAllEnvs());
async function fixture() {
  const db=new PGlite();
  for(const name of ['0001_auth.sql','0002_dashboard.sql','0003_review.sql','0004_workspaces.sql','0005_access.sql','0006_apps.sql','0007_automation.sql','0008_trackers.sql','0009_tracker_oauth.sql','0010_enterprise.sql','0011_companion.sql','0012_privacy.sql','0013_access_flows.sql'])await db.exec(await readFile(new URL(`../db/migrations/${name}`,import.meta.url),'utf8'));
  await db.exec("INSERT INTO users(id,name,email) VALUES('a','Admin','admin@example.test'),('m','Member','member@example.test'); INSERT INTO teams(id,name,managed_access,sync_enabled,add_approval) VALUES('t','Team',true,true,true); INSERT INTO team_members(team_id,user_id,role) VALUES('t','a','admin'),('t','m','member'); INSERT INTO subscriptions(team_id,tier) VALUES('t','starter'); INSERT INTO provider_user_links(user_id,provider,host,external_id,login) VALUES('a','github','github.com','1','admin'),('m','github','github.com','2','member')");
  const sql:SqlExecutor={query:(text,values)=>db.query(text,values)};
  const run=<T>(work:(sql:SqlExecutor)=>Promise<T>)=>db.transaction(tx=>work({query:(text,values)=>tx.query(text,values)}));
  return {db,sql,run};
}
const ref={provider:'github',host:'github.com',owner:'org',repo:'new'} satisfies Parameters<typeof addTeamRepository>[1]['ref'];
describe('repository admission and sync',()=>{
  it('serializes concurrent additions at the plan limit and queues existing members for the approved addition',async()=>{
    const f=await fixture();
    try {
      await f.db.exec("INSERT INTO team_repos(id,team_id,provider,host,external_id,owner,name) SELECT 'seed-'||n,'t','github','github.com','seed-'||n,'org','seed-'||n FROM generate_series(1,9) n");
      const results=await Promise.all(['one','two'].map(externalId=>f.run(sql=>addTeamRepository(sql,{teamId:'t',actorId:'a',ref:{...ref,repo:externalId},externalId,private:true,permission:'admin'}))));
      expect(results.filter(result=>result.ok)).toHaveLength(1);
      expect(results.filter(result=>!result.ok)).toEqual([{ok:false,reason:'limit'}]);
      expect((await f.db.query('SELECT count(*)::integer AS count FROM team_repos WHERE removed_at IS NULL')).rows).toEqual([{count:10}]);
      expect((await f.db.query('SELECT user_id FROM grants ORDER BY user_id')).rows).toEqual([{user_id:'a'},{user_id:'m'}]);
      expect((await f.db.query("SELECT count(*)::integer AS count FROM outbox_jobs WHERE kind='grant'")).rows).toEqual([{count:2}]);
    } finally {await f.db.close();}
  });
  it('requires current approval when restoring a removed row and queues sync only after approval',async()=>{
    const f=await fixture();
    try {
      await f.db.exec("INSERT INTO team_repos(id,team_id,provider,host,external_id,owner,name,approved,removed_at) VALUES('old','t','github','github.com','old','org','new',true,now())");
      const restored=await f.run(sql=>addTeamRepository(sql,{teamId:'t',actorId:'m',ref,externalId:'old',private:true,permission:'read'}));
      expect(restored).toMatchObject({ok:true,repository:{id:'old',approved:false,removed_at:null}});
      expect((await f.db.query('SELECT id FROM grants')).rows).toEqual([]);
      expect((await f.db.query('SELECT kind,state FROM access_requests')).rows).toEqual([{kind:'add_repository',state:'pending'}]);
      await f.run(sql=>approveTeamRepository(sql,'t','old','a'));
      const active=await f.run(sql=>addTeamRepository(sql,{teamId:'t',actorId:'m',ref,externalId:'old',private:true,permission:'read'}));
      expect(active).toMatchObject({ok:true,repository:{approved:true}});
      expect((await f.db.query('SELECT count(*)::integer AS count FROM grants')).rows).toEqual([{count:2}]);
      expect((await f.db.query("SELECT count(*)::integer AS count FROM outbox_jobs WHERE kind='grant'")).rows).toEqual([{count:2}]);
    } finally {await f.db.close();}
  });
});
describe('access job claim recovery',()=>{
  it('recovers abandoned claims and rejects completion from their former owner',async()=>{
    const f=await fixture();
    try {
      await f.db.exec("INSERT INTO outbox_jobs(id,team_id,kind,resource_id,idempotency_key,state,created_at) VALUES('job','t','grant','grant','job-key','running',now()-interval '20 minutes')");
      const first=(await claimAccessJobs(f.sql,'t'))[0];if(!first)throw new Error('Claim missing');
      await f.db.exec("UPDATE outbox_jobs SET locked_at=now()-interval '16 minutes'");
      const second=(await claimAccessJobs(f.sql,'t'))[0];if(!second)throw new Error('Recovered claim missing');
      expect(second.lock_token).not.toBe(first.lock_token);
      expect(await finishAccessJob(f.sql,first,true)).toBe(false);
      expect((await f.db.query('SELECT state FROM outbox_jobs')).rows).toEqual([{state:'running'}]);
      expect(await finishAccessJob(f.sql,second,true)).toBe(true);
      expect((await f.db.query('SELECT state,lock_token,locked_at FROM outbox_jobs')).rows).toEqual([{state:'completed',lock_token:null,locked_at:null}]);
    } finally {await f.db.close();}
  });
});
describe('Bitbucket adapter transitions',()=>{
  it('keeps the old adapter after uncertain cleanup and retires its mappings before saving the direct-user path',async()=>{
    const f=await fixture();
    try {
      await f.db.exec("INSERT INTO provider_orgs(id,provider,host,external_id,slug) VALUES('org','bitbucket','bitbucket.org','workspace','workspace'); INSERT INTO provider_teams(id,team_id,org_id,provider,external_id,state) VALUES('group','t','org','bitbucket','old-group','active'); INSERT INTO provider_connections(team_id,provider,host,settings) VALUES('t','bitbucket','bitbucket.org','{\"path\":\"legacy_groups\"}')");
      let fail=true;const deletes:string[]=[];
      const adapter:Parameters<typeof changeBitbucketConnection>[1]['adapter']=async()=>({deleteGroup:async(owner,group)=>{deletes.push(`${owner}/${group}`);return fail?{ok:false,reason:'unavailable'}:{ok:true,value:undefined};}});
      const input={teamId:'t',actorId:'a',settings:{path:'direct_users'}} satisfies Parameters<typeof changeBitbucketConnection>[0];
      expect(await changeBitbucketConnection(input,{...f,adapter})).toEqual({ok:false,reason:'cleanup'});
      expect((await f.db.query('SELECT settings FROM provider_connections')).rows).toEqual([{settings:{path:'legacy_groups'}}]);
      expect((await f.db.query('SELECT state FROM provider_teams')).rows).toEqual([{state:'active'}]);
      fail=false;
      expect(await changeBitbucketConnection(input,{...f,adapter})).toEqual({ok:true});
      expect((await f.db.query('SELECT settings FROM provider_connections')).rows).toEqual([{settings:{path:'direct_users'}}]);
      expect((await f.db.query('SELECT state FROM provider_teams')).rows).toEqual([{state:'deleted'}]);
      expect(deletes).toEqual(['workspace/old-group','workspace/old-group']);
    } finally {await f.db.close();}
  });
});

describe('Bitbucket directory ownership',()=>{
  it('cleans old directory groups with the old configuration before storing a new directory',async()=>{
    const f=await fixture();
    try {
      await f.db.exec("INSERT INTO provider_orgs(id,provider,host,external_id,slug) VALUES('org','bitbucket','bitbucket.org','workspace','workspace'); INSERT INTO provider_teams(id,team_id,org_id,provider,external_id,state) VALUES('group','t','org','bitbucket','old-directory-group','active'); INSERT INTO provider_connections(team_id,provider,host,settings) VALUES('t','bitbucket','bitbucket.org','{\"path\":\"atlassian_groups\",\"organisationId\":\"org-id\",\"directoryId\":\"old-directory\"}')");
      let cleaned=false;
      const adapter:Parameters<typeof changeBitbucketConnection>[1]['adapter']=async()=>({deleteGroup:async()=>{
        expect((await f.db.query('SELECT settings->>\'directoryId\' AS directory FROM provider_connections')).rows).toEqual([{directory:'old-directory'}]);
        cleaned=true;return {ok:true,value:undefined};
      }});
      expect(await changeBitbucketConnection({teamId:'t',actorId:'a',settings:{path:'atlassian_groups',organisationId:'org-id',directoryId:'new-directory',adminKey:'synthetic-directory-api-key'}},{...f,adapter})).toEqual({ok:true});
      expect(cleaned).toBe(true);
      expect((await f.db.query('SELECT settings->>\'directoryId\' AS directory FROM provider_connections')).rows).toEqual([{directory:'new-directory'}]);
    } finally {await f.db.close();}
  });
});
