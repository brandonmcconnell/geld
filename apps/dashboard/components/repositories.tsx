'use client';
import Link from 'next/link';
import { ArrowUpRight, FolderGit2, Lock, Settings } from '@/components/icons';
import { organisationPath, repositoryPath, type Provider } from '@geld/domain';
import { Button, buttonVariants } from '@/components/button';
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
    <div className="page">
      <div className="page-heading">
        <div>
          <h1>{owner ?? 'Repositories'}</h1>
        </div>
        <div className="page-actions">
          {owner && provider && host && (
            <Link
              href={`${organisationPath({ provider, host, owner })}/~settings`}
              className="icon-button"
              aria-label="Organization settings"
              title="Organization settings"
            >
              <Settings size={16} />
              <span className="touch-target" aria-hidden="true" />
            </Link>
          )}
          <Link href="/connect" className={buttonVariants({ size: 'sm' })}>
            Connect repository <ArrowUpRight size={14} />
          </Link>
        </div>
      </div>
      {repositories.length ? (
        <div className="settings-card">
          {repositories.map((repo) => (
            <Link href={repositoryPath(repo.ref)} className="settings-row" key={repositoryPath(repo.ref)}>
              {repo.private ? <Lock size={20} /> : <FolderGit2 size={20} />}
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
