'use client';
import Link from 'next/link';
import type { RepositoryRef } from '@geld/domain';
import { repositoryPath } from '@geld/domain';
export function RepositorySettings({
  owner,
  provider,
  repository,
}: {
  readonly owner: string;
  readonly provider: string;
  readonly repository?: RepositoryRef;
}) {
  return (
    <div className="page">
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link href="/">Review queue</Link>
        <span>/</span>
        <Link href={repository ? repositoryPath(repository) : `/${provider}/${encodeURIComponent(owner)}`}>
          {repository?.repo ?? owner}
        </Link>
        <span>/</span>
        <span>Settings</span>
      </nav>
      <h1>{repository?.repo ?? owner} settings</h1>
      <section className="settings-card">
        <h2>Provider permissions</h2>
        <p>
          Repository and organisation privileges are mirrored from the provider. Team administration never grants
          additional repository rights.
        </p>
        <Link href="/connect" className="underline text-xs">
          Manage provider installation
        </Link>
      </section>
      <section className="settings-card">
        <h2>Team settings</h2>
        <p>Manage review defaults, access sync and assignments in the team that owns this repository connection.</p>
        <Link href="/teams" className="underline text-xs">
          Choose a team
        </Link>
      </section>
    </div>
  );
}
