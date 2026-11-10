'use client';
import { useEffect, useState } from 'react';
import { repositoryPath } from '@geld/domain';
import { queueSchema, type QueueData } from './contracts';
import { useDashboard } from './dashboard-context';

export function useRepositoryOptions(open: boolean) {
  const { repositories, session, activeTeam } = useDashboard();
  const owner = session.user?.id ?? (session.demo ? 'demo' : null);
  const scope = `${owner ?? 'anonymous'}:${activeTeam}`;
  const [page, setPage] = useState({ scope: '', cursor: '1' });
  const [revision, setRevision] = useState(0);
  const cursor = page.scope === scope ? page.cursor : '1';
  const [result, setResult] = useState<{
    scope: string;
    cursor: string;
    revision: number;
    repositories: QueueData['repositories'];
    nextCursor: string | null;
    error: string | null;
  } | null>(null);
  const current = result?.scope === scope ? result : null;
  const cached = current?.cursor === cursor && current.revision === revision;
  useEffect(() => {
    if (!open || !owner || cached) return;
    const abort = new AbortController();
    fetch(`/api/queue?${new URLSearchParams({ team: activeTeam, repositoriesOnly: 'true', cursor })}`, {
      signal: abort.signal,
    })
      .then(async (response) => {
        const parsed = queueSchema.safeParse(await response.json());
        if (!response.ok || !parsed.success) throw new Error('Repositories could not be loaded.');
        if (abort.signal.aborted) return;
        setResult((previous) => ({
          scope,
          cursor,
          revision,
          repositories:
            cursor === '1' || previous?.scope !== scope
              ? parsed.data.repositories
              : [
                  ...new Map(
                    [...previous.repositories, ...parsed.data.repositories].map((repo) => [
                      repositoryPath(repo.ref),
                      repo,
                    ]),
                  ).values(),
                ],
          nextCursor: parsed.data.nextCursor ?? null,
          error: parsed.data.sources?.some((source) => source.error) ? 'Some connections could not be loaded.' : null,
        }));
      })
      .catch(() => {
        if (abort.signal.aborted) return;
        setResult((previous) => ({
          scope,
          cursor,
          revision,
          repositories: previous?.scope === scope ? previous.repositories : [],
          nextCursor: null,
          error: 'Repositories could not be loaded.',
        }));
      });
    return () => abort.abort();
  }, [open, owner, activeTeam, scope, cursor, revision, cached]);
  return {
    repositories: current?.repositories ?? repositories,
    loading: open && !!owner && !cached,
    error: current?.error,
    nextCursor: current?.nextCursor,
    loadMore: () => {
      if (current?.nextCursor) setPage({ scope, cursor: current.nextCursor });
    },
    retry: () => setRevision((value) => value + 1),
  };
}
