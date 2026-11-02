import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import type { SqlExecutor } from './transactions';
vi.mock('server-only',()=>({}));
import { bindTrackerAuthorization } from './tracker-authorization';
import { trackerOAuthSource } from './tracker-oauth';
import { encryptCredential } from './crypto';
beforeEach(()=>vi.stubEnv('TOKEN_ENCRYPTION_KEY','synthetic-tracker-test-key-at-least-32-characters'));
afterEach(()=>vi.unstubAllEnvs());
async function fixture() {
  const db=new PGlite();
  for(const name of ['0001_auth.sql','0002_dashboard.sql','0003_review.sql','0004_workspaces.sql','0005_access.sql','0006_apps.sql','0007_automation.sql','0008_trackers.sql','0009_tracker_oauth.sql'])await db.exec(await readFile(new URL(`../db/migrations/${name}`,import.meta.url),'utf8'));
  await db.exec("INSERT INTO users(id,name,email) VALUES('a','Admin','admin@example.test'); INSERT INTO teams(id,name) VALUES('t','Team'); INSERT INTO team_members(team_id,user_id,role) VALUES('t','a','admin'); INSERT INTO tracker_connections(team_id,provider,allowed_keys,settings) VALUES('t','linear',ARRAY['ENG'],'{\"workspace\":\"old\"}')");
  const sql:SqlExecutor={query:(text,values)=>db.query(text,values)};
  const run=<T>(work:(sql:SqlExecutor)=>Promise<T>)=>db.transaction(tx=>work({query:(text,values)=>tx.query(text,values)}));
  return {db,sql,run};
}
describe('tracker authorization scope',()=>{
  it('rejects callbacks after a same-provider configuration change, including a change back',async()=>{
    const f=await fixture();
    try {
      const input={teamId:'t',actorId:'a',provider:'linear',version:0,encryptedAccess:'old-workspace-token',encryptedRefresh:null,expiresAt:null,cloudId:null};
      await f.db.exec("UPDATE tracker_connections SET config_version=config_version+1,settings='{\"workspace\":\"new\"}'; UPDATE tracker_connections SET config_version=config_version+1,settings='{\"workspace\":\"old\"}'");
      expect(await f.run(sql=>bindTrackerAuthorization(sql,input))).toBe(false);
      expect((await f.db.query('SELECT encrypted_credential FROM tracker_connections')).rows).toEqual([{encrypted_credential:null}]);
      expect(await f.run(sql=>bindTrackerAuthorization(sql,{...input,version:2}))).toBe(true);
      await f.db.exec("UPDATE team_members SET role='member'");
      expect(await f.run(sql=>bindTrackerAuthorization(sql,{...input,version:2,encryptedAccess:'unauthorized'}))).toBe(false);
      expect((await f.db.query('SELECT encrypted_credential FROM tracker_connections')).rows).toEqual([{encrypted_credential:'old-workspace-token'}]);
    } finally {await f.db.close();}
  });
  it('never exposes a replacement credential through a stale token source',async()=>{
    const f=await fixture();
    try {
      await f.db.query('UPDATE tracker_connections SET encrypted_credential=$1',[await encryptCredential('original-token')]);
      const source=trackerOAuthSource('t',{provider:'linear',version:0},f);
      expect(await source.get()).toEqual({status:'ok',token:'original-token',refreshed:false});
      await f.db.query("UPDATE tracker_connections SET provider='jira',config_version=1,encrypted_credential=$1",[await encryptCredential('replacement-token')]);
      expect(await source.get()).toEqual({status:'signed-out',reason:'Tracker configuration changed'});
      expect(await trackerOAuthSource('t',{provider:'jira',version:0},f).get()).toEqual({status:'signed-out',reason:'Tracker configuration changed'});
    } finally {await f.db.close();}
  });
});
