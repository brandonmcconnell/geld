import { beforeEach,describe,expect,it,vi } from 'vitest';
const state=vi.hoisted(():{hosts:string[];writes:number}=>({hosts:[],writes:0}));
vi.mock('server-only',()=>({}));
vi.mock('next/server',()=>({connection:async()=>undefined}));
vi.mock('./session',()=>({currentActor:async()=>({id:'u'})}));
vi.mock('./workspaces',()=>({teamMembership:async()=>true}));
vi.mock('./http',()=>({sameOrigin:()=>true,json:(value:unknown,status=200)=>Response.json(value,{status})}));
vi.mock('./db',()=>({database:()=>({query:async(text:string)=>{
  if(text.startsWith('SELECT * FROM team_repos'))return {rows:[{id:'r',team_id:'t',provider:'github',host:'git.example.test',owner:'org',name:'repo',external_id:'1',approved:true,removed_at:null,settings:{}}]};
  state.writes+=1;throw new Error('Permission must be checked before any write');
}})}));
vi.mock('./team-access',async importOriginal=>{
  const actual=await importOriginal<typeof import('./team-access')>();
  return {...actual,accessAdapter:async(_provider:string,_team:string,_owner:string,_source:unknown,host='github.com')=>{state.hosts.push(host);return {repository:async()=>({ok:true,value:{permission:host==='git.example.test'?'read':'admin'}})};}};
});
import { POST } from '../app/api/teams/[id]/review-defaults/route';
beforeEach(()=>{state.hosts=[];state.writes=0;});
describe('Enterprise review policy authority',()=>{
  it('checks the Enterprise repository even when a same-named public repository grants admin access',async()=>{
    const response=await POST(new Request('https://app.geld.sh/api/teams/t/review-defaults',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({repoId:'r',policy:{trigger:'click',drafts:false,locked:false,override:true}})}),{params:Promise.resolve({id:'t'})});
    expect(response.status).toBe(403);expect(state.hosts).toEqual(['git.example.test']);expect(state.writes).toBe(0);
  });
});
