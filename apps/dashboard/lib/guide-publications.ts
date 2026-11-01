import type { SqlExecutor } from './transactions';
import type { GeneratedContentStore } from './content-store';
import { finishCredits } from './credits';
export async function recoverGuideCredits(input: { readonly sql: SqlExecutor; readonly run: <T>(work: (sql: SqlExecutor) => Promise<T>) => Promise<T>; readonly store: () => Pick<GeneratedContentStore,'hasPublication'>; readonly reservationId: string }): Promise<void> {
  const publication = await input.sql.query('SELECT reservation_id FROM guide_publications WHERE reservation_id=$1',[input.reservationId]);
  const completed = publication.rows.length>0 && await input.store().hasPublication(input.reservationId);
  await input.run(sql => finishCredits(sql,input.reservationId,completed));
}

export async function recordGuidePublication(sql:SqlExecutor,input:{readonly reservationId:string;readonly teamId:string;readonly repoId:string;readonly fingerprint:string;readonly headSha:string;readonly claim:{readonly id:string;readonly token:string}}):Promise<void> {
  const owned=await sql.query("UPDATE outbox_jobs SET locked_at=now() WHERE id=$1 AND lock_token=$2 AND state='running' RETURNING id",[input.claim.id,input.claim.token]);
  if(!owned.rows.length)throw new Error('The guide job claim changed');
  const reserved=await sql.query("UPDATE credit_reservations SET resource_fingerprint=$2,head_sha=$3 WHERE id=$1 AND team_id=$4 AND state='reserved' RETURNING id",[input.reservationId,input.fingerprint,input.headSha,input.teamId]);
  if(!reserved.rows.length)throw new Error('The guide reservation changed');
  await sql.query('INSERT INTO guide_publications(reservation_id,team_id,repo_id) VALUES($1,$2,$3)',[input.reservationId,input.teamId,input.repoId]);
}
