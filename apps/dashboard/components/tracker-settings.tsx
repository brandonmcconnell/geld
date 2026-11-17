'use client';
import { useEffect, useState } from 'react';
import { ISSUE_TRACKERS, TRACKER_LABELS, parseIssueTracker } from '@geld/core';
import { z } from 'zod';
import { Button } from '@/components/button';
export function TrackerSettings({ teamId }: { readonly teamId: string }) {
  const [provider, setProvider] = useState('linear');
  const [keys, setKeys] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [workspace, setWorkspace] = useState('');
  const [token, setToken] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    fetch(`/api/tracker?team=${teamId}`, { signal: abort.signal })
      .then(async (r) => {
        const value: unknown = await r.json();
        const parsed = z.object({ config: z.unknown() }).safeParse(value);
        const config = parsed.success ? parseIssueTracker(parsed.data.config) : null;
        if (config) {
          setProvider(config.provider);
          setKeys(config.keys.join(', '));
          setBaseUrl(config.baseUrl ?? '');
          setWorkspace(config.workspace ?? '');
        }
      })
      .catch(() => undefined);
    return () => abort.abort();
  }, [teamId]);
  return (
    <section className="settings-card">
      <h2>Issue tracker</h2>
      <p>Link issue keys to this team’s tracker. Status connections are optional and read-only.</p>
      <form
        className="form-stack max-w-xl"
        onSubmit={async (e) => {
          e.preventDefault();
          const config = parseIssueTracker({
            provider,
            keys: keys
              .split(',')
              .map((k) => k.trim())
              .filter(Boolean),
            ...(baseUrl ? { baseUrl } : {}),
            ...(workspace ? { workspace } : {}),
          });
          if (!config) {
            setMessage('Check the allowed keys and HTTPS origin.');
            return;
          }
          const r = await fetch('/api/tracker', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              teamId,
              config,
              ...(token ? { token } : {}),
            }),
          });
          const value: unknown = await r.json();
          const error = z.object({ error: z.string() }).safeParse(value);
          setMessage(
            r.ok ? 'Tracker settings saved.' : error.success ? error.data.error : 'The tracker could not be saved.',
          );
          if (r.ok) setToken('');
        }}
      >
        <label>
          Tracker
          <select name="provider" className="field" value={provider} onChange={(e) => setProvider(e.target.value)}>
            {ISSUE_TRACKERS.map((t) => (
              <option key={t} value={t}>
                {TRACKER_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label>
          {provider === 'linear' ? 'Project keys' : 'Repository or project scopes'}
          <input
            name="keys"
            className="field"
            value={keys}
            onChange={(e) => setKeys(e.target.value)}
            placeholder="ENG, APP or acme/platform"
          />
        </label>
        {provider === 'linear' && (
          <label>
            Linear workspace slug
            <input
              name="workspace"
              className="field"
              value={workspace}
              onChange={(e) => setWorkspace(e.target.value)}
            />
          </label>
        )}
        {['jira', 'youtrack', 'monday'].includes(provider) && (
          <label>
            Tracker HTTPS origin
            <input
              name="baseUrl"
              className="field"
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://example.atlassian.net"
            />
          </label>
        )}
        <details className="tracker-status">
          <summary>Read-only status connection</summary>
          <div className="form-stack mt-4">
            <label>
              Access token (optional)
              <input
                name="token"
                className="field"
                type="password"
                autoComplete="off"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
            </label>
            <p>Use OAuth or an encrypted token to show read-only issue status.</p>

            {['linear', 'jira', 'asana', 'monday'].includes(provider) && (
              <Button
                type="button"
                variant="outline"
                onClick={async () => {
                  const r = await fetch('/api/tracker/connect', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ teamId, provider }),
                  });
                  const value: unknown = await r.json();
                  const result = z
                    .object({
                      url: z.url().optional(),
                      error: z.string().optional(),
                    })
                    .safeParse(value);
                  if (result.success && result.data.url && result.data.url.startsWith('https://'))
                    window.location.assign(result.data.url);
                  else
                    setMessage(
                      result.success ? (result.data.error ?? 'OAuth is unavailable.') : 'OAuth is unavailable.',
                    );
                }}
              >
                Connect read-only OAuth
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              onClick={async () => {
                const config = parseIssueTracker({
                  provider,
                  keys: keys
                    .split(',')
                    .map((k) => k.trim())
                    .filter(Boolean),
                  ...(baseUrl ? { baseUrl } : {}),
                  ...(workspace ? { workspace } : {}),
                });
                if (!config) return;
                const r = await fetch('/api/tracker', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ teamId, config, token: '' }),
                });
                setMessage(
                  r.ok
                    ? 'Tracker credentials removed. Links remain available.'
                    : 'The connection could not be removed.',
                );
              }}
            >
              Disconnect status connection
            </Button>
          </div>
        </details>
        <Button type="submit" variant="outline">
          Save tracker settings
        </Button>{' '}
        <p role="status">{message}</p>
      </form>
    </section>
  );
}
