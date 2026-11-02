import { readFile,readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import type { Permission } from '@geld/domain';
import type { ManagedAccessAdapter } from '@geld/providers';
vi.mock('server-only',()=>({}));
beforeEach(()=>vi.stubEnv('TOKEN_ENCRYPTION_KEY','synthetic-destruction-key-at-least-32-characters'));
afterEach(()=>vi.unstubAllEnvs());
let db:PGlite;
const state=vi.hoisted(():{permission:Permission;revoked:number}=>({permission:'write',revoked:0}));
vi.mock('./db',()=>({database:()=>({query:(text:string,values?:unknown[])=>db.query(text,values),connect:async()=>({query:(text:string,values?:unknown[])=>db.query(text,values),release:()=>undefined})})}));
vi.mock('./team-access',async original=>{
  const actual=await original<typeof import('./team-access')>();
  const adapter:ManagedAccessAdapter={
    repository:async ref=>({ok:true,value:{ref,id:'1',private:true,permission:'admin',url:'https://github.com/org/repo',ownerKind:'organisation'}}),
    user:async()=>({ok:true,value:{id:'external',login:'outside',permission:state.permission,organisationMember:false}}),
    revoke:async()=>{state.revoked++;state.permission='none';return{ok:true,value:undefined};},
    collaborators:async()=>({ok:true,value:{users:[],more:false}}),grant:async()=>({ok:true,value:'unused'}),createGroup:async()=>({ok:true,value:'unused'}),deleteGroup:async()=>({ok:true,value:undefined}),groupMember:async()=>({ok:true,value:undefined}),share:async()=>({ok:true,value:undefined}),
  };
  return{...actual,processGrantUnlocked:async(id:string,actorId:string)=>actual.processGrantRecord(id,actorId,{sql:{query:(text,values)=>db.query(text,values)},run:work=>db.transaction(tx=>work({query:(text,values)=>tx.query(text,values)})),adapter:async()=>adapter})};
});
vi.mock('./content-store',()=>({contentStore:()=>({deleteTeam:async()=>undefined})}));
import { finishTeamDestruction } from './team-destruction';
describe('resolving drift during destruction',()=>{
  it('preserves changed provider access, then finishes after the recorded permission is restored',async()=>{
    db=new PGlite();
    try {
      const directory=new URL('../db/migrations/',import.meta.url);for(const name of(await readdir(directory)).filter(name=>name.endsWith('.sql')).sort())await db.exec(await readFile(new URL(name,directory),'utf8'));
      await db.exec("INSERT INTO users(id,name,email) VALUES('admin','Admin','admin@example.test'); INSERT INTO teams(id,name,deleting_at) VALUES('t','Team',now()); INSERT INTO team_members(team_id,user_id,role) VALUES('t','admin','admin'); INSERT INTO subscriptions(team_id) VALUES('t'); INSERT INTO team_repos(id,team_id,provider,host,external_id,owner,name) VALUES('r','t','github','github.com','1','org','repo'); INSERT INTO grants(id,team_id,repo_id,provider,provider_user_id,provider_login,provider_grant_id,mechanism,permission,previous_permission,source,state,baseline_captured,mutation_started) VALUES('g','t','r','github','external','outside','collaborator:external','collaborator','read','none','audit','drifted',true,true)");
      expect(await finishTeamDestruction('t',{actorId:'admin',skip:[]})).toBe(false);expect(state.revoked).toBe(0);
      expect((await db.query('SELECT state FROM grants')).rows).toEqual([{state:'drifted'}]);
      state.permission='read';expect(await finishTeamDestruction('t',{actorId:'admin',skip:[]})).toBe(true);expect(state.revoked).toBe(1);expect((await db.query('SELECT id FROM teams')).rows).toEqual([]);
    } finally {await db.close();}
  });
});
