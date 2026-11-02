import {clusterComments} from './cluster';
import type {RawComment} from './cluster';
import type {ReviewItem} from './model';
import {botByLogin,isReviewShaped,parseBotBody} from './bots';
interface Comment{readonly id:string;readonly databaseId?:number|undefined;readonly createdAt?:string|undefined;readonly author:string;readonly body:string;readonly url:string;readonly path:string|null;readonly line:number|null}
interface Thread{readonly id:string;readonly path:string|null;readonly line:number|null;readonly resolved:boolean;readonly outdated:boolean;readonly comments:readonly Comment[]}
export interface FindingSource{readonly anchor:string;readonly url:string;readonly threadId:string|null}
export interface FindingDraft{readonly items:readonly ReviewItem[];readonly raw:readonly RawComment[];readonly sources:readonly FindingSource[];readonly omitted:number}
function numericId(comment:Comment):number|null{const value=comment.databaseId??(/^\d+$/.test(comment.id)?Number(comment.id):null);return value!==null&&Number.isSafeInteger(value)&&value>0?value:null;}
export function providerFindings(threads:readonly Thread[],comments:readonly Comment[]):FindingDraft{
 const raw:RawComment[]=[];const sources:FindingSource[]=[];let omitted=0;
 for(const thread of threads){const first=thread.comments[0];if(!first)continue;const id=numericId(first);if(id===null){omitted++;continue;}
  const peers=thread.comments.flatMap(comment=>{const id=numericId(comment);if(id===null){omitted++;return[];}const anchor=`discussion_r${id}`;sources.push({anchor,url:comment.url,threadId:thread.id});return[{anchor,kind:'thread',author:comment.author,body:comment.body} satisfies import('./cluster').ThreadPeer];});
  raw.push({anchor:`discussion_r${id}`,kind:'thread',author:first.author,body:first.body,createdAt:first.createdAt??'',...(thread.path?{path:thread.path}:{}),...(thread.line?{line:thread.line}:{}),isResolved:thread.resolved,isOutdated:thread.outdated,threadAnchors:peers});
 }
 for(const comment of comments){const id=numericId(comment);if(id===null){omitted++;continue;}if(sources.some(source=>source.threadId!==null&&source.anchor===`discussion_r${id}`))continue;const anchor=`issuecomment-${id}`;sources.push({anchor,url:comment.url,threadId:null});raw.push({anchor,kind:'comment',author:comment.author,body:comment.body,createdAt:comment.createdAt??''});}
 return{items:clusterComments(raw),raw,sources,omitted};
}
export function sourceThreads(draft:FindingDraft,item:ReviewItem):readonly string[]{const anchors=new Set(item.sources.map(source=>source.anchor));return[...new Set(draft.sources.filter(source=>anchors.has(source.anchor)&&source.threadId!==null).flatMap(source=>source.threadId?[source.threadId]:[]))];}
/** A source-body revision check, calculated transiently in browser and server. Never an analytics identifier. */
export async function findingFingerprint(draft:FindingDraft,item:ReviewItem):Promise<string>{const anchors=new Set(item.sources.map(source=>source.anchor));const raw=draft.raw.filter(comment=>anchors.has(comment.anchor)||comment.threadAnchors?.some(peer=>anchors.has(peer.anchor))).sort((a,b)=>a.anchor.localeCompare(b.anchor));const data=new TextEncoder().encode(JSON.stringify(raw));return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),byte=>byte.toString(16).padStart(2,'0')).join('');}
export function agentStructure(draft:FindingDraft):readonly {readonly agent:string;readonly count:number;readonly severity:'high'|'medium'|'low'|'unknown';readonly recognised:boolean}[]{return draft.raw.flatMap(comment=>{const bot=botByLogin(comment.author);if(!bot)return[];const parsed=parseBotBody(comment.body,bot.id);return[{agent:bot.id,count:Math.min(10000,parsed.count??draft.items.filter(item=>item.sources.some(source=>source.bot===bot.id)).length),severity:parsed.severity??'unknown',recognised:isReviewShaped(parsed)}];});}
