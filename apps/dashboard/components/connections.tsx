'use client';
import { RepositorySelection } from './repository-selection';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowUpRight, Check, CodeXml, GitFork, Link2 } from '@/components/icons';
import { z } from 'zod';
import { Button, buttonVariants } from '@/components/button';
import { measure } from '@/lib/measurement';
import { authClient } from '@/lib/auth-client';
import { useDashboard } from './app-shell';
const accountsSchema = z.array(z.object({ id: z.string(), providerId: z.string(), accountId: z.string() }));
export function Connections() {
  const { session } = useDashboard();
  const [accounts, setAccounts] = useState<z.infer<typeof accountsSchema>>([]);
  const [message, setMessage] = useState('');
  const params = useSearchParams();
  const setupNeeded = params.get('repository') === 'setup-needed';
  const [view, setView] = useState(params.get('view') === 'repositories' || setupNeeded ? 'repositories' : 'accounts');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    fetch('/api/auth/list-accounts', { signal: abort.signal })
      .then(async (r) => {
        const value: unknown = await r.json();
        const parsed = accountsSchema.safeParse(value);
        if (parsed.success) {
          setAccounts(parsed.data);
          for (const provider of ['github', 'gitlab', 'bitbucket'])
            if (parsed.data.some((account) => account.providerId === provider)) {
              const source = provider === 'github' ? 'github' : provider === 'gitlab' ? 'gitlab' : 'bitbucket';
              measure('provider_setup', {
                feature: 'connections',
                provider: source,
                stage: 'connected',
              });
            }
        }
      })
      .catch(() => undefined);
    return () => abort.abort();
  }, []);
  async function connect(provider: string) {
    const source = provider === 'github' || provider === 'gitlab' || provider === 'bitbucket' ? provider : undefined;
    measure('provider_setup', {
      feature: 'connections',
      stage: 'started',
      ...(source ? { provider: source } : {}),
    });
    setBusy(true);
    setMessage('');
    try {
      const result = await authClient.linkSocial({
        provider,
        callbackURL: provider === 'github' ? '/api/apps/connect' : '/connect',
      });
      if (result.error) setMessage('This connection is not configured or could not be authorized.');
    } catch {
      setMessage('This Git account could not connect. Try again.');
    }
    setBusy(false);
  }
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <h1>Git connections</h1>
        </div>
        <Link href="/" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          Review queue
        </Link>
      </div>
      <div className="queue-tabs" role="tablist" aria-label="Connection setup">
        <button
          type="button"
          role="tab"
          aria-selected={view === 'accounts'}
          className={'queue-tab' + (view === 'accounts' ? ' selected' : '')}
          onClick={() => setView('accounts')}
        >
          Git accounts
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'repositories'}
          className={'queue-tab' + (view === 'repositories' ? ' selected' : '')}
          onClick={() => setView('repositories')}
        >
          Repository access
        </button>
      </div>
      {setupNeeded && (
        <div className="status-message">
          The repository App is not configured for this deployment yet. A provider admin can install a matching App from
          team settings. Public provider views, the extension and optional OAuth remain available.
        </div>
      )}
      {!session.user && (
        <div className="status-message">
          Sign in to connect your repositories.{' '}
          <Link href="/sign-in" className="underline">
            Continue to sign-in
          </Link>
        </div>
      )}
      <section className="settings-card" hidden={view !== 'accounts'}>
        <h2>{accounts.length ? 'Connected accounts' : 'Connect your Git account'}</h2>
        <p>Sign in to a Git host, then choose which repositories to review.</p>
        {[
          { provider: 'github', name: 'GitHub', icon: CodeXml },
          { provider: 'gitlab', name: 'GitLab', icon: GitFork },
          { provider: 'bitbucket', name: 'Bitbucket', icon: Link2 },
        ].map(({ provider, name, icon: Icon }) => (
          <div className="settings-row" key={provider}>
            <Icon size={21} />
            <div>
              <h3>{name}</h3>
              <p>
                {accounts.some((account) => account.providerId === provider)
                  ? 'Identity connected'
                  : 'Sign in as yourself to see your repositories.'}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={busy || !session.configured}
              data-measure="provider-connect"
              onClick={() => connect(provider)}
            >
              {accounts.some((account) => account.providerId === provider) ? <Check size={14} /> : null}
              {accounts.some((account) => account.providerId === provider) ? 'Reconnect' : 'Connect'}
            </Button>
          </div>
        ))}
      </section>
      <section className="settings-card" hidden={view !== 'repositories'}>
        <h2>GitHub repository access</h2>
        <p>
          The repository App is separate from sign-in. Install it on each organisation whose private repositories you
          want to review.
        </p>
        <div className="settings-row">
          <CodeXml size={21} />
          <div>
            <h3>Selected repositories</h3>
            <p>Choose repositories on GitHub, then return to select which appear in Geld.</p>
          </div>
          <Link href="/api/install/github" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            Install repository App <ArrowUpRight size={14} />
          </Link>
        </div>
        <div className="settings-row">
          <Link2 size={21} />
          <div>
            <h3>Authorize the repository connection</h3>
            <p>Connect the repository App as yourself after installing it.</p>
          </div>
          <Link href="/api/apps/connect" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            Authorize
          </Link>
        </div>
        <details className="mt-5">
          <summary className="text-xs cursor-pointer">Optional access through an OAuth app</summary>
          <p className="muted mt-3 mb-3">
            GitHub&apos;s repo scope grants read and write access to every repository your account can reach. This is
            optional. Use selected repository installations for narrower access.
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || !session.configured}
            onClick={() => connect('github-oauth')}
          >
            Authorize optional OAuth app
          </Button>
        </details>
      </section>
      <div hidden={view !== 'repositories'}>
        <RepositorySelection key={session.user?.id ?? 'signed-out'} />
      </div>
      {view === 'accounts' && accounts.length > 0 && (
        <div className="connection-next">
          <span className="muted">Next, choose repository access.</span>
          <Button size="sm" onClick={() => setView('repositories')}>
            Continue
            <ArrowUpRight size={14} />
          </Button>
        </div>
      )}
      {message && (
        <div className="status-message" role="status">
          {message}
        </div>
      )}
    </div>
  );
}
