'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@geld/ui';
import { authClient } from '@/lib/auth-client';
import { useDashboard } from './app-shell';
export function AccountSettings() {
  const { session, refresh } = useDashboard();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function perform(action: 'email' | 'password' | 'delete' | 'signout') {
    setBusy(true); setMessage('');
    try {
      if (action === 'email') { const result = await authClient.changeEmail({ newEmail: email, callbackURL: '/settings/account' }); setMessage(result.error ? 'Your email could not be changed.' : 'Check your inbox to verify the new address.'); }
      if (action === 'password' && session.user) { const result = await authClient.requestPasswordReset({ email: session.user.email, redirectTo: '/settings/account/reset-password' }); setMessage(result.error ? 'The password link could not be sent.' : 'Check your email for a link to set or reset your password.'); }
      if (action === 'delete') { const result = await authClient.deleteUser({ callbackURL: '/sign-in' }); setMessage(result.error ? 'Deletion could not be started.' : 'Check your email to confirm permanent account deletion.'); }
      if (action === 'signout') { await authClient.signOut(); refresh(); router.push('/sign-in'); }
    } catch { setMessage('This action is temporarily unavailable.'); }
    setBusy(false);
  }
  return <div className="page"><div className="page-heading"><div><p className="eyebrow">ACCOUNT</p><h1>Your account</h1><p>Control your identity, security and data.</p></div></div><section className="settings-card"><h2>Email address</h2><p>{session.user?.email ?? 'Sign in to manage your account.'}</p><form className="form-stack max-w-md" onSubmit={(event) => { event.preventDefault(); void perform('email'); }}><label>New email<input className="field" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)}/></label><Button variant="outline" type="submit" disabled={busy || !session.configured}>Verify new email</Button></form></section><section className="settings-card"><h2>Password</h2><p>A password is optional. Use a verified email link to set or reset one.</p><Button variant="outline" disabled={busy || !session.configured} onClick={() => perform('password')}>Send a password setup link</Button></section><section className="settings-card"><h2>Your data</h2><p>Export your account and team records as JSON, or request permanent deletion. Removing a repository from a team does not erase your account.</p><div className="flex gap-3 flex-wrap"><a download="geld-account.json" href="/api/account/export" className="underline text-xs">Export my data</a><Button variant="outline" size="sm" disabled={busy || !session.configured} onClick={() => perform('delete')}>Send account deletion confirmation</Button></div></section><Button variant="outline" disabled={busy || !session.configured} onClick={() => perform('signout')}>Sign out</Button>{message && <div className="status-message" role="status">{message}</div>}</div>;
}
