import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {describe,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {queueOutsideGrant} from './collaborator-audit';
describe('outside collaborator ledger',()=>{
 it('records a direct pending grant without creating a Geld membership or duplicating invitations',async()=>{const db=new PGlite();const directory=new URL('../db/migrations/',import.meta.url);for(const name of(await readdir(directory)).filter(name=>name.endsWith('.sql')).sort())await db.exec(await readFile(new URL(name,directory),'utf8'));
 await db.exec("INSERT INTO users(id,name,email) VALUES('admin','Admin','admin@example.test');INSERT INTO teams(id,name) VALUES('team','Team');INSERT INTO team_members(team_id,user_id,role) VALUES('team','admin','admin');INSERT INTO team_repos(id,team_id,provider,host,external_id,owner,name) VALUES('repo','team','github','github.com','1','owner','repo');");
 const sql={query:async(text:string,values?:unknown[])=>db.query(text,values)};const person={repoId:'repo',provider:'github',id:'outside-user',login:'outside'};await queueOutsideGrant(sql,'team','admin',person);await queueOutsideGrant(sql,'team','admin',person);
 expect((await db.query('SELECT user_id,mechanism,source,state,previous_permission FROM grants')).rows).toEqual([{user_id:null,mechanism:'collaborator',source:'audit',state:'pending',previous_permission:'none'}]);expect((await db.query("SELECT count(*)::integer AS count FROM outbox_jobs WHERE kind='grant'")).rows).toEqual([{count:1}]);expect((await db.query('SELECT count(*)::integer AS count FROM team_members')).rows).toEqual([{count:1}]);await db.close();});
});
