'use client';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@geld/ui';
import { authClient } from '@/lib/auth-client';
export function PasswordReset() {
  const params = useSearchParams();
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  return <div className="page"><div className="form-card"><h1>Set your password</h1><p>Use at least 12 characters. You can keep using email links and provider sign-in.</p><form className="form-stack" onSubmit={async (event) => { event.preventDefault(); setBusy(true); try { const result = await authClient.resetPassword({ newPassword: password, token: params.get('token') ?? '' }); setMessage(result.error ? 'This reset link is invalid or has expired.' : 'Your password has been saved.'); } catch { setMessage('Your password could not be saved.'); } setBusy(false); }}><label>New password<input className="field" type="password" minLength={12} autoComplete="new-password" value={password} required onChange={(event) => setPassword(event.target.value)}/></label><Button type="submit" disabled={busy}>Save password</Button></form>{message && <p role="status">{message}</p>}</div></div>;
}
