import {auditedRoute} from '@/lib/request-audit';
import { connection } from 'next/server';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { currentActor } from '@/lib/session';
import { teamMembership } from '@/lib/workspaces';
import { database } from '@/lib/db';
import { trackerOAuth,trackerOAuthProvider } from '@/lib/tracker-oauth';
import { encryptCredential } from '@/lib/crypto';
import { resourceDigest } from '@/lib/resource-digest';
import { json,sameOrigin } from '@/lib/http';
async function handlePOST(request:Request):Promise<Response>{await connection();if(!sameOrigin(request))return json({error:'Invalid request origin'},403);const actor=await currentActor();if(!actor)return json({error:'Sign in first'},401);const input=z.object({teamId:z.string(),provider:trackerOAuthProvider}).safeParse(await request.json().catch(()=>null));if(!input.success||!await teamMembership(actor.id,input.data.teamId,true))return json({error:'Team admin permission is required'},403);const config=trackerOAuth(input.data.provider);const db=database();if(!config||!db)return json({error:'This tracker OAuth app is not configured. Link recognition is still available.'},503);const selected=z.object({provider:z.string(),config_version:z.union([z.string(),z.number()])}).safeParse((await db.query('SELECT provider,config_version FROM tracker_connections WHERE team_id=$1',[input.data.teamId])).rows[0]);if(!selected.success||selected.data.provider!==config.provider)return json({error:'Save this tracker choice before connecting'},409);const state=crypto.randomUUID();const verifier=crypto.randomUUID()+crypto.randomUUID();await db.query('INSERT INTO tracker_oauth_flows(id,actor_id,team_id,provider,state_digest,encrypted_verifier,config_version) VALUES($1,$2,$3,$4,$5,$6,$7)',[crypto.randomUUID(),actor.id,input.data.teamId,config.provider,resourceDigest(state),await encryptCredential(verifier),selected.data.config_version]);const url=new URL(config.authorize);url.search=new URLSearchParams({client_id:config.clientId,redirect_uri:config.callback,response_type:'code',state,scope:config.scope,...(config.provider==='asana'||config.provider==='linear'?{code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url')}:{}),...(config.provider==='jira'?{audience:'api.atlassian.com',prompt:'consent'}:{})}).toString();return json({url:url.toString()});}

export const POST=auditedRoute(handlePOST,'tracker.connect.post');
