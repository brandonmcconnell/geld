import { z } from 'zod';
import type { SqlExecutor } from './transactions';
export async function prepareInstallationMigration(sql: SqlExecutor, input: { readonly teamId: string; readonly oldId: string; readonly newId: string }): Promise<'shared' | 'exclusive' | 'changed'> {
  const rows = z.array(z.object({ id: z.string(), state: z.string() })).parse((await sql.query('SELECT id,state FROM app_installations WHERE id=ANY($1) ORDER BY id FOR UPDATE', [[input.oldId,input.newId]])).rows);
  const old = rows.find(row => row.id===input.oldId);
  const next = rows.find(row => row.id===input.newId);
  if (!old || !next || !['verified','migrating'].includes(old.state) || next.state!=='verified') return 'changed';
  const links = z.array(z.object({ team_id: z.string(), installation_id: z.string() })).parse((await sql.query('SELECT team_id,installation_id FROM team_app_installations WHERE installation_id=ANY($1)',[[input.oldId,input.newId]])).rows);
  if (![input.oldId,input.newId].every(id=>links.some(link=>link.installation_id===id && link.team_id===input.teamId))) return 'changed';
  if (links.some(link=>link.installation_id===input.oldId && link.team_id!==input.teamId)) {
    await sql.query('DELETE FROM team_app_installations WHERE team_id=$1 AND installation_id=$2',[input.teamId,input.oldId]);
    return 'shared';
  }
  await sql.query("UPDATE app_installations SET state='migrating' WHERE id=$1",[input.oldId]);
  return 'exclusive';
}
export async function linkVerifiedInstallation(sql: SqlExecutor, input: { readonly id: string; readonly externalId: string; readonly appId: string; readonly fingerprint: string; readonly registryId: string; readonly owner: string; readonly host?:string; readonly permissions: Readonly<Record<string,string>> }): Promise<string | null> {
  const row = z.object({ id: z.string() }).safeParse((await sql.query("INSERT INTO app_installations(id,provider,host,external_id,app_id,permission_fingerprint,state,registry_id,account_slug,permissions) VALUES($1,'github',$8,$2,$3,$4,'verified',$5,$6,$7) ON CONFLICT(provider,host,external_id) DO UPDATE SET state='verified',permissions=EXCLUDED.permissions WHERE app_installations.state NOT IN('migrating','retired') RETURNING id",[input.id,input.externalId,input.appId,input.fingerprint,input.registryId,input.owner,JSON.stringify(input.permissions),input.host??'github.com'])).rows[0]);
  return row.success ? row.data.id : null;
}
