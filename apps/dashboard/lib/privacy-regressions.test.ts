import { readFile,readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { afterEach,describe,expect,it,vi } from 'vitest';
vi.mock('server-only',()=>({}));
import { finishCredits } from './credits';
import { fallbackSummaryUsage } from './fallback-usage';
import { createGeneratedContentStore } from './content-store';
afterEach(()=>vi.unstubAllEnvs());
describe('privacy retention and settled usage',()=>{
  it('includes a request started in the previous week in the summary for its settlement week exactly once',async()=>{
    const db=new PGlite();
    try {
      const directory=new URL('../db/migrations/',import.meta.url);for(const name of (await readdir(directory)).filter(name=>name.endsWith('.sql')).sort())await db.exec(await readFile(new URL(name,directory),'utf8'));
      await db.exec("INSERT INTO users(id,name,email) VALUES('u','User','user@example.test'); INSERT INTO teams(id,name) VALUES('t','Team'); INSERT INTO subscriptions(team_id) VALUES('t'); INSERT INTO credit_reservations(id,team_id,actor_id,idempotency_key,credits,overage_cents,created_at,fallback) VALUES('r','t','u','key',2,50,now()-interval '8 days',true)");
      const sql={query:(text:string,values?:unknown[])=>db.query(text,values)};
      await finishCredits(sql,'r',true);await finishCredits(sql,'r',true);
      const jobs=await db.query<{payload:{start:string;end:string}}>("SELECT payload FROM outbox_jobs WHERE kind='fallback_summary_email'");expect(jobs.rows).toHaveLength(1);
      const period=jobs.rows[0]?.payload;if(!period)throw new Error('Missing summary period');
      expect(await fallbackSummaryUsage(sql,'t',period)).toEqual({credits:2,cents:50});
      expect(await fallbackSummaryUsage(sql,'other',period)).toEqual({credits:0,cents:0});
    } finally {await db.close();}
  });
  it('expires customer publication receipts with plans and removes both during team erasure',async()=>{
    vi.stubEnv('TOKEN_ENCRYPTION_KEY','synthetic-privacy-key-at-least-32-characters');
    const db=new PGlite();const primary=new PGlite();
    try {
      await primary.exec("CREATE TABLE teams(id text PRIMARY KEY,content_erasing_at timestamptz); INSERT INTO teams(id) VALUES('t')");
      await db.exec(await readFile(new URL('./content-store.customer.sql',import.meta.url),'utf8'));
      const store=createGeneratedContentStore({customer:true,primary:{sql:{query:(text,values)=>primary.query(text,values)},run:work=>primary.transaction(tx=>work({query:(text,values)=>tx.query(text,values)}))},sql:{query:(text,values)=>db.query(text,values)},run:work=>db.transaction(tx=>work({query:(text,values)=>tx.query(text,values)}))});
      const input={teamId:'t',repoId:'r',number:1,headSha:'h',reservationId:'credit',plan:{id:'p',headSha:'h',madeAt:'2026-11-01T00:00:00Z',producer:'ai',model:'Fixture',steps:[],unassigned:[],excerpted:false}} satisfies Parameters<typeof store.put>[0];
      await store.put(input);expect(await store.hasPublication('credit')).toBe(true);
      await db.exec("UPDATE geld_generated_content SET expires_at=now()-interval '1 minute'; UPDATE geld_generated_content_receipts SET expires_at=now()-interval '1 minute'");
      await store.purgeExpired();expect((await db.query('SELECT id FROM geld_generated_content')).rows).toEqual([]);expect((await db.query('SELECT reservation_id FROM geld_generated_content_receipts')).rows).toEqual([]);
      await store.put(input);await store.deleteTeam('t');expect((await db.query('SELECT id FROM geld_generated_content')).rows).toEqual([]);expect((await db.query('SELECT reservation_id FROM geld_generated_content_receipts')).rows).toEqual([]);await expect(store.put(input)).rejects.toThrow('no longer accepted');await primary.exec("UPDATE teams SET content_erasing_at=NULL WHERE id='t'");await expect(store.put(input)).rejects.toThrow('no longer accepted');await primary.exec("UPDATE teams SET content_erasing_at=now() WHERE id='t'");expect(await store.get('t','r',1,'h')).toBeNull();
    } finally {await db.close();await primary.close();}
  });
});
