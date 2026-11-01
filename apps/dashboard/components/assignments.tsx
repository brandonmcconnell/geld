'use client';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import type { PullRef } from '@geld/domain';
import { pullPath } from '@geld/domain';
import { Button } from '@geld/ui';
import { useDashboard } from './app-shell';
const schema = z.object({
  repoId: z.string(),
  members: z.array(z.object({ id: z.string(), name: z.string(), login: z.string().nullable() })),
  requested: z.array(z.string()),
});
export function Assignments({ reference }: { readonly reference: PullRef }) {
  const { activeTeam } = useDashboard();
  return activeTeam ? (
    <AssignmentScope key={`${activeTeam}:${pullPath(reference)}`} reference={reference} teamId={activeTeam} />
  ) : null;
}
function AssignmentScope({ reference, teamId }: { readonly reference: PullRef; readonly teamId: string }) {
  const [data, setData] = useState<z.infer<typeof schema> | null>(null);
  const [reviewer, setReviewer] = useState('');
  const [message, setMessage] = useState('');
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const query = new URLSearchParams({ ...reference, number: String(reference.number), teamId }).toString();
  useEffect(() => {
    const abort = new AbortController();
    fetch(`/api/assignments?${query}`, { signal: abort.signal })
      .then(async (response) => {
        const parsed = schema.safeParse(await response.json());
        if (abort.signal.aborted) return;
        if (response.ok && parsed.success) {
          setData(parsed.data);
          setMessage('');
        } else {
          setData(null);
          setMessage('Assignments could not be verified. Reload before changing requests.');
        }
      })
      .catch(() => {
        if (!abort.signal.aborted) {
          setData(null);
          setMessage('Assignments could not be reached.');
        }
      });
    return () => abort.abort();
  }, [query, revision]);
  async function update(userId: string, remove = false) {
    if (!data || busy) return;
    setBusy(true);
    try {
      const response = await fetch('/api/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId, repoId: data.repoId, pullNumber: reference.number, reviewerId: userId, remove }),
      });
      const value: unknown = await response.json();
      const error = z.object({ error: z.string() }).safeParse(value);
      setMessage(
        response.ok
          ? 'Provider review request updated.'
          : error.success
            ? error.data.error
            : 'The assignment could not be confirmed.',
      );
      if (response.ok) setRevision((value) => value + 1);
    } catch {
      setMessage('The assignment could not connect.');
    }
    setBusy(false);
  }
  if (!data)
    return message ? (
      <p className="review-banner" role="status">
        {message}
      </p>
    ) : null;
  return (
    <details className="review-banner">
      <summary>Assignments · {data.requested.length} requested</summary>
      <p>Review requests sync with GitHub. Existing CODEOWNERS and provider defaults are kept.</p>
      {data.members
        .filter((member) => member.login && data.requested.includes(member.login))
        .map((member) => (
          <div className="settings-row" key={member.id}>
            <span>{member.name}</span>
            <Button disabled={busy} size="sm" variant="ghost" onClick={() => update(member.id, true)}>
              Remove request
            </Button>
          </div>
        ))}
      <div className="flex gap-2">
        <select
          className="field max-w-xs"
          aria-label="Reviewer"
          value={reviewer}
          onChange={(event) => setReviewer(event.target.value)}
        >
          <option value="">Choose a reviewer</option>
          {data.members
            .filter((member) => member.login && !data.requested.includes(member.login))
            .map((member) => (
              <option value={member.id} key={member.id}>
                {member.name}
              </option>
            ))}
        </select>
        <Button size="sm" disabled={!reviewer || busy} onClick={() => update(reviewer)}>
          Request review
        </Button>
      </div>
      <p role="status">{message}</p>
    </details>
  );
}
