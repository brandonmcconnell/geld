'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { z } from 'zod';
import { Button } from '@geld/ui';
import { TeamDestruction } from './team-destruction';
import { SsoSettings } from './sso-settings';
import { AppMigration } from './app-migration';
import { BitbucketConnection } from './bitbucket-connection';
import { CollaboratorAudit } from './collaborator-audit';
import { RepositoryAppSetup } from './repository-app-setup';
import { useDashboard } from './app-shell';
const dataSchema = z.object({
  team: z.object({
    id: z.string(),
    name: z.string(),
    role: z.string(),
    managed_access: z.boolean(),
    sync_enabled: z.boolean(),
    add_approval: z.boolean(),
    visibility: z.enum(['names', 'request', 'count', 'none']),
  }),
  repositories: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      owner: z.string(),
      provider: z.string(),
      url: z.string(),
      accessible: z.boolean(),
      canRequest: z.boolean().optional(),
    }),
  ),
  hiddenCount: z.number().nullable(),
  members: z.array(z.object({ id: z.string(), name: z.string(), role: z.string() })),
  requests: z.array(
    z.object({
      id: z.string(),
      repo_id: z.string().nullable(),
      kind: z.string(),
      state: z.string(),
      canDecide: z.boolean().optional(),
    }),
  ),
  grants: z.array(
    z.object({
      id: z.string(),
      user_id: z.string().nullable(),
      repo_id: z.string(),
      mechanism: z.string(),
      source: z.string(),
      state: z.string(),
    }),
  ),
  jobs: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      state: z.string(),
      attempts: z.number(),
    }),
  ),
});
const previewSchema = z.object({
  missing: z.array(
    z.object({
      userId: z.string(),
      repoId: z.string(),
      login: z.string(),
      outside: z.boolean(),
    }),
  ),
  unavailable: z.array(z.string()),
  confirmation: z.string(),
  repositoryCount: z.number(),
});
export function TeamDetail({ id }: { readonly id: string }) {
  const { queue, session } = useDashboard();
  const [data, setData] = useState<z.infer<typeof dataSchema> | null>(null);
  const [message, setMessage] = useState('');
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [preview, setPreview] = useState<z.infer<typeof previewSchema> | null>(null);
  const [outside, setOutside] = useState<string[]>([]);
  const [managed, setManaged] = useState(false);
  const [sync, setSync] = useState(false);
  const [approval, setApproval] = useState(true);
  const [visibility, setVisibility] = useState<'names' | 'request' | 'count' | 'none'>('request');
  useEffect(() => {
    const abort = new AbortController();
    fetch(`/api/teams/${encodeURIComponent(id)}`, { signal: abort.signal })
      .then(async (r) => {
        const value: unknown = await r.json();
        const parsed = dataSchema.safeParse(value);
        if (parsed.success) {
          setData(parsed.data);
          setManaged(parsed.data.team.managed_access);
          setSync(parsed.data.team.sync_enabled);
          setApproval(parsed.data.team.add_approval);
          setVisibility(parsed.data.team.visibility);
        } else setMessage('This team could not be loaded. Sign in with a team member account.');
      })
      .catch(() => undefined);
    return () => abort.abort();
  }, [id, revision]);
  async function action(input: unknown) {
    setBusy(true);
    try {
      const r = await fetch(`/api/teams/${encodeURIComponent(id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const value: unknown = await r.json();
      const error = z.object({ error: z.string() }).safeParse(value);
      setMessage(
        r.ok
          ? 'Saved. Provider work stays pending until confirmed.'
          : error.success
            ? error.data.error
            : 'This change could not be saved.',
      );
      if (r.ok) setRevision((v) => v + 1);
    } catch {
      setMessage('This action could not connect.');
    }
    setBusy(false);
  }
  const admin = data?.team.role === 'admin';
  return (
    <div className="page" data-measure="team-access">
      <nav className="breadcrumbs">
        <Link href="/teams">Teams</Link>
        <span>/</span>
        <span>{data?.team.name ?? 'Team'}</span>
      </nav>
      <div className="page-heading">
        <h1>{data?.team.name ?? 'Team'}</h1>
        <Link href="/settings/billing">Plan and spending cap ↗</Link>
      </div>
      {message && (
        <p role="status" className="status-message">
          {message}
        </p>
      )}
      <section className="settings-card">
        <h2>Repositories</h2>
        <p>Your provider account controls which content you can read and which actions you can take.</p>
        {data?.repositories.map((repo) => (
          <div className="settings-row" key={repo.id}>
            <div>
              <Link href={repo.url}>
                {repo.owner}/{repo.name}
              </Link>
              <small>
                {' '}
                {repo.provider} · {repo.accessible ? 'Provider access confirmed' : 'No provider access'}
              </small>
            </div>
            {repo.canRequest ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => action({ action: 'request_access', repoId: repo.id })}
              >
                Request access
              </Button>
            ) : (
              admin && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => action({ action: 'remove_repository', repoId: repo.id })}
                >
                  Remove
                </Button>
              )
            )}
          </div>
        ))}
        {!!data?.hiddenCount && <p>{data.hiddenCount} hidden repositories</p>}
        <details>
          <summary>Add repositories from your connections</summary>
          <p>Repositories need your own provider access. Add requests wait for admin approval by default.</p>
          {queue.repositories.map((repo) => (
            <label className="settings-row" key={repo.id}>
              <span>
                {repo.ref.owner}/{repo.ref.repo}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => action({ action: 'add', ref: repo.ref })}
              >
                Add
              </Button>
            </label>
          ))}
          <Link href="/connect">Change installed repositories ↗</Link>
        </details>
      </section>
      {admin && (
        <section className="settings-card">
          <h2>Access and visibility</h2>
          <label className="settings-row">
            <span>Approve repository additions</span>
            <input type="checkbox" checked={approval} onChange={(e) => setApproval(e.target.checked)} />
          </label>
          <label className="settings-row">
            <span>
              Geld-managed access
              <small> Requires extra repository App permissions.</small>
            </span>
            <input
              type="checkbox"
              checked={managed}
              onChange={(e) => {
                setManaged(e.target.checked);
                if (!e.target.checked) setSync(false);
              }}
            />
          </label>
          {managed && (
            <label className="settings-row">
              <span>Sync team membership to repositories</span>
              <input
                type="checkbox"
                checked={sync}
                onChange={(e) => {
                  setSync(e.target.checked);
                  setPreview(null);
                }}
              />
            </label>
          )}
          {managed && !sync && data?.team.managed_access && <p>Sync paused. Existing access is unchanged.</p>}
          <label className="settings-row">
            <span>Members without repository access see</span>
            <select
              className="field max-w-xs"
              value={visibility}
              onChange={(e) => {
                const parsed = z.enum(['names', 'request', 'count', 'none']).safeParse(e.target.value);
                if (parsed.success) setVisibility(parsed.data);
              }}
            >
              <option value="names">Names only</option>
              <option value="request">Names and request button</option>
              <option value="count">A count</option>
              <option value="none">Nothing</option>
            </select>
          </label>
          {sync && !data?.team.sync_enabled && (
            <>
              <Button
                variant="outline"
                disabled={busy}
                onClick={async () => {
                  const r = await fetch(`/api/teams/${id}?preview=sync`);
                  const p = previewSchema.safeParse(await r.json());
                  if (p.success) {
                    setPreview(p.data);
                    setOutside([]);
                  } else setMessage('The sync preview could not be loaded.');
                }}
              >
                Preview new access
              </Button>
              {preview && (
                <div className="notice">
                  <p>
                    By turning sync on,{' '}
                    {
                      new Set(
                        preview.missing
                          .filter((m) => !m.outside || outside.includes(`${m.repoId}:${m.userId}`))
                          .map((m) => m.userId),
                      ).size
                    }{' '}
                    members will gain new access across {new Set(preview.missing.map((m) => m.repoId)).size}{' '}
                    repositories. Existing access is kept.
                  </p>
                  {preview.unavailable.length > 0 && (
                    <p>
                      Some provider permissions could not be verified. Confirm the App permissions before continuing.
                    </p>
                  )}
                  {preview.missing
                    .filter((m) => m.outside)
                    .map((m) => {
                      const key = `${m.repoId}:${m.userId}`;
                      return (
                        <label className="settings-row" key={key}>
                          <span>
                            {m.login} outside collaborator · {data?.repositories.find((r) => r.id === m.repoId)?.name}
                          </span>
                          <input
                            type="checkbox"
                            checked={outside.includes(key)}
                            onChange={(e) =>
                              setOutside(e.target.checked ? [...outside, key] : outside.filter((v) => v !== key))
                            }
                          />
                        </label>
                      );
                    })}
                </div>
              )}
            </>
          )}
          <Button
            disabled={busy || (sync && !data?.team.sync_enabled && (!preview || preview.unavailable.length > 0))}
            onClick={() =>
              action({
                action: 'settings',
                managed,
                sync,
                approval,
                visibility,
                confirmation: preview?.confirmation,
                outside,
              })
            }
          >
            Save access settings
          </Button>
        </section>
      )}
      {admin && (
        <>
          <RepositoryAppSetup key={String(managed)} teamId={id} managedAccess={managed} />
          <AppMigration teamId={id} />
          <CollaboratorAudit teamId={id} />
          <BitbucketConnection teamId={id} />
        </>
      )}
      <section className="settings-card">
        <h2>Members</h2>
        {data?.members.map((member) => (
          <div className="settings-row" key={member.id}>
            <span>
              {member.name} · {member.role}
            </span>
            {admin && member.id !== session.user?.id && (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => action({ action: 'remove_member', userId: member.id })}
              >
                Remove and revoke Geld access
              </Button>
            )}
          </div>
        ))}
        {admin && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              action({ action: 'invite', email });
            }}
          >
            <input
              className="field"
              type="email"
              aria-label="Teammate email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@example.com"
            />
            <Button type="submit" disabled={busy}>
              Invite
            </Button>
          </form>
        )}
      </section>
      <section className="settings-card">
        <h2>Requests</h2>
        {data?.requests.length ? (
          data.requests.map((r) => (
            <div className="settings-row" key={r.id}>
              <span>
                {r.kind.replaceAll('_', ' ')} ·{' '}
                {data.repositories.find((repo) => repo.id === r.repo_id)?.name ?? 'Repository'} · {r.state}
              </span>
              {r.state === 'pending' && r.canDecide && (
                <span className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      action({
                        action: 'decide',
                        requestId: r.id,
                        approve: true,
                      })
                    }
                  >
                    Approve
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      action({
                        action: 'decide',
                        requestId: r.id,
                        approve: false,
                      })
                    }
                  >
                    Deny
                  </Button>
                </span>
              )}
            </div>
          ))
        ) : (
          <p>No pending requests.</p>
        )}
      </section>
      {admin && (
        <>
          <section className="settings-card">
            <h2>Grant ledger</h2>
            <p>
              Only Geld-created grants are managed here. Invitations remain pending until the provider confirms access.
            </p>
            {data?.grants.map((g) => (
              <div className="settings-row" key={g.id}>
                <span>
                  {data.members.find((m) => m.id === g.user_id)?.name ?? 'Former member'} ·{' '}
                  {data.repositories.find((r) => r.id === g.repo_id)?.name ?? 'Removed repository'}
                  <small>
                    {' '}
                    {g.mechanism} · {g.source} · {g.state}
                  </small>
                </span>
                {['active', 'pending'].includes(g.state) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => action({ action: 'withdraw', grantId: g.id })}
                  >
                    Withdraw
                  </Button>
                )}
              </div>
            ))}
            <Button variant="outline" disabled={busy} onClick={() => action({ action: 'run_jobs' })}>
              Apply or retry provider changes
            </Button>
            {data?.jobs
              .filter((j) => j.state !== 'completed')
              .map((job) => (
                <p key={job.id}>
                  {job.kind} · {job.state} · {job.attempts} attempts
                </p>
              ))}
            <Link href={`/settings/security?team=${id}`}>Open security log ↗</Link>
          </section>
          <GuideDefaults teamId={id} />
          <SsoSettings teamId={id} />
          <TeamDestruction teamId={id} name={data?.team.name ?? 'Team'} />
        </>
      )}
    </div>
  );
}
function GuideDefaults({ teamId }: { readonly teamId: string }) {
  return (
    <section className="settings-card">
      <h2>Review defaults</h2>
      <p>Guide triggers and default reviewers follow team, repository and PR settings.</p>
      <Link href={`/teams/${teamId}/settings`}>Configure review defaults ↗</Link>
    </section>
  );
}
