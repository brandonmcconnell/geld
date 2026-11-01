import { describe,expect,it } from 'vitest';
import { managedAccessAdapter } from './access';
import type { Provider,RepositoryRef } from '@geld/domain';
const source={get:async()=>({status:'ok',token:crypto.randomUUID(),refreshed:false} satisfies {status:'ok';token:string;refreshed:boolean})};
describe('managed provider access',()=>{
  it.each(['github','gitlab','bitbucket'] satisfies Provider[])('never invites an outside user into a %s organisation',async provider=>{
    const requests:string[]=[];const adapter=managedAccessAdapter({provider,source,fetch:async url=>{requests.push(url);return Response.json({});}});
    expect(await adapter.groupMember('organisation','geld-team',{id:'42',login:'outsider',permission:'none',organisationMember:false})).toMatchObject({ok:false,reason:'permission'});
    expect(requests).toEqual([]);
  });
  it('uses the 2.0 direct user fallback for migrated Bitbucket workspaces',async()=>{
    const requests:{url:string;method:string;body:unknown}[]=[];
    const adapter=managedAccessAdapter({provider:'bitbucket',source,bitbucket:{path:'direct_users'},fetch:async(url,init)=>{requests.push({url,method:init?.method??'GET',body:init?.body});return Response.json({});}});
    const ref:RepositoryRef={provider:'bitbucket',host:'bitbucket.org',owner:'workspace',repo:'repo'};
    expect(await adapter.createGroup('workspace','geld-team')).toEqual({ok:false,reason:'unsupported'});
    await adapter.grant(ref,{id:'account:42',login:'outside',permission:'none',organisationMember:false},'read');
    expect(requests[0]).toEqual({url:'https://api.bitbucket.org/2.0/repositories/workspace/repo/permissions-config/users/account%3A42',method:'PUT',body:JSON.stringify({permission:'read'})});
  });
  it('resolves the GitLab parent id and creates one private subgroup',async()=>{
    const requests:{url:string;body:unknown}[]=[];const adapter=managedAccessAdapter({provider:'gitlab',source,fetch:async(url,init)=>{requests.push({url,body:init?.body});return Response.json(requests.length===1?{id:7}:{id:8});}});
    expect(await adapter.createGroup('parent/subgroup','geld-team')).toEqual({ok:true,value:'8'});
    expect(requests[1]?.body).toBe(JSON.stringify({name:'geld-team',path:'geld-team',parent_id:7,visibility:'private'}));
  });
  it('uses a separate customer admin token source for Atlassian group creation',async()=>{
    const seen:string[]=[];const adapter=managedAccessAdapter({provider:'bitbucket',source,bitbucket:{path:'atlassian_groups',organisationId:'org',directoryId:'directory',adminSource:{get:async()=>({status:'ok',token:'customer-admin-test',refreshed:false})}},fetch:async(url,init)=>{seen.push(`${url}|${new Headers(init?.headers).get('Authorization')}`);return Response.json({id:'group'});}});
    expect(await adapter.createGroup('workspace','geld-team')).toEqual({ok:true,value:'group'});
    expect(seen).toEqual(['https://api.atlassian.com/admin/v2/orgs/org/directories/directory/groups|Bearer customer-admin-test']);
  });
});
