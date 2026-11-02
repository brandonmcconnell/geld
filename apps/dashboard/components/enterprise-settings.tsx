'use client';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { Button } from '@geld/ui';
import { useDashboard } from './app-shell';
import { RepositoryAppSetup } from './repository-app-setup';
const schema = z.object({
  hosts: z.array(
    z.object({
      host: z.string(),
      team_id: z.string(),
      relay_channel: z.string().nullable(),
      direct_allowed: z.boolean(),
    }),
  ),
});
export function EnterpriseSettings() {
  const { teams } = useDashboard();
  const [team, setTeam] = useState('');
  const [host, setHost] = useState('');
  const [items, setItems] = useState<z.infer<typeof schema>['hosts']>([]);
  const [secret, setSecret] = useState('');
  const [message, setMessage] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    fetch('/api/enterprise', { signal: abort.signal })
      .then(async (r) => {
        const parsed = schema.safeParse(await r.json());
        if (parsed.success) setItems(parsed.data.hosts);
      })
      .catch(() => undefined);
    return () => abort.abort();
  }, [revision]);
  return (
    <div className="page">
      <p className="eyebrow">ENTERPRISE</p>
      <h1>Your instances</h1>
      <p>
        Reachable public hosts use direct HTTPS. Private instances use a customer connector that polls outward. Geld
        never opens a connection into your private network.
      </p>
      <section className="settings-card">
        <form
          className="form-stack max-w-xl"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await fetch('/api/enterprise', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                teamId: team,
                host,
                relay: true,
                direct: true,
              }),
            });
            const value: unknown = await r.json();
            const parsed = z
              .object({
                error: z.string().optional(),
                relay: z
                  .object({
                    channel: z.string(),
                    secret: z.string(),
                    host: z.string(),
                  })
                  .optional(),
              })
              .safeParse(value);
            if (r.ok) {
              setMessage('Instance registered. Configure its outbound connector and repository App.');
              setSecret(parsed.success && parsed.data.relay ? JSON.stringify(parsed.data.relay, null, 2) : '');
              setRevision((v) => v + 1);
            } else setMessage(parsed.success ? (parsed.data.error ?? 'Registration failed.') : 'Registration failed.');
          }}
        >
          <label>
            Enterprise team
            <select className="field" required value={team} onChange={(e) => setTeam(e.target.value)}>
              <option value="">Choose a team</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Instance hostname
            <input
              className="field"
              required
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="github.example.com or company.ghe.com"
            />
          </label>
          <Button type="submit">Register instance</Button>
        </form>
        {secret && (
          <div>
            <p>Copy this connector configuration now. The secret is shown once and stored encrypted.</p>
            <pre className="overflow-auto rounded border p-4 text-xs">{secret}</pre>
            <Button variant="outline" onClick={() => setSecret('')}>
              I saved the connector secret
            </Button>
          </div>
        )}
        <p role="status">{message}</p>
      </section>
      {items.map((i) => (
        <section key={`${i.host}:${i.team_id}`}>
          <div className="settings-card">
            <h2>{i.host}</h2>
            <p>
              {i.relay_channel ? 'Outbound relay registered' : 'No relay registered'} ·{' '}
              {i.direct_allowed ? 'Public reachability enabled' : 'Relay only'}
            </p>
            <p>
              Identity key: <code>github@{i.host}</code>
            </p>
          </div>
          <RepositoryAppSetup teamId={i.team_id} host={i.host} />
        </section>
      ))}
      <p>
        Need self-hosted or enterprise options?{' '}
        <a className="underline" href="mailto:hello@geld.sh">
          Contact us
        </a>
      </p>
    </div>
  );
}
