import { beforeEach,describe,expect,it,vi } from 'vitest';
import { providerFindings } from '@geld/review/provider-findings';
const state=vi.hoisted(()=>({text:'',settlements:new Array<boolean>(),threads:['Cache expires too early','Authorization accepts the wrong owner','Failed writes are replayed'].map((body,index)=>({id:`thread-${index}`,path:`src/file-${index}.ts`,line:10,resolved:false,outdated:false,comments:[{id:String(index+1),databaseId:index+1,author:'cursor[bot]',body:`Bug: ${body}`,url:`https://github.com/org/repo/pull/1#discussion_r${index+1}`,path:`src/file-${index}.ts`,line:10}]}))}));
vi.mock('server-only',()=>({}));
vi.mock('next/server',()=>({connection:async()=>undefined}));
vi.mock('./request-audit',()=>({auditedRoute:<T extends unknown[]>(handler:(request:Request,...rest:T)=>Promise<Response>)=>handler}));
vi.mock('./http',()=>({sameOrigin:()=>true,json:(value:unknown,status=200)=>Response.json(value,{status})}));
vi.mock('./session',()=>({currentActor:async()=>({id:'u'})}));
vi.mock('./db',()=>({database:()=>({query:async()=>({rows:[{id:'r'}]})})}));
vi.mock('./transactions',()=>({transaction:async<T>(sql:unknown,work:(sql:unknown)=>Promise<T>)=>work(sql)}));
vi.mock('./review-context',()=>({reviewContext:async()=>({ok:true,value:{pull:{headSha:'head'},aiAllowed:true,threadsUnavailable:false,commentsUnavailable:false,threads:state.threads,comments:[]}})}));
vi.mock('./providers',()=>({providerClient:async()=>({pull:async()=>({ok:true,value:{headSha:'head'}})})}));
vi.mock('./credits',()=>({reserveCredits:async()=>({ok:true,id:'credit'}),finishCredits:async(_sql:unknown,_id:string,success:boolean)=>{state.settlements.push(success);},creditError:()=>''}));
vi.mock('./ai-config',()=>({aiConfigurations:async()=>[{id:'ai',provider:'fixture',apiKey:'synthetic',baseUrl:'https://example.test',model:'Fixture',fallback:false}],completeConfigured:async()=>({ok:true,text:state.text})}));
import { POST } from '../app/api/findings/route';
const draft=providerFindings(state.threads,[]);
function request(){return new Request('https://app.geld.sh/api/findings',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ref:{provider:'github',host:'github.com',owner:'org',repo:'repo',number:1},teamId:'t',headSha:'head',key:crypto.randomUUID()})});}
beforeEach(()=>{state.settlements=[];expect(draft.items).toHaveLength(3);});
describe('paid consolidation coverage',()=>{
  it('refunds an output with a duplicated item and a missing concern',async()=>{
    const [first,second]=draft.items;if(!first||!second)throw new Error('Missing fixture findings');
    state.text=JSON.stringify({items:[first,first,second].map(item=>({id:item.id,title:'Consolidated concern'}))});
    expect((await POST(request())).status).toBe(503);expect(state.settlements).toEqual([false]);
  });
  it('settles only after each pending concern is present exactly once',async()=>{
    state.text=JSON.stringify({items:draft.items.map(item=>({id:item.id,title:'Consolidated concern'}))});
    const response=await POST(request());expect(response.status).toBe(200);expect(state.settlements).toEqual([true]);
    expect((await response.json()).credits).toBe(1);
  });
});
