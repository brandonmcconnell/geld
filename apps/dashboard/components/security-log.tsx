'use client';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { z } from 'zod';
import { useDashboard } from './app-shell';
const schema = z.object({
  events: z.array(
    z.object({
      id: z.string(),
      action: z.string(),
      outcome: z.string(),
      created_at: z.string(),
      hash: z.string().optional(),
    }),
  ),
});
export function SecurityLog() {
  const { teams, activeTeam } = useDashboard();
  const params = useSearchParams();
  const [team, setTeam] = useState<string | null>(null);
  const [result, setResult] = useState<{
    scope: string;
    events: z.infer<typeof schema>['events'];
    message: string;
  } | null>(null);
  const selected = team ?? params.get('team') ?? activeTeam;
  const current = result?.scope === selected ? result : null;
  useEffect(() => {
    const abort = new AbortController();
    fetch(`/api/security?team=${encodeURIComponent(selected)}`, { signal: abort.signal })
      .then(async (response) => {
        const value: unknown = await response.json();
        if (abort.signal.aborted) return;
        const parsed = schema.safeParse(value);
        const failure = z.object({ error: z.string() }).safeParse(value);
        setResult({
          scope: selected,
          events: response.ok && parsed.success ? parsed.data.events : [],
          message:
            response.ok && parsed.success
              ? ''
              : failure.success
                ? failure.data.error
                : 'Security records are unavailable.',
        });
      })
      .catch(() => {
        if (!abort.signal.aborted)
          setResult({ scope: selected, events: [], message: 'Security records could not be reached.' });
      });
    return () => abort.abort();
  }, [selected]);
  return (
    <div className="page">
      <p className="eyebrow">SECURITY</p>
      <h1>Audit log</h1>
      <p>
        Team events are append-only, chained with signed hashes and retained for 365 days. IP addresses and user agents
        are not collected here.
      </p>
      <label className="settings-row">
        Scope
        <select
          aria-label="Audit log scope"
          className="field max-w-xs"
          value={selected}
          onChange={(event) => setTeam(event.target.value)}
        >
          <option value="">My provider actions</option>
          {teams.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      {current?.message && <p role="status">{current.message}</p>}
      <section className="settings-card">
        {!current ? (
          <p role="status">Loading security records...</p>
        ) : current.events.length ? (
          current.events.map((event) => (
            <div className="settings-row" key={event.id}>
              <div>
                <strong>{event.action}</strong>
                <small>
                  {' '}
                  {event.outcome} · {new Date(event.created_at).toLocaleString()}
                </small>
              </div>
              {event.hash && <code title={event.hash}>{event.hash.slice(0, 12)}</code>}
            </div>
          ))
        ) : (
          <p>No events in this scope.</p>
        )}
      </section>
      {selected && (
        <a className="underline" href={`/api/security?team=${encodeURIComponent(selected)}&export=true`}>
          Export JSON · Business and Enterprise
        </a>
      )}
    </div>
  );
}
