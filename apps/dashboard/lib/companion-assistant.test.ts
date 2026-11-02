import {once} from 'node:events';
import {describe,expect,it,vi} from 'vitest';
import {createRelayBroker,pollConnector} from '@geld/relay';
vi.mock('server-only',()=>({}));
import {openAiStream} from './ai-stream';
describe('assistant cancellation through companion completion',()=>{
 it('cancels both the relay wait and the active connector execution',async()=>{
  const secret='x'.repeat(64);const broker=createRelayBroker([{id:'assistant',secret,host:'claude.local.geld.invalid',kind:'claude'}]);
  broker.server.listen(0,'127.0.0.1');await once(broker.server,'listening');const address=broker.server.address();if(!address||typeof address==='string')throw new Error('Missing address');
  const endpoint={url:`http://127.0.0.1:${address.port}`,channel:'assistant',secret,allowHttp:true};
  let entered:()=>void=()=>undefined,canceled:()=>void=()=>undefined;const ready=new Promise<void>(resolve=>{entered=resolve;});const stopped=new Promise<void>(resolve=>{canceled=resolve;});
  const connectorStop=new AbortController();const caller=new AbortController();
  const connector=pollConnector(endpoint,'claude.local.geld.invalid',async(_request,signal)=>{entered();return new Promise<Response>((_resolve,reject)=>{signal.addEventListener('abort',()=>{canceled();reject(new Error('Canceled'));},{once:true});});},connectorStop.signal,'claude');
  try{
   const completion=openAiStream({id:'fixture',provider:'companion',baseUrl:'https://claude.local.geld.invalid',apiKey:'local-companion',model:'sonnet',geldBilled:false,fallback:false,relay:endpoint},[{role:'user',content:'Fixture'}],caller.signal);
   await ready;caller.abort();expect(await completion).toBeNull();await stopped;expect(broker.pendingCount()).toBe(0);
  }finally{connectorStop.abort();broker.close();await connector;}
 });
});
