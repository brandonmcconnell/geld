import { once } from 'node:events';
import { describe,expect,it,vi } from 'vitest';
import { createRelayBroker } from './broker';
import { signRelay } from './protocol';
async function listening(broker:ReturnType<typeof createRelayBroker>) {
  broker.server.listen(0,'127.0.0.1');await once(broker.server,'listening');
  const address=broker.server.address();if(!address||typeof address==='string')throw new Error('Missing broker address');
  return `http://127.0.0.1:${address.port}`;
}
describe('relay channel lifecycle',()=>{
  it('keeps static channels available alongside database channels and reserves duplicate IDs for static configuration',async()=>{
    const secret=crypto.randomUUID();const dynamic=crypto.randomUUID();
    const resolver=vi.fn(async(id:string)=>({id,host:'ghe.example.test',secret:dynamic}));
    const broker=createRelayBroker([{id:'static',host:'ghe.example.test',secret}],resolver);
    try {
      const url=await listening(broker);
      const path='/v1/channels/static/request';const body='{}';
      const first=await fetch(url+path,{method:'POST',body,headers:signRelay(secret,'POST',path,body)});
      expect(first.status).toBe(400);expect(resolver).not.toHaveBeenCalled();
      const dynamicPath='/v1/channels/dynamic/request';
      expect((await fetch(url+dynamicPath,{method:'POST',body,headers:signRelay(dynamic,'POST',dynamicPath,body)})).status).toBe(400);
      expect(resolver).toHaveBeenCalledWith('dynamic');expect(broker.channelCount()).toBe(2);
    } finally {broker.close();}
  });
  it('keeps replay guards for their full window and releases idle retired channels afterward',async()=>{
    const secret=crypto.randomUUID();let now=Date.now();
    const broker=createRelayBroker([],async id=>({id,host:'ghe.example.test',secret}),()=>now);
    try {
      const url=await listening(broker);const path='/v1/channels/retired/request';const body='{}';const headers=signRelay(secret,'POST',path,body);
      expect((await fetch(url+path,{method:'POST',body,headers})).status).toBe(400);
      expect((await fetch(url+path,{method:'POST',body,headers})).status).toBe(401);
      now+=119999;broker.pruneIdle();expect(broker.channelCount()).toBe(1);
      now+=2;broker.pruneIdle();expect(broker.channelCount()).toBe(0);expect(broker.pendingCount()).toBe(0);
      expect((await fetch(url+path,{method:'POST',body,headers})).status).toBe(401);expect(broker.channelCount()).toBe(0);
    } finally {broker.close();}
  });
});

describe('database lookup admission before channel authentication', () => {
  it('rejects malformed ingress and bounds concurrent lookups and random-ID misses while static traffic still works', async () => {
    let release: () => void = () => undefined;
    const hold = new Promise<void>(resolve => {release=resolve;});
    let blocked = true; let now = Date.now();
    const resolver = vi.fn(async (_id: string) => {if(blocked)await hold;return null;});
    const secret = crypto.randomUUID();
    const broker = createRelayBroker([{id:'static',host:'ghe.example.test',secret}],resolver,()=>now);
    try {
      const url = await listening(broker);
      expect((await fetch(url+'/v1/channels/missing/request')).status).toBe(404);
      expect((await fetch(url+'/v1/channels/missing/request',{method:'POST',body:'{}'})).status).toBe(401);
      expect(resolver).not.toHaveBeenCalled();
      const send = (id:string) => {const path=`/v1/channels/${id}/request`;return fetch(url+path,{method:'POST',body:'{}',headers:signRelay(secret,'POST',path,'{}')});};
      const requests = Array.from({length:6},(_,i)=>send(`missing-${i}`));
      await vi.waitFor(()=>expect(resolver).toHaveBeenCalledTimes(2));
      expect((await send('static')).status).toBe(400);
      blocked=false;release();
      const responses = await Promise.all(requests);
      expect(responses.filter(r=>r.status===429)).toHaveLength(4);
      for(let i=0;i<30;i++)await send(`other-${i}`);
      expect(resolver).toHaveBeenCalledTimes(16);
      expect(broker.channelCount()).toBe(1);
      now+=2000;
      expect((await send('new-miss')).status).toBe(404);
      expect(resolver).toHaveBeenCalledTimes(17);
    } finally {release();broker.close();}
  });
  it('releases admission slots after a resolver failure', async () => {
    const secret=crypto.randomUUID();
    const resolver=vi.fn(async()=>{throw new Error('Synthetic database outage');});
    const broker=createRelayBroker([],resolver);
    try {
      const url=await listening(broker);
      for(let i=0;i<3;i++){
        const path=`/v1/channels/id-${i}/request`;
        expect((await fetch(url+path,{method:'POST',body:'{}',headers:signRelay(secret,'POST',path,'{}')})).status).toBe(503);
      }
      expect(resolver).toHaveBeenCalledTimes(3);
    } finally {broker.close();}
  });
});
