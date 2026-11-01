import { readFile,readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { afterEach,describe,expect,it,vi } from 'vitest';
vi.mock('server-only',()=>({}));
let db:PGlite;
vi.mock('./db',()=>({database:()=>({query:(text:string,values?:unknown[])=>db.query(text,values)})}));
import { operationFetch,operationSql,withTeamOperation } from './team-operation';
async function fixture(){db=new PGlite();const directory=new URL('../db/migrations/',import.meta.url);for(const name of(await readdir(directory)).filter(name=>name.endsWith('.sql')).sort())await db.exec(await readFile(new URL(name,directory),'utf8'));await db.exec("INSERT INTO teams(id,name) VALUES('t','Team')");}
function latch(){let finish:()=>void=()=>undefined;const promise=new Promise<void>(resolve=>{finish=resolve;});return{promise,release:()=>finish()};}
afterEach(()=>vi.useRealTimers());
describe('long-running team operation leases',()=>{
  it('renews a live operation before its lease expires',async()=>{
    await fixture();vi.useFakeTimers();const entered=latch();const finish=latch();
    try {
      const pending=withTeamOperation('t',async()=>{entered.release();await finish.promise;return 'done';});await entered.promise;
      await db.exec("UPDATE team_operation_leases SET expires_at=now()+interval '1 minute'");
      await vi.advanceTimersByTimeAsync(30000);
      expect((await db.query("SELECT expires_at>now()+interval '9 minutes' AS renewed FROM team_operation_leases")).rows).toEqual([{renewed:true}]);
      expect(await withTeamOperation('t',async()=>'overlap')).toEqual({ok:false});finish.release();expect(await pending).toEqual({ok:true,value:'done'});
    } finally {finish.release();vi.useRealTimers();await db.close();}
  });
  it('stops database and provider writes after losing ownership and preserves the replacement lease',async()=>{
    await fixture();const entered=latch();const finish=latch();const provider=vi.fn(async()=>Response.json({saved:true}));
    try {
      const pending=withTeamOperation('t',async()=>{entered.release();await finish.promise;try{await operationSql({query:(text,values)=>db.query(text,values)}).query("UPDATE teams SET name='Stale write' WHERE id='t'");}catch{}try{await operationFetch(provider)('https://provider.example.test/repo',{method:'DELETE'});}catch{}return 'stale';});
      await entered.promise;await db.exec("UPDATE team_operation_leases SET holder='replacement'");finish.release();expect(await pending).toEqual({ok:false});
      expect(provider).not.toHaveBeenCalled();expect((await db.query('SELECT name FROM teams')).rows).toEqual([{name:'Team'}]);expect((await db.query('SELECT holder FROM team_operation_leases')).rows).toEqual([{holder:'replacement'}]);
    } finally {finish.release();await db.close();}
  });
});
