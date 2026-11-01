import { readFile,readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
vi.mock('server-only',()=>({}));
import { cleanupCheckout,queueTeamCheckoutCleanup } from './checkout-cleanup';
beforeEach(()=>vi.stubEnv('TOKEN_ENCRYPTION_KEY','synthetic-checkout-cleanup-key-at-least-32-characters'));
afterEach(()=>vi.unstubAllEnvs());
async function fixture(id:string,state:'creating'|'pending'){
  const db=new PGlite();const directory=new URL('../db/migrations/',import.meta.url);for(const name of(await readdir(directory)).filter(name=>name.endsWith('.sql')).sort())await db.exec(await readFile(new URL(name,directory),'utf8'));
  await db.exec("INSERT INTO teams(id,name) VALUES('t','Team'); INSERT INTO subscriptions(team_id) VALUES('t')");
  await db.query('INSERT INTO billing_checkouts(id,team_id,tier,state,request_key) VALUES($1,\'t\',\'starter\',$2,$3)',[id,state,crypto.randomUUID()]);
  await db.transaction(tx=>queueTeamCheckoutCleanup({query:(text,values)=>tx.query(text,values)},'t'));
  await db.exec("DELETE FROM teams WHERE id='t'");
  const job=(await db.query<{payload:unknown;idempotency_key:string}>('SELECT payload,idempotency_key FROM outbox_jobs')).rows[0];if(!job)throw new Error('Cleanup job missing');
  return {db,job};
}
describe('checkout cleanup after erasure',()=>{
  it('keeps an encrypted independent job and cancels a subscription when completion wins the expiration race',async()=>{
    const f=await fixture('cs_test_pending','pending');
    try {
      let completed=false;const canceled:string[]=[];
      expect(JSON.stringify(f.job)).not.toContain('cs_test_pending');
      const gateway={checkoutState:async()=>({status:completed?'complete':'open',teamId:'t',url:null,subscriptionId:completed?'sub_late':null} satisfies Awaited<ReturnType<Parameters<typeof cleanupCheckout>[2]['checkoutState']>>),expireCheckout:async()=>{completed=true;throw new Error('Checkout completed during expiration');},cancelSubscription:async(id:string)=>{canceled.push(id);}};
      expect(await cleanupCheckout(f.job.payload,f.job.idempotency_key,gateway)).toBe(true);expect(canceled).toEqual(['sub_late']);
    } finally {await f.db.close();}
  });
  it('reconciles uncertain creation without creating another checkout and waits for the original creation window to close',async()=>{
    const f=await fixture(`pending:${crypto.randomUUID()}`,'creating');
    try {
      const canceled:string[]=[];let ids:readonly string[]=[];
      const gateway={findCheckouts:vi.fn(async()=>({ids,complete:true})),checkoutState:async()=>({status:'complete',teamId:'t',url:null,subscriptionId:'sub_recovered'} satisfies Awaited<ReturnType<Parameters<typeof cleanupCheckout>[2]['checkoutState']>>),expireCheckout:async()=>undefined,cancelSubscription:async(id:string)=>{canceled.push(id);}};
      expect(await cleanupCheckout(f.job.payload,f.job.idempotency_key,gateway)).toBe(false);
      expect(await cleanupCheckout(f.job.payload,f.job.idempotency_key,gateway,Date.now()+26*60*60*1000)).toBe(true);
      ids=['cs_test_recovered'];expect(await cleanupCheckout(f.job.payload,f.job.idempotency_key,gateway)).toBe(true);expect(canceled).toEqual(['sub_recovered']);
      expect(gateway.findCheckouts).toHaveBeenCalledTimes(3);
    } finally {await f.db.close();}
  });
});
