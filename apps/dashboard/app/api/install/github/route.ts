import {connection} from 'next/server';
import {z} from 'zod';
import {currentActor} from '@/lib/session';
import {database} from '@/lib/db';
import {importConfiguredRepositoryApp} from '@/lib/configured-app';
import {appPermissions,permissionFingerprint} from '@/lib/repository-apps';
import {resourceDigest} from '@/lib/resource-digest';
import {dashboardOrigin} from '@/lib/env';
export async function GET():Promise<Response>{await connection();const actor=await currentActor();if(!actor)return Response.redirect(new URL('/sign-in',dashboardOrigin()));const db=database();if(!db)return Response.redirect(new URL('/connect?repository=setup-needed',dashboardOrigin()));await importConfiguredRepositoryApp();const fingerprint=permissionFingerprint(appPermissions({managedAccess:false,merge:false,settings:false,deletion:false}));const app=z.object({id:z.string(),slug:z.string()}).safeParse((await db.query("SELECT id,slug FROM repository_apps WHERE host='github.com' ORDER BY CASE WHEN fingerprint=$1 THEN 0 ELSE 1 END,length(permissions::text),id LIMIT 1",[fingerprint])).rows[0]);if(!app.success)return Response.redirect(new URL('/connect?repository=setup-needed',dashboardOrigin()));const team=z.object({id:z.string()}).parse((await db.query('SELECT id FROM teams WHERE personal_owner_id=$1',[actor.id])).rows[0]);const state=crypto.randomUUID();await db.query("INSERT INTO app_flows(id,actor_id,team_id,kind,app_id,state_digest,settings) VALUES($1,$2,$3,'install',$4,$5,'{\"selectRepositories\":true}')",[crypto.randomUUID(),actor.id,team.id,app.data.id,resourceDigest(state)]);return Response.redirect(`https://github.com/apps/${app.data.slug}/installations/new?state=${state}`);}
