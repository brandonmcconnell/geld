import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { describe,expect,it,vi } from 'vitest';
vi.mock('server-only',()=>({}));
import { registerEnterpriseHost } from './enterprise-registration';
import { enterpriseTransport } from './enterprise';
describe('Enterprise boundaries',()=>{
  it('allows only the winning workspace when unrelated admins register a host concurrently',async()=>{
    const db=new PGlite();
    try {
      for(const name of ['0001_auth.sql','0002_dashboard.sql','0010_enterprise.sql'])await db.exec(await readFile(new URL(`../db/migrations/${name}`,import.meta.url),'utf8'));
      await db.exec("INSERT INTO users(id,name,email) VALUES('a','A','a@example.test'),('b','B','b@example.test'); INSERT INTO teams(id,name) VALUES('a','A'),('b','B'); INSERT INTO team_members(team_id,user_id,role) VALUES('a','a','admin'),('b','b','admin'); INSERT INTO subscriptions(team_id,tier) VALUES('a','enterprise'),('b','enterprise')");
      const results=await Promise.all(['a','b'].map(id=>db.transaction(tx=>registerEnterpriseHost({query:(text,values)=>tx.query(text,values)},{host:'git.example.test',teamId:id,actorId:id,channel:id,encryptedSecret:id,direct:true}))));
      expect(results.filter(result=>result.ok)).toHaveLength(1);
      expect(results.filter(result=>!result.ok)).toEqual([{ok:false,reason:'owned'}]);
      expect((await db.query('SELECT count(*)::integer AS count FROM enterprise_host_teams')).rows).toEqual([{count:1}]);
      const owner=(await db.query<{team_id:string}>('SELECT team_id FROM enterprise_hosts')).rows[0];if(!owner)throw new Error('Missing host');
      expect(await db.transaction(tx=>registerEnterpriseHost({query:(text,values)=>tx.query(text,values)},{host:'git.example.test',teamId:owner.team_id,actorId:owner.team_id,channel:'new',encryptedSecret:'new',direct:false}))).toEqual({ok:true,created:false});
      expect((await db.query('SELECT relay_channel FROM enterprise_hosts')).rows).toEqual([{relay_channel:owner.team_id}]);
    } finally {await db.close();}
  });
  it('falls back for reads but never replays a write after an uncertain direct response',async()=>{
    const direct=vi.fn(async()=>{throw new Error('Response lost after provider accepted request');});
    const relay=vi.fn(async()=>Response.json({saved:true}));
    const request=enterpriseTransport({host:'git.example.test',directAllowed:true,direct,viaRelay:relay});
    for(const method of ['POST','PUT','PATCH','DELETE'])await expect(request('https://git.example.test/api/v3/repos/org/repo/issues/1/comments',{method,body:'{}'})).rejects.toThrow('Response lost');
    expect(relay).not.toHaveBeenCalled();
    expect((await request('https://git.example.test/api/v3/repos/org/repo',{method:'GET'})).ok).toBe(true);
    expect(relay).toHaveBeenCalledTimes(1);
    await expect(request('https://github.com/repos/org/repo')).rejects.toThrow('destination rejected');
    expect(direct).toHaveBeenCalledTimes(5);
  });
});
