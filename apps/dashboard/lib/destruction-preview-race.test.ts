import { readFile,readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
vi.mock('server-only',()=>({}));
beforeEach(()=>vi.stubEnv('TOKEN_ENCRYPTION_KEY','synthetic-destruction-key-at-least-32-characters'));
afterEach(()=>vi.unstubAllEnvs());
let db:PGlite;
vi.mock('./db',()=>({database:()=>({query:(text:string,values?:unknown[])=>db.query(text,values),connect:async()=>({query:(text:string,values?:unknown[])=>db.query(text,values),release:()=>undefined})})}));
vi.mock('./team-access',async original=>({...await original<typeof import('./team-access')>(),accessAdapter:async()=>({repository:async()=>({ok:true,value:{permission:'admin',ownerKind:'person'}})})}));
import { destructionPreview,prepareTeamDestruction } from './team-destruction';
import { withTeamOperation } from './team-operation';
describe('final destruction preview serialization',()=>{
  it('waits for an invitation writer and includes its confirmed grant in a renewed Skip choice',async()=>{
    db=new PGlite();
    try {
      const directory=new URL('../db/migrations/',import.meta.url);for(const name of(await readdir(directory)).filter(name=>name.endsWith('.sql')).sort())await db.exec(await readFile(new URL(name,directory),'utf8'));
      await db.exec("INSERT INTO users(id,name,email) VALUES('admin','Admin','admin@example.test'); INSERT INTO teams(id,name,managed_access,sync_enabled) VALUES('t','Team',true,true); INSERT INTO team_members(team_id,user_id,role) VALUES('t','admin','admin'); INSERT INTO subscriptions(team_id) VALUES('t'); INSERT INTO team_repos(id,team_id,provider,host,external_id,owner,name) VALUES('r','t','github','github.com','1','person','repo'); INSERT INTO grants(id,team_id,repo_id,provider,provider_user_id,provider_login,mechanism,permission,previous_permission,source,state) VALUES('g','t','r','github','external','outside','collaborator','read','none','audit','pending')");
      const before=await destructionPreview('t','admin');let finish:()=>void=()=>undefined;let entered:()=>void=()=>undefined;const ready=new Promise<void>(resolve=>{entered=resolve;});
      const writer=withTeamOperation('t',async()=>{entered();await new Promise<void>(resolve=>{finish=resolve;});await db.exec("UPDATE grants SET provider_grant_id='invitation-1' WHERE id='g'");});await ready;
      expect(await prepareTeamDestruction({teamId:'t',actorId:'admin',confirmation:before.confirmation,personal:'skip'})).toEqual({ok:false,reason:'busy'});
      finish();await writer;
      expect(await prepareTeamDestruction({teamId:'t',actorId:'admin',confirmation:before.confirmation,personal:'skip'})).toEqual({ok:false,reason:'changed'});
      const current=await destructionPreview('t','admin');const prepared=await prepareTeamDestruction({teamId:'t',actorId:'admin',confirmation:current.confirmation,personal:'skip'});
      expect(prepared.ok&&prepared.skipped.map(row=>row.grantId)).toEqual(['g']);
      expect((await db.query("SELECT payload->'skip' AS skip FROM outbox_jobs WHERE kind='destroy_team'")).rows).toEqual([{skip:['g']}]);
    } finally {await db.close();}
  });
});
