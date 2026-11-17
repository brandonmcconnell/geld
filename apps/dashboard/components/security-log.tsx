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
      actor_digest: z.string().optional(),
      resource_type: z.string().optional(),
      resource_id: z.string().optional(),
      provider: z.string().optional(),
    }),
  ),
});
export function SecurityLog() {
  const { teams, activeTeam } = useDashboard();
  const params = useSearchParams();
  const [query, setQuery] = useState('');
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
      <div className="page-heading">
        <h1>Audit log</h1>
        {selected && (
          <a className="text-xs underline" href={'/api/security?team=' + encodeURIComponent(selected) + '&export=true'}>
            Export JSON
          </a>
        )}
      </div>
      <div className="audit-toolbar">
        <label className="search-field">
          <input
            name="auditQuery"
            aria-label="Search audit events"
            placeholder="Search actions, resources or outcomes…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label className="toolbar-select">
          <select
            name="selected"
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
      </div>
      {current?.message && <p role="status">{current.message}</p>}
      <div className="audit-table-scroll">
        <table className="audit-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Action</th>
              <th>Actor</th>
              <th>Resource</th>
              <th>Outcome</th>
              <th>Record</th>
            </tr>
          </thead>
          <tbody>
            {!current ? (
              <tr>
                <td colSpan={6}>Loading events…</td>
              </tr>
            ) : (
              current.events
                .filter((event) =>
                  [event.action, event.resource_type, event.resource_id, event.outcome]
                    .join(' ')
                    .toLowerCase()
                    .includes(query.toLowerCase()),
                )
                .map((event) => (
                  <tr key={event.id}>
                    <td>
                      <time dateTime={event.created_at}>
                        {new Date(event.created_at).toLocaleString('en', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </time>
                    </td>
                    <td>{event.action}</td>
                    <td>
                      <code>
                        {event.actor_digest ? event.actor_digest.slice(0, 10) : selected ? 'Unavailable' : 'You'}
                      </code>
                    </td>
                    <td>
                      {event.resource_type ?? event.provider ?? 'Provider'}
                      {event.resource_id && <small title={event.resource_id}>{event.resource_id}</small>}
                    </td>
                    <td>
                      <span className="audit-outcome" data-success={event.outcome === 'success'}>
                        {event.outcome}
                      </span>
                    </td>
                    <td>
                      <code title={event.hash ?? event.id}>{(event.hash ?? event.id).slice(0, 10)}</code>
                    </td>
                  </tr>
                ))
            )}
            {current && !current.events.length && (
              <tr>
                <td colSpan={6}>No events in this scope.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="audit-retention">Team records are retained for 365 days. Actor identifiers are pseudonymous.</p>
    </div>
  );
}
