import { describe,expect,it } from 'vitest';
import { createProviderClient } from './client';
describe('GitLab finding permalinks',()=>{
  it('links both discussion notes and general comments to their merge request source',async()=>{
    const ref={provider:'gitlab',host:'gitlab.com',owner:'org/subgroup',repo:'private.repo',number:12} satisfies Parameters<ReturnType<typeof createProviderClient>['comments']>[0];
    const client=createProviderClient({provider:'gitlab',source:{get:async()=>({status:'ok',token:'synthetic',refreshed:false})},fetch:async url=>Response.json(url.includes('/discussions')?[{id:'discussion',notes:[{id:41,body:'Full source concern',author:{username:'reviewer'},resolvable:true,resolved:false,position:{new_path:'src/file.ts',old_path:'src/file.ts',new_line:5}}]}]:[{id:42,body:'General source',author:{username:'reviewer'}}])});
    const threads=await client.threads(ref);const comments=await client.comments(ref);
    expect(threads.ok&&threads.value[0]?.comments[0]?.url).toBe('https://gitlab.com/org/subgroup/private.repo/-/merge_requests/12#note_41');
    expect(comments.ok&&comments.value[0]?.url).toBe('https://gitlab.com/org/subgroup/private.repo/-/merge_requests/12#note_42');
  });
});
