'use client';
import Link from 'next/link';
import { ArrowUpRight, FolderGit2, Lock } from '@/components/icons';
import { repositoryPath, type Provider } from '@geld/domain';
import { Button } from '@/components/button';
import { EmptyState, useDashboard } from './app-shell';
export function Repositories({
  owner,
  provider,
  host,
}: {
  readonly owner?: string;
  readonly provider?: Provider;
  readonly host?: string;
}) {
  const { queue, loading, loadMore } = useDashboard();
  const repositories = queue.repositories.filter(
    (repo) =>
      (!owner || repo.ref.owner === owner) &&
      (!provider || repo.ref.provider === provider) &&
      (!host || repo.ref.host === host),
  );
  return (
    <div className="page repository-index">
      {repositories.length ? (
        <div className="settings-card">
          {repositories.map((repo) => (
            <Link href={repositoryPath(repo.ref)} className="settings-row" key={repositoryPath(repo.ref)}>
              {repo.private ? <Lock size={14} /> : <FolderGit2 size={14} />}
              <div>
                <h3>
                  {repo.ref.owner} / {repo.ref.repo}
                </h3>
                <p>
                  {repo.ref.provider} · {repo.private ? 'Private' : 'Public'} · {repo.permission}
                </p>
              </div>
              <ArrowUpRight size={15} />
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState icon={FolderGit2} title={loading ? 'Loading repositories...' : 'Connect your first repository'}>
          Repositories appear here after you connect a Git account.
        </EmptyState>
      )}
      {queue.sources?.some((source) => source.more) && (
        <Button variant="outline" size="sm" disabled={loading} onClick={loadMore}>
          Load more repositories
        </Button>
      )}
    </div>
  );
}
