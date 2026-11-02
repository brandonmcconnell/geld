import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({stored:false}));
vi.mock('server-only',()=>({}));
vi.mock('next/server',()=>({connection:async()=>undefined}));
vi.mock('./webhooks',async importOriginal=>{const original=await importOriginal<typeof import('./webhooks')>();return {...original,consumePullEvent:async()=>state.stored};});
import { POST as gitlab } from '../app/api/webhooks/gitlab/route';
import { POST as bitbucket } from '../app/api/webhooks/bitbucket/route';
const secret='synthetic-webhook-verification-secret';
beforeEach(()=>{state.stored=false;vi.stubEnv('GITLAB_WEBHOOK_SECRET',secret);vi.stubEnv('BITBUCKET_WEBHOOK_SECRET',secret);});
afterEach(()=>vi.unstubAllEnvs());
describe('durable webhook acknowledgement',()=>{
  it.each(['gitlab','bitbucket'])('asks %s to retry a valid event until storage confirms it',async provider=>{
    const body=JSON.stringify(provider==='gitlab'?{object_kind:'merge_request',project:{id:1},object_attributes:{iid:1,state:'opened',action:'update',last_commit:{id:'head'}}}:{repository:{uuid:'repository'},pullrequest:{id:1,state:'OPEN',source:{commit:{hash:'head'}}}});
    const headers=provider==='gitlab'?{'x-gitlab-token':secret,'x-gitlab-event-uuid':crypto.randomUUID()}:{'x-hub-signature':`sha256=${createHmac('sha256',secret).update(body).digest('hex')}`,'x-request-uuid':crypto.randomUUID(),'x-event-key':'pullrequest:updated'};
    const route=provider==='gitlab'?gitlab:bitbucket;
    const request=()=>new Request(`https://app.geld.sh/api/webhooks/${provider}`,{method:'POST',headers,body});
    expect((await route(request())).status).toBe(503);
    state.stored=true;
    expect((await route(request())).status).toBe(200);
  });
});
