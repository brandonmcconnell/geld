'use client';
import { measure } from '@/lib/measurement';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Dialog } from '@base-ui/react/dialog';
import { ChevronDown, CircleHelp, KeyRound, Plus, Sparkles, Trash2, X } from '@/components/icons';
import { z } from 'zod';
import { Button } from '@/components/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { useDashboard } from './app-shell';
const providerSettingsSchema = z.object({
  mode: z.enum(['api', 'login']).optional(),
  models: z.array(z.string()).optional(),
  automaticLadder: z.boolean().optional(),
  billed: z.boolean().optional(),
  safetyNet: z.boolean().optional(),
  capCents: z.number().optional(),
  teamId: z.string().optional(),
});
const rowSchema = z.object({
  id: z.string(),
  provider: z.string(),
  label: z.string(),
  base_url: z.string().nullable(),
  enabled: z.boolean(),
  has_key: z.boolean(),
  settings: providerSettingsSchema,
});
const responseSchema = z.object({ providers: z.array(rowSchema), configured: z.boolean() });
type ProviderRow = z.infer<typeof rowSchema>;
export function AiProviders() {
  const { session, activeTeam } = useDashboard();
  const params = useSearchParams();
  const [rows, setRows] = useState<ProviderRow[]>([]);
  const [revision, setRevision] = useState(0);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(params.get('enable') === 'geld');
  const [provider, setProvider] = useState('gateway');
  const [mode, setMode] = useState<'api' | 'login'>('api');
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('https://ai-gateway.vercel.sh');
  const [key, setKey] = useState('');
  const [model, setModel] = useState('');
  const [ladder, setLadder] = useState(true);
  const [safety, setSafety] = useState(false);
  const [billingTeams, setBillingTeams] = useState<
    Array<{ id: string; name: string; role: string; card_on_file: boolean; cap_cents: number }>
  >([]);
  const [teamId, setTeamId] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const geld = rows.find((row) => row.provider === 'geld');
  const customProviders = rows.filter((row) => row.provider !== 'geld');
  const eligibleTeams = billingTeams.filter((team) => team.role === 'admin' && team.card_on_file && team.cap_cents > 0);
  const billingTeam =
    eligibleTeams.find((team) => team.id === (teamId || geld?.settings.teamId || activeTeam)) ??
    (eligibleTeams.length === 1 ? eligibleTeams[0] : undefined);
  useEffect(() => {
    const abort = new AbortController();
    fetch('/api/billing', { signal: abort.signal })
      .then(async (response) => {
        const parsed = z
          .object({
            teams: z.array(
              z.object({
                id: z.string(),
                name: z.string(),
                role: z.string(),
                card_on_file: z.boolean(),
                cap_cents: z.number(),
              }),
            ),
          })
          .safeParse(await response.json());
        if (response.ok && parsed.success) setBillingTeams(parsed.data.teams);
      })
      .catch(() => undefined);
    return () => abort.abort();
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    fetch('/api/ai/providers', { signal: abort.signal })
      .then(async (r) => {
        const value: unknown = await r.json();
        const parsed = responseSchema.safeParse(value);
        if (parsed.success) {
          setRows(parsed.data.providers);
          const geld = parsed.data.providers.find((row) => row.provider === 'geld');
          if (geld) {
            setSafety(geld.settings.safetyNet ?? false);
          }
        }
      })
      .catch(() => undefined);
    return () => abort.abort();
  }, [revision]);
  async function save(data: unknown): Promise<boolean> {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/ai/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const value: unknown = await response.json();
      const error = z.object({ error: z.string() }).safeParse(value);
      if (!response.ok) {
        setMessage(error.success ? error.data.error : 'Provider settings could not be saved.');
        return false;
      }
      setRevision((value) => value + 1);
      setMessage('Provider settings saved.');
      measure('flow', { feature: 'connections', stage: 'completed' });
      return true;
    } catch {
      setMessage('Provider settings could not be saved.');
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function saveGeld(enabled: boolean, fallback = safety) {
    const previousSafety = safety;
    const previousRows = rows;
    setSafety(fallback);
    setRows((current) =>
      current.map((row) =>
        row.provider === 'geld' ? { ...row, settings: { ...row.settings, billed: enabled, safetyNet: fallback } } : row,
      ),
    );
    const success = await save({
      ...(geld ? { id: geld.id } : {}),
      provider: 'geld',
      label: 'Geld',
      enabled: true,
      billed: enabled,
      models: [],
      automaticLadder: true,
      safetyNet: fallback,
      capCents: billingTeam?.cap_cents ?? geld?.settings.capCents ?? 0,
      ...(billingTeam ? { teamId: billingTeam.id } : geld?.settings.teamId ? { teamId: geld.settings.teamId } : {}),
    });
    if (success) {
      setConfirm(false);
      setSafety(fallback);
    } else {
      setSafety(previousSafety);
      setRows(previousRows);
    }
  }
  return (
    <div className="page provider-settings">
      <h1 className="sr-only">AI providers</h1>
      <section aria-label="Geld provider">
        <div className="provider-row">
          <Sparkles size={20} />
          <div>
            <h3>Geld</h3>
            <p>Guides use your team’s pooled credits.</p>
          </div>
          <label className="toggle-label">
            <input
              name="geldEnabled"
              type="checkbox"
              checked={geld?.settings.billed ?? false}
              onChange={(event) => (event.target.checked ? setConfirm(true) : void saveGeld(false))}
              disabled={busy || !session.configured}
            />
            Enabled
          </label>
        </div>
      </section>
      <section aria-labelledby="other-providers">
        <div className="provider-section-heading">
          <h2 id="other-providers">Other providers</h2>
          {customProviders.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
              <Plus size={14} />
              Add a provider
            </Button>
          )}
        </div>
        {customProviders.length === 0 && (
          <div className="provider-empty">
            <p>No custom providers currently set</p>
            <Button size="sm" onClick={() => setOpen(true)}>
              <Plus size={14} />
              Add a provider
            </Button>
          </div>
        )}
        {customProviders.length > 0 && (
          <div className="provider-fallback">
            <label className="toggle-label">
              <input
                name="safety"
                type="checkbox"
                checked={safety}
                disabled={
                  busy ||
                  !session.configured ||
                  (!safety && (!billingTeam || !customProviders.some((row) => row.enabled)))
                }
                onChange={(event) => void saveGeld(geld?.settings.billed ?? false, event.target.checked)}
              />
              Geld fallback
            </label>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger className="icon-button" aria-label="About Geld fallback">
                  <CircleHelp size={14} />
                  <span className="touch-target" aria-hidden="true" />
                </TooltipTrigger>
                <TooltipContent>
                  Use Geld when your provider cannot respond. Requires a card on file and a spending cap. We email you
                  on the first fallback charge.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {!billingTeam && <Link href="/settings/billing">Set up billing</Link>}
            {eligibleTeams.length > 1 && (
              <label className="fallback-team">
                Bill to
                <select
                  name="fallbackTeam"
                  className="field"
                  value={billingTeam?.id ?? ''}
                  disabled={busy || safety}
                  onChange={(event) => setTeamId(event.target.value)}
                >
                  <option value="" disabled>
                    Choose a team
                  </option>
                  {eligibleTeams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}
        {customProviders.map((row) => (
          <div key={row.id}>
            <div className="provider-row">
              <KeyRound size={22} />
              <div>
                <h3>{row.label}</h3>
                <p>
                  {row.provider === 'claude' && row.settings.mode === 'login'
                    ? 'Claude Code on your computer'
                    : `${row.base_url} · ${row.has_key ? 'Key stored securely' : 'No key configured'}`}
                </p>
                {row.settings.mode !== 'login' && !!row.settings.models?.length && (
                  <p>{row.settings.models.join(', ')}</p>
                )}
                {row.provider === 'claude' && row.settings.mode === 'login' && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const response = await fetch('/api/companion/connect', {
                          method: 'POST',
                          headers: { 'content-type': 'application/json' },
                          body: JSON.stringify({ id: row.id }),
                        });
                        if (!response.ok) {
                          const value: unknown = await response.json();
                          const error = z.object({ error: z.string() }).safeParse(value);
                          setMessage(error.success ? error.data.error : 'Companion could not be paired');
                          return;
                        }
                        const url = URL.createObjectURL(await response.blob());
                        const link = document.createElement('a');
                        link.href = url;
                        link.download = 'geld-companion.json';
                        link.click();
                        URL.revokeObjectURL(url);
                        setMessage(
                          'Pairing downloaded. Run geld-companion pair FILE, then login and serve on your machine. Pairing again revokes the previous connection.',
                        );
                      } catch {
                        setMessage('Companion could not be paired');
                      } finally {
                        setBusy(false);
                      }
                    }}
                    disabled={busy}
                  >
                    Pair local companion
                  </Button>
                )}
              </div>
              <label className="toggle-label">
                <input
                  name="row.enabled"
                  type="checkbox"
                  checked={row.enabled}
                  disabled={busy || !session.configured}
                  onChange={async (event) => {
                    const enabled = event.target.checked;
                    setRows((current) => current.map((item) => (item.id === row.id ? { ...item, enabled } : item)));
                    const success = await save({
                      id: row.id,
                      provider: row.provider,
                      mode: row.settings.mode ?? 'api',
                      label: row.label,
                      baseUrl: row.base_url ?? undefined,
                      enabled,
                      models: row.settings.models ?? [],
                      automaticLadder: row.settings.automaticLadder ?? true,
                    });
                    if (!success) setRows((current) => current.map((item) => (item.id === row.id ? row : item)));
                  }}
                />
                Enabled
              </label>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={busy || !session.configured}
                aria-label={`Remove ${row.label}`}
                onClick={async () => {
                  const response = await fetch('/api/ai/providers', {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: row.id }),
                  });
                  if (response.ok) setRevision((value) => value + 1);
                  else setMessage('Provider could not be removed.');
                }}
              >
                <Trash2 size={15} />
              </Button>
            </div>
          </div>
        ))}
      </section>
      {message && (
        <div className="status-message" role="status">
          {message}
        </div>
      )}
      <Dialog.Root
        open={open}
        onOpenChange={(value) => {
          if (!value) {
            measure('flow', { feature: 'connections', stage: 'abandoned' });
            setKey('');
          }
          setOpen(value);
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="dialog-backdrop" />
          <Dialog.Popup className="privacy-dialog">
            <div className="flex justify-between items-center">
              <Dialog.Title className="text-lg font-medium">Add an AI provider</Dialog.Title>
              <Dialog.Close className="icon-button" aria-label="Close provider setup">
                <X size={18} />
                <span className="touch-target" aria-hidden="true" />
              </Dialog.Close>
            </div>
            <Dialog.Description className="muted mt-2 mb-5">
              Connect a provider with an encrypted API key, or use Claude Code locally.
            </Dialog.Description>
            <form
              className="form-stack"
              onSubmit={async (event) => {
                event.preventDefault();
                const success = await save({
                  provider,
                  mode,
                  label: label || (provider === 'claude' ? 'Claude' : provider === 'openai' ? 'OpenAI' : 'AI gateway'),
                  baseUrl: provider === 'claude' ? 'https://api.anthropic.com' : url,
                  ...(provider === 'claude' && mode === 'login' ? {} : { key }),
                  enabled: true,
                  models: model
                    .split(',')
                    .map((m) => m.trim())
                    .filter(Boolean),
                  automaticLadder: ladder,
                });
                if (success) {
                  setOpen(false);
                  setKey('');
                }
              }}
            >
              <fieldset className="provider-choices">
                <legend className="sr-only">Provider</legend>
                {[
                  { id: 'gateway', label: 'Gateway' },
                  { id: 'openai', label: 'OpenAI' },
                  { id: 'claude', label: 'Claude' },
                ].map((item) => (
                  <label key={item.id}>
                    <input
                      type="radio"
                      name="provider"
                      value={item.id}
                      checked={provider === item.id}
                      onChange={() => {
                        setProvider(item.id);
                        setMode('api');
                        setKey('');
                        setUrl(item.id === 'openai' ? 'https://api.openai.com' : 'https://ai-gateway.vercel.sh');
                      }}
                    />
                    {item.label}
                  </label>
                ))}
              </fieldset>
              {provider === 'claude' && (
                <label>
                  Connect with
                  <select
                    name="mode"
                    className="field"
                    value={mode}
                    onChange={(event) => {
                      setMode(event.target.value === 'login' ? 'login' : 'api');
                      setKey('');
                    }}
                  >
                    <option value="api">API key</option>
                    <option value="login">Claude login through local companion</option>
                  </select>
                </label>
              )}
              {!(provider === 'claude' && mode === 'login') ? (
                <>
                  {provider !== 'claude' && (
                    <label>
                      Gateway or API URL
                      <input
                        name="url"
                        className="field"
                        type="url"
                        value={url}
                        onChange={(event) => setUrl(event.target.value)}
                        required
                      />
                    </label>
                  )}
                  <label>
                    API key
                    <input
                      name="key"
                      className="field"
                      type="password"
                      autoComplete="off"
                      value={key}
                      onChange={(event) => setKey(event.target.value)}
                      required
                    />
                  </label>
                  <Collapsible className="provider-advanced">
                    <CollapsibleTrigger className="provider-advanced-trigger">
                      Advanced options
                      <ChevronDown size={14} />
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="form-stack">
                        <label>
                          Connection name
                          <input
                            name="label"
                            className="field"
                            value={label}
                            onChange={(event) => setLabel(event.target.value)}
                            placeholder="My provider"
                          />
                        </label>
                        <label>
                          Model IDs, in fallback order
                          <input
                            name="model"
                            className="field"
                            value={model}
                            onChange={(event) => setModel(event.target.value)}
                            placeholder="Use IDs from your provider’s model catalog"
                          />
                        </label>
                        <label className="toggle-label">
                          <input
                            name="ladder"
                            type="checkbox"
                            checked={ladder}
                            onChange={(event) => setLadder(event.target.checked)}
                          />
                          Use the automatic model ladder
                        </label>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </>
              ) : (
                <p className="muted">
                  Run Claude Code on your computer with your Claude subscription. Sign in through Anthropic. Your login
                  tokens stay on your computer.
                </p>
              )}
              <div className="dialog-actions provider-dialog-actions">
                <Dialog.Close render={<Button variant="outline" size="sm" />}>Cancel</Dialog.Close>
                <Button type="submit" size="sm" disabled={busy || !session.configured}>
                  {provider === 'claude' && mode === 'login' ? 'Connect Claude Code' : 'Connect provider'}
                </Button>{' '}
              </div>
            </form>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root open={confirm} onOpenChange={setConfirm}>
        <Dialog.Portal>
          <Dialog.Backdrop className="dialog-backdrop" />
          <Dialog.Popup className="privacy-dialog">
            <Dialog.Title className="text-lg font-medium">Enable Geld-billed AI?</Dialog.Title>
            <Dialog.Description className="muted mt-3">
              Guides use pooled credits from your paid plan. A standard guide uses 1 credit, a guide over 1,500 changed
              lines uses 3, and a replan after a push uses 1. Overage follows your plan and team spending cap.
            </Dialog.Description>
            <div className="dialog-actions">
              <Link href="/settings/billing" className="text-xs underline">
                View plans
              </Link>
              <Dialog.Close render={<Button variant="outline" size="sm" />}>Cancel</Dialog.Close>
              <Button size="sm" onClick={() => saveGeld(true)} disabled={busy}>
                Enable Geld AI
              </Button>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
