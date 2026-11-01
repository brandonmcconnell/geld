/** Read-only tracker recognition shared by the dashboard, extension and Action. */
export const ISSUE_TRACKERS=['linear','jira','github_issues','github_projects','gitlab','bitbucket','youtrack','asana','monday'] as const;
export type IssueTracker=typeof ISSUE_TRACKERS[number];
export interface IssueTrackerConfig {readonly provider:IssueTracker;readonly keys:readonly string[];readonly baseUrl?:string;readonly workspace?:string}
export interface TrackerReference {readonly provider:IssueTracker;readonly id:string;readonly url:string;readonly repository?:string;readonly status?:string}
export interface TrackerRepository {readonly provider:'github'|'gitlab'|'bitbucket';readonly host:string;readonly owner:string;readonly repo:string}
function record(value:unknown):value is Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value);}
export function parseIssueTracker(value:unknown):IssueTrackerConfig|null {
  if(!record(value)||typeof value.provider!=='string'||!ISSUE_TRACKERS.some(p=>p===value.provider)||!Array.isArray(value.keys)||value.keys.length>100||!value.keys.every((key:unknown)=>typeof key==='string'&&/^[A-Za-z0-9_.:/-]{1,150}$/.test(key)))return null;
  const provider=ISSUE_TRACKERS.find(p=>p===value.provider);if(!provider)return null;
  if(Object.keys(value).some(k=>!['provider','keys','baseUrl','workspace'].includes(k)))return null;
  if(value.workspace!==undefined&&(typeof value.workspace!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(value.workspace)))return null;
  if(value.baseUrl!==undefined){if(typeof value.baseUrl!=='string')return null;try{const u=new URL(value.baseUrl);if(u.protocol!=='https:'||u.username||u.password||u.port||u.search||u.hash||u.pathname!=='/')return null;}catch{return null;}}
  return{provider,keys:value.keys,...(typeof value.baseUrl==='string'?{baseUrl:value.baseUrl.replace(/\/$/,'')}:{}),...(typeof value.workspace==='string'?{workspace:value.workspace}:{})};
}
export function withoutCode(text:string):string {
  const lines=text.split('\n');let fence:string|null=null;const out:string[]=[];
  for(const line of lines){const marker=/^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];if(marker){if(!fence)fence=marker;else if(marker[0]===fence[0]&&marker.length>=fence.length)fence=null;out.push('');continue;}out.push(fence?'':line);}
  return out.join('\n').replace(/(`+)[\s\S]*?\1/g,' ');
}
export function recognizeTickets(text:string,repository:TrackerRepository,config?:IssueTrackerConfig|null):readonly TrackerReference[]{
  const source=withoutCode(text).slice(0,200000);const found=new Map<string,TrackerReference>();const repo=`${repository.owner}/${repository.repo}`;
  function add(provider:IssueTracker,id:string,url:string,scope?:string){if(found.size>=50)return;try{const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password)return;const reference={provider,id,url:u.toString(),...(scope?{repository:scope}:{})};found.set(`${provider}:${u.origin}:${id}:${scope??''}`,reference);}catch{}}
  function allowedScope(scope:string){return scope.toLowerCase()===repo.toLowerCase()||!!config?.keys.some(key=>key.toLowerCase()===scope.toLowerCase());}
  const ownProvider:IssueTracker=repository.provider==='github'?'github_issues':repository.provider;
  for(const match of source.matchAll(/https:\/\/[^\s<>\[\]()`]+/g)){
    let u:URL;try{u=new URL(match[0].replace(/[.,;!?]+$/,''));}catch{continue;}if(u.username||u.password||u.port)continue;const path=u.pathname;
    let m:RegExpExecArray|null;
    if((u.hostname==='github.com'||u.hostname===repository.host&&repository.provider==='github')&&(m=/^\/([^/]+)\/([^/]+)\/issues\/([1-9]\d*)(?:\/|$)/.exec(path))){const scope=`${m[1]}/${m[2]}`;if(allowedScope(scope))add('github_issues',m[3]??'',`${u.origin}/${scope}/issues/${m[3]}`,scope);}
    else if(config?.provider==='github_projects'&&u.hostname==='github.com'&&(m=/^\/(orgs|users)\/([^/]+)\/projects\/([1-9]\d*)/.exec(path))&&config.keys.includes(`${m[2]}/${m[3]}`))add('github_projects',m[3]??'',`${u.origin}/${m[1]}/${m[2]}/projects/${m[3]}`,`${m[1]}/${m[2]}/${m[3]}`);
    else if((u.hostname==='gitlab.com'||u.hostname===repository.host&&repository.provider==='gitlab')&&(m=/^\/(.+)\/-\/issues\/([1-9]\d*)/.exec(path))&&allowedScope(m[1]??''))add('gitlab',m[2]??'',`${u.origin}/${m[1]}/-/issues/${m[2]}`,m[1]);
    else if(u.hostname==='bitbucket.org'&&(m=/^\/([^/]+\/[^/]+)\/issues\/([1-9]\d*)/.exec(path))&&allowedScope(m[1]??''))add('bitbucket',m[2]??'',`${u.origin}/${m[1]}/issues/${m[2]}`,m[1]);
    else if(config?.provider==='linear'&&u.hostname==='linear.app'&&(m=/^\/([^/]+)\/issue\/([A-Za-z][A-Za-z0-9_]*-\d+)/.exec(path))&&m[1]===config.workspace&&config.keys.includes((m[2]??'').replace(/-\d+$/,'')))add('linear',m[2]??'',`${u.origin}/${m[1]}/issue/${m[2]}`);
    else if(config?.provider==='jira'&&u.origin===config.baseUrl&&(m=/^\/browse\/([A-Z][A-Z0-9_]*-\d+)/.exec(path))&&config.keys.includes((m[1]??'').replace(/-\d+$/,'')))add('jira',m[1]??'',`${u.origin}/browse/${m[1]}`);
    else if(config?.provider==='youtrack'&&u.origin===config.baseUrl&&(m=/^\/issue\/([A-Za-z][A-Za-z0-9_]*-\d+)/.exec(path))&&config.keys.includes((m[1]??'').replace(/-\d+$/,'')))add('youtrack',m[1]??'',`${u.origin}/issue/${m[1]}`);
    else if(config?.provider==='asana'&&u.hostname==='app.asana.com'){
      m=/^\/0\/([0-9]+)\/([0-9]+)/.exec(path)??/^\/1\/([0-9]+)\/project\/([0-9]+)\/task\/([0-9]+)/.exec(path);
      if(m&&(config.keys.includes(m[1]??'')||(m[3]!==undefined&&config.keys.includes(m[2]??''))))add('asana',m[3]??m[2]??'',u.toString());
      const direct=/^\/1\/([0-9]+)\/task\/([0-9]+)/.exec(path);if(direct&&config.keys.includes(direct[1]??''))add('asana',direct[2]??'',u.toString());
    }
    else if(config?.provider==='monday'&&u.origin===config.baseUrl&&(m=/^\/boards\/([0-9]+)\/pulses\/([0-9]+)/.exec(path))&&config.keys.includes(m[1]??''))add('monday',m[2]??'',`${u.origin}/boards/${m[1]}/pulses/${m[2]}`);
  }
  // Bare #123 always refers to the PR's own Git provider, including when an external tracker is selected.
  const nonUrls=source.replace(/https:\/\/[^\s]+/g,' ');
  for(const m of nonUrls.matchAll(/(?:^|[\s([{])#([1-9]\d*)\b/g)){const id=m[1];if(id)add(ownProvider,id,`https://${repository.host}/${repo}/${repository.provider==='gitlab'?'-/issues':'issues'}/${id}`,repo);}
  if(config&&['linear','jira','youtrack'].includes(config.provider))for(const m of nonUrls.matchAll(/\b([A-Za-z][A-Za-z0-9_]*?)-([1-9]\d*)\b/g)){
    const key=config.keys.find(k=>k.toLowerCase()===m[1]?.toLowerCase());if(!key)continue;const id=`${key}-${m[2]}`;const url=config.provider==='linear'&&config.workspace?`https://linear.app/${config.workspace}/issue/${id}`:config.baseUrl?`${config.baseUrl}/${config.provider==='jira'?'browse':'issue'}/${id}`:null;if(url)add(config.provider,id,url);
  }
  return[...found.values()];
}
export const TRACKER_LABELS:Readonly<Record<IssueTracker,string>>={linear:'Linear',jira:'Jira',github_issues:'GitHub Issues',github_projects:'GitHub Projects',gitlab:'GitLab issues',bitbucket:'Bitbucket issues',youtrack:'YouTrack',asana:'Asana',monday:'Monday'};
