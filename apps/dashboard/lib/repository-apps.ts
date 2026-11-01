import 'server-only';
import { createHash, createSign } from 'node:crypto';
import { z } from 'zod';
import { createApiTransport } from '@geld/github';
import type { TokenSource } from '@geld/github';
import { database } from './db';
import { githubEndpoints } from '@geld/domain';
import { enterpriseFetch } from './enterprise';
import { transaction, type SqlExecutor } from './transactions';
import { configured,dashboardOrigin } from './env';
import { decryptCredential,encryptCredential } from './crypto';
export const appOptionsSchema=z.object({managedAccess:z.boolean(),merge:z.boolean(),settings:z.boolean(),deletion:z.boolean(),host:z.string().optional()});
export function appPermissions(input:z.infer<typeof appOptionsSchema>):Record<string,string>{return{contents:input.merge?'write':'read',metadata:'read',pull_requests:'write',issues:'write',...(input.settings||input.deletion||input.managedAccess?{administration:'write'}:{}),...(input.managedAccess?{members:'write'}:{})};}
export function permissionFingerprint(permissions:Record<string,string>):string{return createHash('sha256').update(JSON.stringify(Object.entries(permissions).sort(([a],[b])=>a.localeCompare(b)))).digest('hex');}
export const registrySchema=z.object({id:z.string(),host:z.string(),app_id:z.string(),slug:z.string(),client_id:z.string(),encrypted_secret:z.string(),encrypted_private_key:z.string(),encrypted_webhook_secret:z.string(),permissions:z.record(z.string(),z.string()),fingerprint:z.string()});
export type RepositoryApp=z.infer<typeof registrySchema>;
export function appOwner(userId:string):boolean{return(configured(process.env.GITHUB_APP_OWNER_IDS)??'').split(',').includes(userId);}
export function manifestFor(options:z.infer<typeof appOptionsSchema>){const permissions=appPermissions(options);const fingerprint=permissionFingerprint(permissions);return{fingerprint,manifest:{name:`Geld Repositories ${fingerprint.slice(0,8)}`,url:'https://www.geld.sh',hook_attributes:{url:`${dashboardOrigin()}/api/webhooks/github${options.host&&options.host!=='github.com'?`?host=${encodeURIComponent(options.host)}`:''}`,active:true},redirect_url:`${dashboardOrigin()}/api/apps/callback`,callback_urls:[`${dashboardOrigin()}/api/apps/authorize`],setup_url:`${dashboardOrigin()}/api/apps/installed`,setup_on_update:true,public:true,default_permissions:permissions,default_events:['pull_request','pull_request_review','pull_request_review_comment','push','installation','installation_repositories','membership','member']}};}
export async function appTokenSource(app:RepositoryApp):Promise<TokenSource>{return{async get(){const key=await decryptCredential(app.encrypted_private_key);if(!key)return{status:'unavailable',message:'Repository App key is unavailable'};const now=Math.floor(Date.now()/1000);const header=Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT'})).toString('base64url');const payload=Buffer.from(JSON.stringify({iat:now-30,exp:now+540,iss:app.app_id})).toString('base64url');try{const unsigned=`${header}.${payload}`;const signature=createSign('RSA-SHA256').update(unsigned).sign(key,'base64url');return{status:'ok',token:`${unsigned}.${signature}`,refreshed:true};}catch{return{status:'unavailable',message:'Repository App key is unavailable'};}}};}
export async function installationTokenSource(app:RepositoryApp,installationId:string,repositoryIds?:readonly number[],permissions?:Readonly<Record<string,string>>):Promise<TokenSource>{return{async get(){const api=createApiTransport({baseUrl:githubEndpoints(app.host).api,source:await appTokenSource(app),...(app.host!=='github.com'?{fetch:await enterpriseFetch(app.host)}:{})});const r=await api.request(`app/installations/${encodeURIComponent(installationId)}/access_tokens`,{method:'POST',body:{permissions:permissions??app.permissions,...(repositoryIds?{repository_ids:repositoryIds}:{})}});if(!r.ok)return{status:'unavailable',message:'Repository installation access is unavailable'};const token=z.object({token:z.string(),expires_at:z.string()}).safeParse(r.value);return token.success?{status:'ok',token:token.data.token,refreshed:true}:{status:'unavailable',message:'Repository installation access is unavailable'};}};}
const userTokenSchema = z.object({ encrypted_access: z.string(), encrypted_refresh: z.string().nullable(), expires_at: z.date().nullable(), client_id: z.string(), encrypted_secret: z.string(), app_id: z.string(), host:z.string() });
export async function storedAppUserSource(userId: string, owner?: string, hostOrDependencies: string | { readonly sql: SqlExecutor; readonly run: <T>(work: (sql: SqlExecutor) => Promise<T>) => Promise<T> }='github.com', appId?:string): Promise<TokenSource | null> {
  const host=typeof hostOrDependencies==='string'?hostOrDependencies:'github.com';
  const dependencies=typeof hostOrDependencies==='string'?undefined:hostOrDependencies;
  const pool = dependencies ? null : database();
  const db = dependencies?.sql ?? pool;
  if (!db) return null;
  const run = dependencies?.run ?? (<T>(work: (sql: SqlExecutor) => Promise<T>) => { if (!pool) throw new Error('App storage is unavailable'); return transaction(pool,work); });
  const ids = z.array(z.object({ app_id: z.string() })).parse((await db.query(`SELECT t.app_id FROM app_user_tokens t JOIN repository_apps a ON a.id=t.app_id WHERE t.user_id=$1 AND a.host=$3 AND ($4::text IS NULL OR t.app_id=$4) AND (t.reader_authorized OR EXISTS(SELECT 1 FROM app_installations i WHERE i.registry_id=a.id AND ($2::text IS NULL OR lower(i.account_slug)=lower($2)) AND i.state='verified')) ORDER BY t.expires_at DESC NULLS FIRST,t.app_id`, [userId, owner ?? null,host,appId??null])).rows);
  const sources: TokenSource[] = ids.map(({ app_id: appId }) => ({
    async get(options = {}) {
      try {
        return await run(async sql => {
          const row = userTokenSchema.safeParse((await sql.query('SELECT t.*,a.host,a.client_id,a.encrypted_secret FROM app_user_tokens t JOIN repository_apps a ON a.id=t.app_id WHERE t.user_id=$1 AND t.app_id=$2 FOR UPDATE OF t', [userId, appId])).rows[0]);
          if (!row.success) return { status: 'signed-out', reason: 'Reconnect repository access' };
          const r = row.data;
          if (options.force || r.expires_at && r.expires_at.getTime() < Date.now() + 60000) {
            if (!r.encrypted_refresh) return { status: 'signed-out', reason: 'Reconnect repository access' };
            const refresh = await decryptCredential(r.encrypted_refresh);
            const secret = await decryptCredential(r.encrypted_secret);
            if (!refresh || !secret) return { status: 'unavailable', message: 'Reconnect repository access' };
            const api = createApiTransport({ baseUrl: `${githubEndpoints(r.host).web}login/oauth/`, source: { get: async () => ({ status: 'signed-out', reason: 'OAuth refresh' }) }, anonymousWrites: true, fetch: r.host!=='github.com'?await enterpriseFetch(r.host):(url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(15000) }) });
            const result = await api.request('access_token', { method: 'POST', body: { client_id: r.client_id, client_secret: secret, grant_type: 'refresh_token', refresh_token: refresh } });
            if (!result.ok) return { status: 'unavailable', message: 'Reconnect repository access' };
            const token = z.object({ access_token: z.string(), refresh_token: z.string().optional(), expires_in: z.number().optional() }).safeParse(result.value);
            if (!token.success) return { status: 'signed-out', reason: 'Reconnect repository access' };
            await sql.query('UPDATE app_user_tokens SET encrypted_access=$3,encrypted_refresh=$4,expires_at=$5 WHERE user_id=$1 AND app_id=$2', [userId, appId, await encryptCredential(token.data.access_token), token.data.refresh_token ? await encryptCredential(token.data.refresh_token) : r.encrypted_refresh, token.data.expires_in ? new Date(Date.now() + token.data.expires_in * 1000) : null]);
            return { status: 'ok', token: token.data.access_token, refreshed: true };
          }
          const token = await decryptCredential(r.encrypted_access);
          return token ? { status: 'ok', token, refreshed: false } : { status: 'unavailable', message: 'Reconnect repository access' };
        });
      } catch { return { status: 'unavailable', message: 'Repository access could not be verified' }; }
    },
  }));
  const [first, ...alternatives] = sources;
  return first ? { get: options => first.get(options), alternatives } : null;
}
