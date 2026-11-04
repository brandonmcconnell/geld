import { describe, expect, it } from 'vitest';
import type { TokenSource } from './auth';
import { createApiTransport } from './client';
const candidate: TokenSource = { get: async () => ({ status:'ok',token:'managed-fixture',refreshed:false }) };
const source: TokenSource = { get: async () => ({ status:'ok',token:'base-fixture',refreshed:false }),alternatives:[candidate] };
describe('alternative connected authorizations', () => {
  it.each([403,404])('uses another authorization when the first cannot reach the repository or action (%s)', async status => {
    const seen: string[] = [];
    const api=createApiTransport({baseUrl:'https://api.github.com/',source,fetch:async (_url,init)=>{const token=new Headers(init?.headers).get('Authorization')??'';seen.push(token);return token==='Bearer base-fixture'?new Response(null,{status}):Response.json({id:1});}});
    expect(await api.request('repos/org/repo/collaborators/user',{method:'PUT',body:{permission:'pull'}})).toEqual({ok:true,value:{id:1}});
    expect(seen).toEqual(['Bearer base-fixture','Bearer managed-fixture']);
  });
  it.each(['network','server','rate_limit','malformed','redirect'])('does not repeat a write with another credential after %s uncertainty', async failure => {
    let calls=0;
    const api=createApiTransport({baseUrl:'https://api.github.com/',source,fetch:async ()=>{calls+=1;if(failure==='network')throw new Error('Lost response');return failure==='server'?new Response(null,{status:503}):failure==='rate_limit'?new Response(null,{status:403,headers:{'retry-after':'10'}}):failure==='redirect'?new Response(null,{status:307,headers:{location:'/elsewhere'}}):new Response('not json');}});
    expect((await api.request('repos/org/repo/collaborators/user',{method:'PUT',body:{permission:'pull'}})).ok).toBe(false);
    expect(calls).toBe(1);
  });
});
