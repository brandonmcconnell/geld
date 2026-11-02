'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Check, CodeXml, GitFork, Link2 } from 'lucide-react';
import { z } from 'zod';
import { Button, buttonVariants } from '@geld/ui';
import { authClient } from '@/lib/auth-client';
import { useDashboard } from './app-shell';
const accountsSchema = z.array(z.object({ id: z.string(), providerId: z.string(), accountId: z.string() }));
export function Connections() {
  const { session } = useDashboard();
  const [accounts, setAccounts] = useState<z.infer<typeof accountsSchema>>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { const abort = new AbortController(); fetch('/api/auth/list-accounts', { signal: abort.signal }).then(async (r) => { const value: unknown = await r.json(); const parsed = accountsSchema.safeParse(value); if (parsed.success) setAccounts(parsed.data); }).catch(() => undefined); return () => abort.abort(); }, []);
  async function connect(provider: string) {
    setBusy(true); setMessage('');
    try { const result = await authClient.linkSocial({ provider, callbackURL: '/connect' }); if (result.error) setMessage('This connection is not configured or could not be authorized.'); } catch { setMessage('This provider could not connect. Try again.'); }
    setBusy(false);
  }
  return <div className="page"><div className="page-heading"><div><p className="eyebrow">YOUR CONNECTIONS</p><h1>Bring your work together.</h1><p>Connect the providers you use. Your provider permissions stay in control.</p></div><Link href="/" className={buttonVariants({ variant: 'outline', size: 'sm' })}>Go to review queue</Link></div>
    {!session.user && <div className="status-message">Sign in to connect your repositories. <Link href="/sign-in" className="underline">Continue to sign-in</Link></div>}
    <section className="settings-card"><h2>Git providers</h2><p>Use one Geld account across GitHub, GitLab and Bitbucket. Email-only accounts can connect a provider whenever they are ready.</p>{[{ provider: 'github', name: 'GitHub', icon: CodeXml }, { provider: 'gitlab', name: 'GitLab', icon: GitFork }, { provider: 'bitbucket', name: 'Bitbucket', icon: Link2 }].map(({ provider, name, icon: Icon }) => <div className="settings-row" key={provider}><Icon size={21}/><div><h3>{name}</h3><p>{accounts.some((account) => account.providerId === provider) ? 'Identity connected' : 'Sign in as yourself to see your repositories.'}</p></div><Button variant="outline" size="sm" disabled={busy || !session.configured} onClick={() => connect(provider)}>{accounts.some((account) => account.providerId === provider) ? <Check size={14}/> : null}{accounts.some((account) => account.providerId === provider) ? 'Reconnect' : 'Connect'}</Button></div>)}</section>
    <section className="settings-card"><h2>GitHub repository access</h2><p>The repository App is separate from sign-in. Install it on each organisation whose private repositories you want to review.</p><div className="settings-row"><CodeXml size={21}/><div><h3>Selected repositories</h3><p>Choose repositories on GitHub, then return to select which appear in Geld.</p></div><Link href="/api/install/github" className={buttonVariants({ variant: 'outline', size: 'sm' })}>Install repository App <ArrowUpRight size={14}/></Link></div><div className="settings-row"><Link2 size={21}/><div><h3>Authorize the repository connection</h3><p>Connect the repository App as yourself after installing it.</p></div><Button size="sm" variant="outline" disabled={busy || !session.configured} onClick={() => connect('github-repository')}>Authorize</Button></div><details className="mt-5"><summary className="text-xs cursor-pointer">Optional access through an OAuth app</summary><p className="muted mt-3 mb-3">GitHub&apos;s repo scope grants read and write access to every repository your account can reach. This is optional. Use selected repository installations for narrower access.</p><Button variant="outline" size="sm" disabled={busy || !session.configured} onClick={() => connect('github-oauth')}>Authorize optional OAuth app</Button></details></section>
    <section className="settings-card"><h2>Your account email</h2><p>{session.user?.email ?? 'Sign in to choose your email.'} You can keep your verified provider email or verify a custom address.</p><Link href="/settings/account" className={buttonVariants({ variant: 'outline', size: 'sm' })}>Choose another email</Link></section>
    {message && <div className="status-message" role="status">{message}</div>}</div>;
}
