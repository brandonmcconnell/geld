import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiTransport } from '@geld/github';
vi.mock('server-only',()=>({}));
import { storedAppUserSource } from './repository-apps';
import { encryptCredential } from './crypto';
beforeEach(()=>vi.stubEnv('TOKEN_ENCRYPTION_KEY','test-security-signing-key-at-least-32-characters'));
afterEach(()=>vi.unstubAllEnvs());
describe('stored repository App selection',()=>{
  it('retains every verified matching App and tries an authorization covering the repository action',async()=>{
    const db=new PGlite();
    try {
      for(const name of ['0001_auth.sql','0002_dashboard.sql','0003_review.sql','0004_workspaces.sql','0005_access.sql','0006_apps.sql'])await db.exec(await readFile(new URL(`../db/migrations/${name}`,import.meta.url),'utf8'));
      await db.exec("INSERT INTO users(id,name,email) VALUES('u','User','user@example.test')");
      for(const [id,owner] of [['a-base','org'],['z-managed','org'],['0-foreign','elsewhere']]) {
        await db.query("INSERT INTO repository_apps(id,fingerprint,permissions,app_id,slug,client_id,encrypted_secret,encrypted_private_key,encrypted_webhook_secret) VALUES($1,$1,'{}',$1,$1,$1,'unused','unused','unused')",[id]);
        await db.query("INSERT INTO app_installations(id,provider,host,external_id,app_id,permission_fingerprint,state,registry_id,account_slug) VALUES($1,'github','github.com',$1,$1,$1,'verified',$1,$2)",[id,owner]);
        await db.query('INSERT INTO app_user_tokens(user_id,app_id,encrypted_access) VALUES($1,$2,$3)',['u',id,await encryptCredential(`${id}-fixture`)]);
      }
      const source=await storedAppUserSource('u','ORG',{sql:{query:(text,values)=>db.query(text,values)},run:work=>db.transaction(tx=>work({query:(text,values)=>tx.query(text,values)}))});
      expect(source?.alternatives).toHaveLength(1);
      if(!source)throw new Error('No matching App');
      const seen:string[]=[];
      const api=createApiTransport({baseUrl:'https://api.github.com/',source,fetch:async(_url,init)=>{const token=new Headers(init?.headers).get('Authorization')??'';seen.push(token);return token.includes('a-base')?new Response(null,{status:403}):Response.json({id:1});}});
      expect(await api.request('repos/org/selected/collaborators/user',{method:'PUT',body:{permission:'pull'}})).toEqual({ok:true,value:{id:1}});
      expect(seen).toEqual(['Bearer a-base-fixture','Bearer z-managed-fixture']);
      expect(await storedAppUserSource('u','unknown',{sql:{query:(text,values)=>db.query(text,values)},run:work=>db.transaction(tx=>work({query:(text,values)=>tx.query(text,values)}))})).toBeNull();
    } finally {await db.close();}
  });
});
