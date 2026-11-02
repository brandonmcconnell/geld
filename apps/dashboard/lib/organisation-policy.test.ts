import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TokenSource } from '@geld/github';
const state=vi.hoisted((): {exists:boolean;text:string;requests:{source:string;path:string}[]}=>({exists:true,text:'review: { ai: false }',requests:[]}));
vi.mock('server-only',()=>({}));
vi.mock('./env',()=>({demoEnabled:()=>false}));
vi.mock('./session',()=>({currentActor:async()=>null,providerTokenSource:async()=>({})}));
vi.mock('./db',()=>({database:()=>null}));
vi.mock('@geld/github',()=>({createApiTransport:(options:{source:TokenSource})=>({request:async(path:string)=>{
  const token=await options.source.get();const source=token.status==='ok'?token.token:'anonymous';state.requests.push({source,path});
  if(path==='repos/org/.github')return state.exists&&source==='organisation'?{ok:true,value:{id:1}}:{ok:false,reason:'not_found'};
  if(path==='repos/org/.github/contents/geld.yml'&&source==='organisation')return {ok:true,value:state.text};
  return {ok:false,reason:'not_found'};
}})}));
import { reviewSettings } from './review-settings';
const source:TokenSource={get:async()=>({status:'ok',token:'scoped',refreshed:false})};
const organisationSource:TokenSource={get:async()=>({status:'ok',token:'organisation',refreshed:false})};
const ref={provider:'github',host:'github.com',owner:'org',repo:'repo'} satisfies Parameters<typeof reviewSettings>[0];
beforeEach(()=>{state.exists=true;state.text='review: { ai: false }';state.requests=[];});
describe('separate organization policy authority',()=>{
  it('reads a private policy with its authorized source and applies its AI restriction',async()=>{
    const result=await reviewSettings(ref,{source,organisationSource,userId:'u'});
    expect(result.aiAllowed).toBe(false);
    expect(state.requests.filter(request=>request.path.startsWith('repos/org/.github'))).toEqual([{source:'organisation',path:'repos/org/.github'},{source:'organisation',path:'repos/org/.github/contents/geld.yml'}]);
  });
  it('pauses AI when selected repository scope cannot distinguish a hidden policy from an absent repository',async()=>{
    state.exists=false;
    const result=await reviewSettings(ref,{source,organisationSource,userId:'u'});
    expect(result.aiAllowed).toBe(false);expect(result.warning).toContain('paused');
  });
  it('allows a missing policy repository only after complete installation scope establishes its absence',async()=>{
    state.exists=false;
    expect((await reviewSettings(ref,{source,organisationSource,organisationComplete:true,userId:'u'})).aiAllowed).toBe(true);
  });
});
