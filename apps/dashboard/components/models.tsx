'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { z } from 'zod';
import { BookOpen } from 'lucide-react';
import { Button, buttonVariants } from '@geld/ui';
import { EmptyState } from './app-shell';
const modelsSchema = z.object({
  someUnavailable: z.boolean().default(false),
  models: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      provider: z.string(),
      instance: z.string(),
    }),
  ),
});
export function Models() {
  const [models, setModels] = useState<z.infer<typeof modelsSchema>['models']>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  const [someUnavailable, setSomeUnavailable] = useState(false);
  const [revision, setRevision] = useState(0);
  async function choose(instance: string, model: string) {
    try {
      const response = await fetch('/api/ai/providers');
      const value: unknown = await response.json();
      const parsed = z
        .object({
          providers: z.array(
            z.object({
              id: z.string(),
              provider: z.string(),
              label: z.string(),
              base_url: z.string().nullable(),
              enabled: z.boolean(),
              settings: z.object({
                mode: z.string().optional(),
                automaticLadder: z.boolean().optional(),
              }),
            }),
          ),
        })
        .safeParse(value);
      const provider = parsed.success ? parsed.data.providers.find((provider) => provider.id === instance) : null;
      if (!provider) return;
      if (provider.provider === 'geld') {
        setMessage('Geld chooses its managed model. Enable Geld AI in provider settings.');
        return;
      }
      const saved = await fetch('/api/ai/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: provider.id,
          provider: provider.provider,
          mode: provider.settings.mode ?? 'api',
          label: provider.label,
          baseUrl: provider.base_url ?? undefined,
          enabled: provider.enabled,
          models: [model],
          automaticLadder: true,
        }),
      });
      setMessage(saved.ok ? 'Model selected for this provider.' : 'The model could not be saved.');
    } catch {
      setMessage('The model could not be saved.');
    }
  }
  useEffect(() => {
    const abort = new AbortController();
    fetch('/api/ai/models', { signal: abort.signal })
      .then(async (response) => {
        const value: unknown = await response.json();
        const parsed = modelsSchema.safeParse(value);
        if (abort.signal.aborted) return;
        if (response.ok && parsed.success) {
          setModels(parsed.data.models);
          setSomeUnavailable(parsed.data.someUnavailable);
        } else setSomeUnavailable(true);
        setLoading(false);
      })
      .catch(() => {
        if (!abort.signal.aborted) {
          setSomeUnavailable(true);
          setLoading(false);
        }
      });
    return () => abort.abort();
  }, [revision]);
  return (
    <div className="page">
      <p className="eyebrow">MODELS</p>
      <h1>Choose what does the thinking.</h1>
      <p className="muted mt-3">
        Models come from your connected providers. The automatic ladder tries them in the order you choose.
      </p>
      {someUnavailable && (
        <div className="status-message" role="status">
          <p>Some provider catalogs could not be loaded. Check your connections or try again.</p>
          <Button
            variant="outline"
            onClick={() => {
              setLoading(true);
              setRevision((value) => value + 1);
            }}
            disabled={loading}
          >
            Retry loading models
          </Button>{' '}
          <Link href="/settings/providers">Check connections</Link>
        </div>
      )}
      {message && (
        <p className="status-message" role="status">
          {message}
        </p>
      )}
      {models.length > 0 && (
        <label className="form-stack mt-6">
          Find a model
          <input
            className="field"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search model IDs and names"
          />
        </label>
      )}
      {models.length ? (
        <div className="settings-card">
          {models
            .filter((model) => `${model.id} ${model.name}`.toLowerCase().includes(query.toLowerCase()))
            .map((model) => (
              <div className="settings-row" key={`${model.instance}:${model.id}`}>
                <BookOpen size={20} />
                <div>
                  <h3>{model.name}</h3>
                  <p>
                    {model.id} · {model.provider}
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => choose(model.instance, model.id)}>
                  Use this model
                </Button>
              </div>
            ))}
        </div>
      ) : (
        <EmptyState
          icon={BookOpen}
          title={
            loading
              ? 'Loading available models...'
              : someUnavailable
                ? 'Models could not be loaded'
                : 'No models connected yet'
          }
          action={
            <div className="flex gap-3">
              <Link href="/settings/providers?enable=geld" className={buttonVariants()}>
                Enable Geld AI
              </Link>
              <Link href="/settings/providers" className={buttonVariants({ variant: 'outline' })}>
                Provider settings
              </Link>
            </div>
          }
        >
          Enable Geld behind a cost confirmation, or connect your own provider to see its models.
        </EmptyState>
      )}
    </div>
  );
}
