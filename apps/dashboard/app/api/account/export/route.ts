import { connection } from 'next/server';
import { currentActor } from '@/lib/session';
import { database } from '@/lib/db';
import { json } from '@/lib/http';
export async function GET():Promise<Response>{
  await connection();const actor=await currentActor();if(!actor)return json({error:'Sign in first'},401);const db=database();if(!db)return json({error:'Account storage is not configured'},503);
  const [identities,teams,assignments,grants,requests,consent,preferences,providers,receipts]=await Promise.all([
    db.query('SELECT "providerId","accountId",scope,"createdAt" FROM identities WHERE "userId"=$1',[actor.id]),db.query('SELECT team_id,role,created_at FROM team_members WHERE user_id=$1',[actor.id]),db.query('SELECT * FROM assignments WHERE reviewer_id=$1',[actor.id]),db.query('SELECT id,team_id,repo_id,permission,source,state,created_at,revoked_at FROM grants WHERE user_id=$1',[actor.id]),db.query('SELECT id,team_id,repo_id,kind,state,created_at,expires_at FROM access_requests WHERE requester_id=$1',[actor.id]),db.query('SELECT policy_version,measurement,created_at FROM consent_records WHERE user_id=$1',[actor.id]),db.query('SELECT settings FROM users WHERE id=$1',[actor.id]),db.query('SELECT id,provider,label,enabled FROM ai_providers WHERE user_id=$1',[actor.id]),db.query('SELECT id,provider,action,outcome,created_at FROM review_receipts WHERE user_id=$1',[actor.id]),
  ]);
  return Response.json({exportedAt:new Date().toISOString(),account:actor,identities:identities.rows,teams:teams.rows,assignments:assignments.rows,grants:grants.rows,requests:requests.rows,consent:consent.rows,preferences:preferences.rows,aiProviders:providers.rows,reviewReceipts:receipts.rows},{headers:{'Content-Disposition':'attachment; filename="geld-account.json"','Cache-Control':'private, no-store'}});
}
