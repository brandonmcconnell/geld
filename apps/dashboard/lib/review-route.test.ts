import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProviderClient } from '@geld/providers';
import type { ProviderClient } from '@geld/domain';
import type { SqlExecutor } from './transactions';
const fixture=vi.hoisted((): { sql: SqlExecutor | null; client: ProviderClient | null }=>({sql:null,client:null}));
vi.mock('server-only',()=>({}));
vi.mock('next/server',()=>({connection:async()=>undefined}));
vi.mock('./db',()=>({database:()=>fixture.sql}));
vi.mock('./session',()=>({currentActor:async()=>({id:'u',name:'Reviewer',email:'reviewer@example.test'}),providerViewer:async()=>'reviewer'}));
vi.mock('./providers',()=>({providerClient:async()=>{if(!fixture.client)throw new Error('Missing fixture');return fixture.client;}}));
import { POST } from '../app/api/review/route';
beforeEach(()=>{vi.stubEnv('TOKEN_ENCRYPTION_KEY','test-security-signing-key-at-least-32-characters');vi.stubEnv('GELD_DEMO_MODE','false');vi.stubEnv('BETTER_AUTH_URL','https://app.geld.sh');});
afterEach(()=>{fixture.sql=null;fixture.client=null;vi.unstubAllEnvs();});
async function database() {
  const db=new PGlite();
  for(const name of ['0001_auth.sql','0002_dashboard.sql','0003_review.sql','0004_workspaces.sql','0005_access.sql','0006_apps.sql','0007_automation.sql'])await db.exec(await readFile(new URL(`../db/migrations/${name}`,import.meta.url),'utf8'));
  await db.exec("INSERT INTO users(id,name,email) VALUES('u','Reviewer','reviewer@example.test')");
  fixture.sql={query:(text,values)=>db.query(text,values)};
  return db;
}
const ref={provider:'github',host:'github.com',owner:'org',repo:'repo',number:1};
function request(key:string,body='Reviewed') {return new Request('https://app.geld.sh/api/review',{method:'POST',headers:{Origin:'https://app.geld.sh','Content-Type':'application/json'},body:JSON.stringify({ref,key,kind:'review',event:'comment',body,headSha:'head'})});}
function response(url:string) {return Response.json(url.endsWith('/pulls/1')?{id:1,number:1,title:'Change',user:{login:'author'},state:'open',updated_at:'2026-11-01T00:00:00Z',html_url:'https://github.com/org/repo/pull/1',head:{sha:'head'},base:{sha:'base'}}:{id:1,name:'repo',owner:{login:'org'},private:true,html_url:'https://github.com/org/repo',permissions:{push:true}});}
describe('review write key lifecycle',()=>{
  it('releases known preflight failures, confirms retries once, and binds a completed key to its request',async()=>{
    const db=await database();
    try {
      let unavailable=true;let writes=0;
      fixture.client=createProviderClient({provider:'github',source:{get:async()=>({status:'ok',token:'fixture',refreshed:false})},fetch:async(url,init)=>{if(init?.method==='POST'){writes+=1;return Response.json({id:7});}return unavailable?new Response(null,{status:503}):response(url);}});
      const key=crypto.randomUUID();
      expect((await POST(request(key))).status).toBe(409);
      expect((await db.query('SELECT key FROM mutation_keys')).rows).toEqual([]);
      expect(writes).toBe(0);
      unavailable=false;
      expect((await POST(request(key))).status).toBe(200);
      expect((await POST(request(key))).status).toBe(200);
      expect(writes).toBe(1);
      expect((await POST(request(key,'Different intent'))).status).toBe(409);
      expect(writes).toBe(1);
    } finally {await db.close();}
  });
  it('keeps the key after an unknown provider write outcome',async()=>{
    const db=await database();
    try {
      let writes=0;
      fixture.client=createProviderClient({provider:'github',source:{get:async()=>({status:'ok',token:'fixture',refreshed:false})},fetch:async(url,init)=>{if(init?.method==='POST'){writes+=1;throw new Error('Response lost');}return response(url);}});
      const key=crypto.randomUUID();
      expect((await POST(request(key))).status).toBe(409);
      expect((await POST(request(key))).status).toBe(409);
      expect(writes).toBe(1);
      expect((await db.query('SELECT state FROM mutation_keys')).rows).toEqual([{state:'failure'}]);
    } finally {await db.close();}
  });
});
