'use client';
import { useEffect, useState } from 'react';
import {
  CATEGORY_IDS,
  DEFAULT_SETTINGS,
  validateSettingsDocument,
  isCategoryEnabled,
  withCategoryEnabled,
  categoryById,
} from '@geld/core';
import { z } from 'zod';
import { Button } from '@/components/button';
export function ReviewPreferences() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [document, setDocument] = useState(JSON.stringify(DEFAULT_SETTINGS, null, 2));
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    fetch('/api/preferences', { signal: abort.signal })
      .then(async (r) => {
        const value: unknown = await r.json();
        const parsed = z.object({ settings: z.unknown() }).safeParse(value);
        if (parsed.success) {
          const result = validateSettingsDocument(JSON.stringify(parsed.data.settings));
          if (result.ok) {
            setSettings(result.settings);
            setDocument(JSON.stringify(result.settings, null, 2));
          }
        }
      })
      .catch(() => undefined);
    return () => abort.abort();
  }, []);
  async function act(action: 'save' | 'import_gist' | 'export_gist', draft = document): Promise<boolean> {
    setBusy(true);
    try {
      const r = await fetch('/api/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, document: draft }),
      });
      const value: unknown = await r.json();
      const response = z.object({ settings: z.unknown().optional(), error: z.string().optional() }).safeParse(value);
      if (!r.ok) {
        setMessage(
          response.success
            ? (response.data.error ?? 'Preferences could not be saved.')
            : 'Preferences could not be saved.',
        );
        return false;
      } else {
        if (response.success && response.data.settings) {
          const parsed = validateSettingsDocument(JSON.stringify(response.data.settings));
          if (parsed.ok) {
            setSettings(parsed.settings);
            setDocument(JSON.stringify(parsed.settings, null, 2));
          }
        }
        setMessage(
          action === 'import_gist'
            ? 'GitHub settings loaded for review. Save to use them in Geld.'
            : action === 'export_gist'
              ? 'Settings written to your GitHub gist.'
              : 'Review preferences saved.',
        );
        return true;
      }
    } catch {
      setMessage('Preferences could not connect.');
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page">
      <h1>Review preferences</h1>
      <p>Choose which files Geld hides by default. Hidden files remain available in Diff.</p>
      <section className="settings-card">
        <h2>Hidden categories</h2>
        {CATEGORY_IDS.map((category) => (
          <label className="settings-row" key={category}>
            <span>{categoryById(category).title}</span>
            <input
              name="value"
              type="checkbox"
              checked={isCategoryEnabled(settings, category)}
              onChange={(e) => {
                const next = withCategoryEnabled(settings, category, e.target.checked);
                setSettings(next);
                setDocument(JSON.stringify(next, null, 2));
              }}
            />
          </label>
        ))}
        <Button disabled={busy} onClick={() => act('save')}>
          Save preferences
        </Button>
      </section>
      <section className="settings-card">
        <h2>GitHub settings sync</h2>
        <p>
          Import reviews the gist before adopting it. Export writes the document shown below. Identity App access is
          separate from repository Apps.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" disabled={busy} onClick={() => act('import_gist')}>
            Import for review
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => act('export_gist')}>
            Export to gist
          </Button>
        </div>
      </section>
      <section className="settings-card">
        <details>
          <summary>Advanced settings document</summary>
          <p>Includes personal repository rules, categories and the fallback issue tracker.</p>
          <label className="sr-only" htmlFor="review-settings-json">
            Settings JSON
          </label>
          <textarea
            name="review-settings-json"
            id="review-settings-json"
            className="field font-mono w-full"
            rows={20}
            value={document}
            onChange={(e) => setDocument(e.target.value)}
          />
          <Button variant="outline" disabled={busy} onClick={() => act('save')}>
            Validate and save document
          </Button>
        </details>
      </section>
      <p role="status">{message}</p>
    </div>
  );
}
