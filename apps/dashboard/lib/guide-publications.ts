import type { SqlExecutor } from './transactions';
import type { GeneratedContentStore } from './content-store';
import { finishCredits } from './credits';
export async function recoverGuideCredits(input: { readonly sql: SqlExecutor; readonly run: <T>(work: (sql: SqlExecutor) => Promise<T>) => Promise<T>; readonly store: () => Pick<GeneratedContentStore,'hasPublication'>; readonly reservationId: string }): Promise<void> {
  const publication = await input.sql.query('SELECT reservation_id FROM guide_publications WHERE reservation_id=$1',[input.reservationId]);
  const completed = publication.rows.length>0 && await input.store().hasPublication(input.reservationId);
  await input.run(sql => finishCredits(sql,input.reservationId,completed));
}
