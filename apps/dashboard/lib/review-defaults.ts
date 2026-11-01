import { z } from 'zod';
import type { ManagedAccessAdapter } from '@geld/providers';
import type { SqlExecutor } from './transactions';
import { repoRowSchema, refFor, type TeamRepository } from './team-access';
export async function readableRepositoryDefaults(sql: SqlExecutor, teamId: string, adapterFor: (repository: TeamRepository) => Promise<ManagedAccessAdapter>): Promise<readonly { readonly id: string; readonly owner: string; readonly name: string; readonly settings: TeamRepository['settings'] }[]> {
  const rows = z.array(repoRowSchema).parse((await sql.query('SELECT * FROM team_repos WHERE team_id=$1 AND approved AND removed_at IS NULL',[teamId])).rows);
  const visible = [];
  for (const repo of rows) {
    const current = await (await adapterFor(repo)).repository(refFor(repo));
    if (current.ok && current.value.permission!=='none') visible.push({id:repo.id,owner:repo.owner,name:repo.name,settings:repo.settings});
  }
  return visible;
}
