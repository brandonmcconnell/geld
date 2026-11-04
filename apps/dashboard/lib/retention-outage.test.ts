import { readFile,readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { describe,expect,it,vi } from 'vitest';
vi.mock('server-only',()=>({}));
let db:PGlite;
vi.mock('./db',()=>({database:()=>({query:(text:string,values?:unknown[])=>db.query(text,values),connect:async()=>({query:(text:string,values?:unknown[])=>db.query(text,values),release:()=>undefined})})}));
vi.mock('./content-store',()=>({contentStore:()=>({purgeExpired:async()=>{throw new Error('Synthetic customer storage outage');}})}));
import { drainOutbox } from './outbox';
describe('independent retention cleanup',()=>{
  it('expires primary records even when customer storage cannot be reached',async()=>{
    db=new PGlite();
    try {
      const directory=new URL('../db/migrations/',import.meta.url);for(const name of(await readdir(directory)).filter(name=>name.endsWith('.sql')).sort())await db.exec(await readFile(new URL(name,directory),'utf8'));
      await db.exec("INSERT INTO outbox_jobs(id,kind,resource_id,idempotency_key,state,created_at) VALUES('old','fixture','none','old-key','completed',now()-interval '31 days'); INSERT INTO review_receipts(id,provider,resource_fingerprint,action,outcome,created_at) VALUES('receipt','github','fingerprint','review','success',now()-interval '366 days')");
      expect(await drainOutbox()).toEqual({completed:0,failed:1});
      expect((await db.query('SELECT id FROM outbox_jobs')).rows).toEqual([]);expect((await db.query('SELECT id FROM review_receipts')).rows).toEqual([]);
    } finally {await db.close();}
  });
});
