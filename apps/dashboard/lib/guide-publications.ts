import { z } from 'zod';
import type { SqlExecutor } from './transactions';
import type { GeneratedContentStore } from './content-store';
import { finishCredits } from './credits';

/** Serialize publication and recovery before consulting the separate customer database. */
export async function recoverGuideCredits(input: {
  readonly sql: SqlExecutor;
  readonly run: <T>(work: (sql: SqlExecutor) => Promise<T>) => Promise<T>;
  readonly store: () => Pick<GeneratedContentStore, 'hasPublication'>;
  readonly reservationId: string;
}): Promise<void> {
  const reservation = z
    .object({ team_id: z.string() })
    .safeParse(
      (await input.sql.query('SELECT team_id FROM credit_reservations WHERE id=$1', [input.reservationId])).rows[0],
    );
  if (!reservation.success) return;
  await input.run(async (sql) => {
    await sql.query('SELECT id FROM teams WHERE id=$1 FOR NO KEY UPDATE', [reservation.data.team_id]);
    const reserved = await sql.query("SELECT id FROM credit_reservations WHERE id=$1 AND state='reserved' FOR UPDATE", [
      input.reservationId,
    ]);
    if (!reserved.rows.length) return;
    const publication = await sql.query('SELECT reservation_id FROM guide_publications WHERE reservation_id=$1', [
      input.reservationId,
    ]);
    // An unavailable store throws, leaving the reservation untouched for a later recovery.
    const completed = publication.rows.length > 0 && (await input.store().hasPublication(input.reservationId, sql));
    await finishCredits(sql, input.reservationId, completed);
  });
}

export async function authorizeGuidePublication(
  sql: SqlExecutor,
  input: {
    readonly teamId: string;
    readonly repoId: string;
    readonly actorId?: string;
  },
): Promise<void> {
  const team = await sql.query(
    'SELECT id FROM teams WHERE id=$1 AND deleting_at IS NULL AND content_erasing_at IS NULL FOR NO KEY UPDATE',
    [input.teamId],
  );
  if (!team.rows.length) throw new Error('Generated content is no longer accepted for this team');
  const repo = await sql.query(
    'SELECT id FROM team_repos WHERE id=$1 AND team_id=$2 AND approved AND removed_at IS NULL FOR SHARE',
    [input.repoId, input.teamId],
  );
  if (!repo.rows.length) throw new Error('The guide repository is no longer available');
  if (
    input.actorId &&
    !(
      await sql.query('SELECT user_id FROM team_members WHERE team_id=$1 AND user_id=$2 FOR SHARE', [
        input.teamId,
        input.actorId,
      ])
    ).rows.length
  )
    throw new Error('The guide author is no longer a team member');
}

export async function recordGuidePublication(
  sql: SqlExecutor,
  input: {
    readonly reservationId: string;
    readonly teamId: string;
    readonly repoId: string;
    readonly fingerprint: string;
    readonly headSha: string;
    readonly actorId?: string;
    readonly claim?: { readonly id: string; readonly token: string };
  },
): Promise<void> {
  await authorizeGuidePublication(sql, input);
  if (input.claim) {
    const owned = await sql.query(
      "UPDATE outbox_jobs SET locked_at=now() WHERE id=$1 AND lock_token=$2 AND state='running' RETURNING id",
      [input.claim.id, input.claim.token],
    );
    if (!owned.rows.length) throw new Error('The guide job claim changed');
  }
  const reserved = await sql.query(
    "UPDATE credit_reservations SET resource_fingerprint=$2,head_sha=$3 WHERE id=$1 AND team_id=$4 AND state='reserved' RETURNING id",
    [input.reservationId, input.fingerprint, input.headSha, input.teamId],
  );
  if (!reserved.rows.length) throw new Error('The guide reservation changed');
  await sql.query('INSERT INTO guide_publications(reservation_id,team_id,repo_id) VALUES($1,$2,$3)', [
    input.reservationId,
    input.teamId,
    input.repoId,
  ]);
}
