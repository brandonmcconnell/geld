'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, Mail } from 'lucide-react';
import { Button } from '@geld/ui';
import { authClient } from '@/lib/auth-client';
import { Brand } from './brand';
import { useDashboard } from './app-shell';
export function SignInForm() {
  const { session, refresh } = useDashboard();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [sent, setSent] = useState(false);
  const [method, setMethod] = useState('otp');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function social(provider: string) {
    setBusy(true); setMessage('');
    try { const result = await authClient.signIn.social({ provider, callbackURL: '/connect' }); if (result.error) setMessage('This provider is not configured or could not connect.'); } catch { setMessage('Sign-in could not connect. Try again.'); }
    setBusy(false);
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      if (method === 'magic') {
        const result = await authClient.signIn.magicLink({ email, callbackURL: '/connect' });
        setMessage(result.error ? 'The sign-in link could not be sent. Try again.' : 'Check your email for a sign-in link.');
      } else if (!sent) {
        const result = await authClient.emailOtp.sendVerificationOtp({ email, type: 'sign-in' });
        if (result.error) setMessage('The sign-in code could not be sent. Try again.'); else { setSent(true); setMessage('A sign-in code is on its way to your email.'); }
      } else {
        const result = await authClient.signIn.emailOtp({ email, otp });
        if (result.error) setMessage('This code is invalid or has expired.'); else { refresh(); router.push('/connect'); }
      }
    } catch { setMessage('Sign-in is temporarily unavailable. Try again.'); }
    setBusy(false);
  }
  return <div className="page"><div className="form-card"><Brand/><h1>Your next review starts here.</h1><p>Bring your repositories together. Keep the change in focus.</p>
    {!session.configured && <div className="status-message" role="status">Sign-in is not configured in this environment.</div>}
    <div className="form-stack">{['github','gitlab','bitbucket'].map((provider) => <Button variant="outline" key={provider} disabled={busy || !session.configured} onClick={() => social(provider)}>Continue with {provider === 'github' ? 'GitHub' : provider === 'gitlab' ? 'GitLab' : 'Bitbucket'}<ArrowRight size={15}/></Button>)}</div><div className="form-divider">or use your email</div>
    <form className="form-stack" onSubmit={submit}><label>Email address<input className="field" type="email" autoComplete="email" value={email} required onChange={(event) => setEmail(event.target.value)} disabled={sent}/></label>{sent && <label>One-time code<input className="field" value={otp} onChange={(event) => setOtp(event.target.value)} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required/></label>}<Button type="submit" disabled={busy || !session.configured}><Mail size={15}/>{busy ? 'Connecting...' : sent ? 'Verify code' : method === 'magic' ? 'Send a sign-in link' : 'Send a one-time code'}</Button><Button variant="ghost" size="sm" type="button" onClick={() => { setMethod((value) => value === 'otp' ? 'magic' : 'otp'); setSent(false); setMessage(''); }}>{method === 'otp' ? 'Use a magic link instead' : 'Use a one-time code instead'}</Button></form>
    {message && <div className="status-message" role="status">{message}</div>}<p>By continuing, you agree to the <Link href="https://www.geld.sh/privacy" className="underline">privacy policy</Link>. You can connect a Git provider later.</p></div></div>;
}
