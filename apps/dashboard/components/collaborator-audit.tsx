'use client';
import Image from 'next/image';
import { useState } from 'react';
import { z } from 'zod';
import { Button } from '@geld/ui';
const schema = z.object({
  collaborators: z.array(
    z.object({
      id: z.string(),
      login: z.string(),
      avatar: z.string().optional(),
      permission: z.string(),
      repoId: z.string(),
      repository: z.string(),
      provider: z.string(),
      host: z.string(),
    }),
  ),
  repositories: z
    .array(z.object({ id: z.string(), name: z.string(), owner: z.string(), provider: z.string(), host: z.string() }))
    .optional(),
  unavailable: z.array(z.string()),
  next: z.number().nullable(),
});
const previewSchema = z.object({
  missing: z.array(
    z.object({ repoId: z.string(), id: z.string(), login: z.string(), provider: z.string(), host: z.string() }),
  ),
  existing: z.number(),
  confirmation: z.string(),
});
export function CollaboratorAudit({ teamId }: { readonly teamId: string }) {
  const [data, setData] = useState<z.infer<typeof schema> | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [targets, setTargets] = useState<Readonly<Record<string, readonly string[]>>>({});
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [preview, setPreview] = useState<z.infer<typeof previewSchema> | null>(null);
  const [batchConfirmations, setBatchConfirmations] = useState<readonly string[]>([]);
  const key = (person: z.infer<typeof schema>['collaborators'][number]) =>
    `${person.provider}:${person.host}:${person.id}`;
  const people = [...new Map((data?.collaborators ?? []).map((person) => [key(person), person])).values()];
  async function load(page = 1) {
    setBusy(true);
    setPreview(null);
    try {
      const r = await fetch(`/api/teams/${teamId}/collaborators?page=${page}`);
      const value: unknown = await r.json();
      const parsed = schema.safeParse(value);
      if (parsed.success) {
        setData((previous) => ({
          ...parsed.data,
          collaborators: [...(page > 1 ? (previous?.collaborators ?? []) : []), ...parsed.data.collaborators],
        }));
        if (page === 1) setSelected([]);
      } else {
        const e = z.object({ error: z.string() }).safeParse(value);
        setError(e.success ? e.data.error : 'The audit could not be loaded.');
      }
    } catch {
      setError('The audit could not connect.');
    }
    setBusy(false);
  }
  async function audit(apply: boolean) {
    setBusy(true);
    setError('');
    const selectedPeople = people
      .filter((person) => selected.includes(key(person)))
      .map((person) => ({
        key: key(person),
        repoId: person.repoId,
        id: person.id,
        login: person.login,
        targets:
          targets[key(person)] ??
          (data?.repositories ?? [{ id: person.repoId, provider: person.provider, host: person.host }])
            .filter((repo) => repo.provider === person.provider && repo.host === person.host)
            .map((repo) => repo.id),
      }));
    const batches = Array.from({ length: Math.ceil(selectedPeople.length / 100) }, (_, index) =>
      selectedPeople.slice(index * 100, (index + 1) * 100),
    );
    try {
      const previews: z.infer<typeof previewSchema>[] = [];
      for (const [index, batch] of batches.entries()) {
        const read = await fetch(`/api/teams/${teamId}/collaborators`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            people: batch.map(({ repoId, id, login, targets }) => ({ repoId, id, login, targets })),
          }),
        });
        const value: unknown = await read.json();
        const parsed = previewSchema.safeParse(value);
        const failure = z.object({ error: z.string() }).safeParse(value);
        if (!read.ok || !parsed.success)
          throw new Error(failure.success ? failure.data.error : 'The audit could not be previewed.');
        if (apply) {
          if (!preview || batchConfirmations[index] !== parsed.data.confirmation)
            throw new Error('Provider access changed. Preview the remaining invitations again.');
          const response = await fetch(`/api/teams/${teamId}/collaborators`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              people: batch.map(({ repoId, id, login, targets }) => ({ repoId, id, login, targets })),
              confirmation: parsed.data.confirmation,
            }),
          });
          const saved: unknown = await response.json();
          const error = z.object({ error: z.string() }).safeParse(saved);
          if (!response.ok || !z.object({ saved: z.literal(true) }).safeParse(saved).success)
            throw new Error(
              error.success
                ? error.data.error
                : 'Some invitations could not be confirmed. Preview the remaining selection before retrying.',
            );
          const completed = new Set(batch.map((person) => person.key));
          setSelected((previous) => previous.filter((id) => !completed.has(id)));
        } else previews.push(parsed.data);
      }
      if (apply) {
        setPreview(null);
        setBatchConfirmations([]);
        setError('Invitations queued. Provider jobs remain pending until confirmed.');
      } else {
        setBatchConfirmations(previews.map((result) => result.confirmation));
        setPreview({
          confirmation: '',
          missing: previews.flatMap((result) => result.missing),
          existing: previews.reduce((sum, result) => sum + result.existing, 0),
        });
      }
    } catch (error) {
      setPreview(null);
      setBatchConfirmations([]);
      setError(error instanceof Error ? error.message : 'The audit could not connect.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-card">
      <h2>Outside collaborators</h2>
      <p>
        Review everyone before granting anything. Included people get direct repository invitations and never an
        organisation invitation. Existing access is protected.
      </p>
      <Button variant="outline" disabled={busy} onClick={() => load()}>
        Audit provider collaborators
      </Button>
      {error && (
        <p role="status" className="status-message">
          {error}
        </p>
      )}
      {data && (
        <>
          <p>{people.length} outside collaborators in the loaded pages.</p>
          <label className="settings-row">
            <span>
              Include all collaborators<small> Off by default. Load every page before selecting everyone.</small>
            </span>
            <input
              type="checkbox"
              disabled={busy || !!data.next}
              checked={!!people.length && people.every((person) => selected.includes(key(person)))}
              onChange={(event) => {
                setSelected(event.target.checked ? people.map(key) : []);
                setPreview(null);
              }}
            />
          </label>
          {people.map((person) => {
            const matching =
              data.repositories?.filter((repo) => repo.provider === person.provider && repo.host === person.host) ?? [];
            const chosen = targets[key(person)] ?? matching.map((repo) => repo.id);
            return (
              <details key={key(person)} className="mt-3">
                <summary className="flex items-center gap-2">
                  <CollaboratorAvatar person={person} />
                  {person.login} · outside contributor
                </summary>
                <label className="settings-row">
                  <span>
                    Include {person.login}
                    <small>
                      {' '}
                      Existing access:{' '}
                      {data.collaborators
                        .filter((row) => key(row) === key(person))
                        .map((row) => row.repository)
                        .join(', ')}
                    </small>
                  </span>
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={selected.includes(key(person))}
                    onChange={(event) => {
                      setSelected((previous) =>
                        event.target.checked
                          ? [...new Set([...previous, key(person)])]
                          : previous.filter((id) => id !== key(person)),
                      );
                      setPreview(null);
                    }}
                  />
                </label>
                {selected.includes(key(person)) &&
                  matching.map((repo) => (
                    <label className="settings-row" key={repo.id}>
                      <span>
                        {repo.owner}/{repo.name}
                      </span>
                      <input
                        type="checkbox"
                        disabled={busy}
                        checked={chosen.includes(repo.id)}
                        onChange={(event) => {
                          setTargets((previous) => ({
                            ...previous,
                            [key(person)]: event.target.checked
                              ? [...chosen, repo.id]
                              : chosen.filter((id) => id !== repo.id),
                          }));
                          setPreview(null);
                        }}
                      />
                    </label>
                  ))}
              </details>
            );
          })}
          {!!data.unavailable.length && (
            <p>Some permissions could not be verified. Refresh those connections before continuing.</p>
          )}
          {data.next && (
            <Button variant="ghost" disabled={busy} onClick={() => load(data.next ?? 1)}>
              Load next page
            </Button>
          )}
          <Button
            variant="outline"
            disabled={
              busy || !selected.length || selected.some((id) => targets[id]?.length === 0) || !!data.unavailable.length
            }
            onClick={() => audit(false)}
          >
            Preview new invitations
          </Button>
          {preview && (
            <div className="notice mt-4">
              <p>
                {new Set(preview.missing.map((person) => `${person.provider}:${person.host}:${person.id}`)).size} people
                will receive {preview.missing.length} new direct repository invitations across{' '}
                {new Set(preview.missing.map((person) => person.repoId)).size} repositories. {preview.existing} existing
                permissions or pending Geld invitations stay in place.
              </p>
              <div className="flex gap-2 mt-3">
                <Button disabled={busy || !preview.missing.length} onClick={() => audit(true)}>
                  Confirm invitations
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => setPreview(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function CollaboratorAvatar({
  person,
}: {
  readonly person: { readonly login: string; readonly host: string; readonly avatar?: string | undefined };
}) {
  let url: string | null = null;
  try {
    const parsed = new URL(person.avatar ?? '');
    if (
      parsed.protocol === 'https:' &&
      (parsed.hostname === person.host ||
        parsed.hostname === 'avatars.githubusercontent.com' ||
        parsed.hostname.endsWith('.gravatar.com') ||
        parsed.hostname.endsWith('.atl-paas.net'))
    )
      url = parsed.href;
  } catch {
    /* Use a local initial when no safe avatar is available. */
  }
  return url ? (
    <Image unoptimized src={url} width={22} height={22} className="rounded-full" alt="" />
  ) : (
    <span
      aria-hidden="true"
      className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs"
    >
      {person.login.slice(0, 1).toUpperCase()}
    </span>
  );
}
