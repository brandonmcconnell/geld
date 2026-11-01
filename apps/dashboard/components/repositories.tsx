'use client';
import Link from 'next/link';
import { ArrowUpRight, FolderGit2 } from 'lucide-react';
import { repositoryPath } from '@geld/domain';
import { Button, buttonVariants } from '@geld/ui';
import { EmptyState, useDashboard } from './app-shell';
export function Repositories({
  owner,
  provider,
  host,
}: {
  readonly owner?: string;
  readonly provider?: string;
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
    <div className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">PROVIDER REPOSITORIES</p>
          <h1>{owner ?? 'Repositories'}</h1>
          <p>Your provider&apos;s structure, with a clearer path to every review.</p>
        </div>
        <Link href="/connect" className={buttonVariants({ size: 'sm' })}>
          Connect repository <ArrowUpRight size={14} />
        </Link>
      </div>
      {repositories.length ? (
        <div className="settings-card">
          {repositories.map((repo) => (
            <Link href={repositoryPath(repo.ref)} className="settings-row" key={repositoryPath(repo.ref)}>
              <FolderGit2 size={20} />
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
          Repositories appear here after you connect a provider.
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
