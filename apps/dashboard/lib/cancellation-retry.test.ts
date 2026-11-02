import { readFile,readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { afterEach,describe,expect,it,vi } from 'vitest';
vi.mock('server-only',()=>({}));
let db:PGlite;
const state=vi.hoisted(()=>({available:false,calls:0}));
vi.mock('./db',()=>({database:()=>({query:(text:string,values?:unknown[])=>db.query(text,values),connect:async()=>({query:(text:string,values?:unknown[])=>db.query(text,values),release:()=>undefined})})}));
vi.mock('./billing-gateway',()=>({billingGateway:()=>({cancelSubscription:async()=>{state.calls++;if(!state.available)throw new Error('Synthetic billing outage');}})}));
vi.mock('./content-store',()=>({contentStore:()=>({purgeExpired:async()=>undefined})}));
import { encryptCredential } from './crypto';
import { drainOutbox } from './outbox';
afterEach(()=>vi.unstubAllEnvs());
describe('financial cleanup retry lifetime',()=>{
  it('retries cancellation past eight failures and clears its encrypted reference only after confirmed completion',async()=>{
    vi.stubEnv('TOKEN_ENCRYPTION_KEY','synthetic-financial-retry-key-at-least-32-characters');db=new PGlite();
    try {
      const directory=new URL('../db/migrations/',import.meta.url);for(const name of(await readdir(directory)).filter(name=>name.endsWith('.sql')).sort())await db.exec(await readFile(new URL(name,directory),'utf8'));
      await db.query("INSERT INTO outbox_jobs(id,kind,resource_id,idempotency_key,state,attempts,payload) VALUES('cancel','subscription_cancel','fingerprint','cancel-key','failed',10,$1)",[JSON.stringify({encryptedSubscription:await encryptCredential('sub_synthetic')})]);
      expect(await drainOutbox()).toEqual({completed:0,failed:1});expect(state.calls).toBe(1);
      expect((await db.query('SELECT state,attempts FROM outbox_jobs')).rows).toEqual([{state:'failed',attempts:11}]);
      await db.exec("UPDATE outbox_jobs SET run_after=now()-interval '1 second'");state.available=true;
      expect(await drainOutbox()).toEqual({completed:1,failed:0});expect(state.calls).toBe(2);
      expect((await db.query('SELECT state,attempts,payload FROM outbox_jobs')).rows).toEqual([{state:'completed',attempts:12,payload:{}}]);
    } finally {await db.close();}
  });
});
