import 'server-only';
import { trackerOAuthSource } from './tracker-oauth';
import { githubEndpoints } from '@geld/domain';
import { enterpriseFetch } from './enterprise';
import { z } from 'zod';
import { parseIssueTracker } from '@geld/core';
import type { IssueTrackerConfig, TrackerReference } from '@geld/core';
import { createApiTransport } from '@geld/github';
import type { TokenSource } from '@geld/github';
import { database } from './db';
import { decryptCredential } from './crypto';
import { configured } from './env';
import { providerTokenSource } from './session';
export interface TrackerConnection {readonly config:IssueTrackerConfig;readonly source:TokenSource|null;readonly cloudId?:string}
export async function trackerConnection(teamId:string):Promise<TrackerConnection|null>{const db=database();if(!db)return null;const row=z.object({provider:z.string(),config_version:z.union([z.number(),z.string()]),allowed_keys:z.array(z.string()),base_url:z.string().nullable(),settings:z.object({workspace:z.string().optional(),cloudId:z.string().optional(),oauth:z.boolean().optional()}),encrypted_credential:z.string().nullable()}).safeParse((await db.query('SELECT * FROM tracker_connections WHERE team_id=$1',[teamId])).rows[0]);if(!row.success)return null;const r=row.data;const config=parseIssueTracker({provider:r.provider,keys:r.allowed_keys,...(r.base_url?{baseUrl:r.base_url}:{}),...(r.settings.workspace?{workspace:r.settings.workspace}:{})});if(!config)return null;const token=r.encrypted_credential?await decryptCredential(r.encrypted_credential):null;return{config,...(r.settings.cloudId?{cloudId:r.settings.cloudId}:{}),source:token?trackerOAuthSource(teamId,{provider:r.provider,version:r.config_version}):null};}
export function allowedTrackerOrigin(provider:string,raw:string):boolean{try{const u=new URL(raw);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&(provider==='jira'&&u.hostname.endsWith('.atlassian.net')||provider==='youtrack'&&(u.hostname.endsWith('.youtrack.cloud')||(configured(process.env.TRACKER_ALLOWED_HOSTS)??'').split(',').includes(u.hostname)));}catch{return false;}}
/** Fixed GETs and GraphQL queries only. No ticket mutation is exposed. */
export async function trackerStatus(reference:TrackerReference,connection:TrackerConnection|null):Promise<string|null>{
  const p=reference.provider;const e=encodeURIComponent;
  if(p==='github_issues'||p==='gitlab'||p==='bitbucket'){
    if(!reference.repository)return null;const host=new URL(reference.url).hostname;const source=await providerTokenSource(p==='github_issues'?'github':p,reference.repository.split('/')[0],false,host);const api=createApiTransport({baseUrl:p==='github_issues'?githubEndpoints(host).api:p==='gitlab'?'https://gitlab.com/api/v4/':'https://api.bitbucket.org/2.0/',source,anonymousReads:true,...(p==='github_issues'&&host!=='github.com'?{fetch:await enterpriseFetch(host)}:{})});
    const path=p==='github_issues'?`repos/${reference.repository.split('/').map(e).join('/')}/issues/${e(reference.id)}`:p==='gitlab'?`projects/${e(reference.repository)}/issues/${e(reference.id)}`:`repositories/${reference.repository.split('/').map(e).join('/')}/issues/${e(reference.id)}`;const result=await api.request(path);if(!result.ok)return null;const parsed=z.object({state:z.string()}).safeParse(result.value);return parsed.success?parsed.data.state:null;
  }
  if(p==='github_projects'){
    const url=new URL(reference.url);const path=/^\/(orgs|users)\/([^/]+)\/projects\/(\d+)/.exec(url.pathname);if(!path)return null;
    const api=createApiTransport({baseUrl:'https://api.github.com/',source:await providerTokenSource('github',path[2])});const owner=path[1]==='orgs'?'organization':'user';
    const result=await api.request('graphql',{method:'POST',body:{query:`query ProjectStatus($login:String!,$number:Int!){${owner}(login:$login){projectV2(number:$number){closed}}}`,variables:{login:path[2],number:Number(path[3])}}});if(!result.ok)return null;const value=z.object({data:z.record(z.string(),z.object({projectV2:z.object({closed:z.boolean()}).nullable()}).nullable())}).safeParse(result.value);const project=value.success?value.data.data[owner]?.projectV2:null;return project?project.closed?'Closed':'Open':null;
  }
  if(!connection?.source||connection.config.provider!==p)return null;
  const config=connection.config;
  const base=p==='linear'?'https://api.linear.app/':p==='asana'?'https://app.asana.com/api/1.0/':p==='monday'?'https://api.monday.com/':p==='jira'&&connection.cloudId?`https://api.atlassian.com/ex/jira/${encodeURIComponent(connection.cloudId)}/rest/api/3/`:config.baseUrl&&allowedTrackerOrigin(p,config.baseUrl)?`${config.baseUrl}/${p==='jira'?'rest/api/3/':'api/'}`:null;if(!base)return null;
  const api=createApiTransport({baseUrl:base,source:connection.source});
  const result=p==='linear'?await api.request('graphql',{method:'POST',body:{query:'query IssueStatus($id: String!) { issue(id: $id) { identifier state { name } } }',variables:{id:reference.id}}}):p==='monday'?await api.request('v2',{method:'POST',body:{query:'query ItemStatus($ids: [ID!]!) { items(ids: $ids) { board { id } column_values(types: [status]) { text } } }',variables:{ids:[reference.id]}}}):await api.request(p==='jira'?`issue/${e(reference.id)}?fields=status`:p==='youtrack'?`issues/${e(reference.id)}?fields=resolved`:`tasks/${e(reference.id)}?opt_fields=completed,workspace.gid,projects.gid`);
  if(!result.ok)return null;
  if(p==='linear'){const value=z.object({data:z.object({issue:z.object({identifier:z.string(),state:z.object({name:z.string()})}).nullable()})}).safeParse(result.value);return value.success&&value.data.data.issue?.identifier.toLowerCase()===reference.id.toLowerCase()?value.data.data.issue.state.name:null;}
  if(p==='jira'){const value=z.object({fields:z.object({status:z.object({name:z.string()})})}).safeParse(result.value);return value.success?value.data.fields.status.name:null;}
  if(p==='youtrack'){const value=z.object({resolved:z.number().nullable()}).safeParse(result.value);return value.success?value.data.resolved===null?'Open':'Resolved':null;}
  if(p==='asana'){const value=z.object({data:z.object({completed:z.boolean(),workspace:z.object({gid:z.string()}),projects:z.array(z.object({gid:z.string()}))})}).safeParse(result.value);return value.success&&config.keys.some(key=>key===value.data.data.workspace.gid||value.data.data.projects.some(p=>p.gid===key))?value.data.data.completed?'Completed':'Open':null;}
  const value=z.object({data:z.object({items:z.array(z.object({board:z.object({id:z.string()}),column_values:z.array(z.object({text:z.string().nullable()}))}))})}).safeParse(result.value);const item=value.success?value.data.data.items[0]:null;return item&&config.keys.includes(item.board.id)&&new URL(reference.url).pathname.split('/')[2]===item.board.id?item.column_values.map(c=>c.text).filter(Boolean).join(' · ')||null:null;
}
