'use client';
import Link from 'next/link';
import type { RepositoryRef } from '@geld/domain';
export function RepositorySettings({
  owner,
  repository,
}: {
  readonly owner: string;
  readonly provider: string;
  readonly repository?: RepositoryRef;
}) {
  return (
    <div className="page">
      <h1>{repository?.repo ?? owner} settings</h1>
      <section className="settings-card">
        <h2>Git permissions</h2>
        <p>
          Repository and organization privileges come from your Git host. Team administration never grants additional
          repository rights.
        </p>
        <Link href="/connect" className="underline text-xs">
          Manage repository access
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
