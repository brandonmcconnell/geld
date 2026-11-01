'use client';
import { z } from 'zod';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, Mail } from 'lucide-react';
import { Button } from '@geld/ui';
import { measure } from '@/lib/measurement';
import { authClient } from '@/lib/auth-client';
import { Brand } from './brand';
import { useDashboard } from './app-shell';
export function SignInForm() {
  const { session, refresh } = useDashboard();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [sent, setSent] = useState(false);
  const [method, setMethod] = useState<'otp' | 'magic' | 'password' | 'sso'>('otp');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  function chooseMethod(next: 'otp' | 'magic' | 'password' | 'sso') {
    setMethod(next); setSent(false); setPassword(''); setOtp(''); setMessage('');
  }
  async function social(provider: string) {
    const source = provider === 'github' || provider === 'gitlab' || provider === 'bitbucket' ? provider : undefined;
    measure('provider_setup', {
      feature: 'connections',
      stage: 'started',
      ...(source ? { provider: source } : {}),
    });
    setBusy(true);
    setMessage('');
    try {
      const result = await authClient.signIn.social({
        provider,
        callbackURL: provider === 'github' ? '/api/apps/connect' : '/connect',
      });
      if (result.error) setMessage('This provider is not configured or could not connect.');
    } catch {
      setMessage('Sign-in could not connect. Try again.');
    }
    setBusy(false);
  }
  async function sendReset() {
    setBusy(true); setMessage('');
    try {
      const result = await authClient.requestPasswordReset({ email, redirectTo: '/settings/account/reset-password' });
      setMessage(result.error ? 'A reset link could not be sent. Try again.' : 'If this address has an account, a password reset link is on its way.');
    } catch { setMessage('A reset link could not be sent. Try again.'); }
    setBusy(false);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      if(method==='sso'){const response=await fetch('/api/sso/sign-in',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email})});const value:unknown=await response.json();const success=z.object({url:z.url()}).safeParse(value);const error=z.object({error:z.string()}).safeParse(value);if(response.ok&&success.success){const target=new URL(success.data.url);if(target.protocol==='https:')window.location.assign(target.href);}else setMessage(error.success?error.data.error:'SSO could not connect.');
      }else if (method === 'password') {
        const result = await authClient.signIn.email({ email, password, callbackURL: '/connect' });
        if (result.error) setMessage('Email or password could not be verified.');
        else { setPassword(''); refresh(); router.push('/connect'); }
      } else if (method === 'magic') {
        const result = await authClient.signIn.magicLink({ email, callbackURL: '/connect' });
        setMessage(result.error ? 'The sign-in link could not be sent. Try again.' : 'Check your email for a sign-in link.');
      } else if (!sent) {
        const result = await authClient.emailOtp.sendVerificationOtp({
          email,
          type: 'sign-in',
        });
        if (result.error) setMessage('The sign-in code could not be sent. Try again.');
        else {
          setSent(true);
          setMessage('A sign-in code is on its way to your email.');
        }
      } else {
        const result = await authClient.signIn.emailOtp({ email, otp });
        if (result.error) setMessage('This code is invalid or has expired.');
        else {
          refresh();
          router.push('/connect');
        }
      }
    } catch {
      setMessage('Sign-in is temporarily unavailable. Try again.');
    }
    setBusy(false);
  }
  return <div className="page"><div className="form-card"><Brand/><h1>Your next review starts here.</h1><p>Bring your repositories together. Keep the change in focus.</p>
    {!session.configured && <div className="status-message" role="status">Sign-in is not configured in this environment.</div>}
    <div className="form-stack">{['github','gitlab','bitbucket'].map((provider) => <Button variant="outline" key={provider} disabled={busy || !session.configured} data-measure="provider-connect" onClick={() => social(provider)}>Continue with {provider === 'github' ? 'GitHub' : provider === 'gitlab' ? 'GitLab' : 'Bitbucket'}<ArrowRight size={15}/></Button>)}</div><div className="form-divider">or use your email</div>
    <form className="form-stack" onSubmit={submit}>
      <label>Email address<input name="email" className="field" type="email" autoComplete={method === 'password' ? 'username' : 'email'} value={email} required onChange={(event) => setEmail(event.target.value)} disabled={sent}/></label>
      {method === 'password' && <label>Password<input className="field" type="password" autoComplete="current-password" value={password} required onChange={(event) => setPassword(event.target.value)}/></label>}
      {sent && <label>One-time code<input className="field" value={otp} onChange={(event) => setOtp(event.target.value)} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required/></label>}
      <Button type="submit" disabled={busy || !session.configured}><Mail size={15}/>{busy ? 'Connecting...' : method === 'password' ? 'Sign in with password' : method==='sso'?'Continue with company SSO':sent ? 'Verify code' : method === 'magic' ? 'Send a sign-in link' : 'Send a one-time code'}</Button>
      <Button variant="ghost" size="sm" type="button" disabled={busy} onClick={() => chooseMethod(method === 'otp' ? 'magic' : 'otp')}>{method === 'otp' ? 'Use a magic link instead' : 'Use a one-time code instead'}</Button>
      {method !== 'password' ? <Button variant="ghost" size="sm" type="button" disabled={busy} onClick={() => chooseMethod('password')}>Use a password instead</Button> : <Button variant="ghost" size="sm" type="button" disabled={busy || !session.configured} onClick={(event) => { const input = event.currentTarget.form?.elements.namedItem('email'); if (input instanceof HTMLInputElement && input.reportValidity()) void sendReset(); }}>Email a password reset link</Button>}
      <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={()=>chooseMethod(method==='sso'?'otp':'sso')}>{method==='sso'?'Use an email code instead':'Use company SSO'}</Button>
    </form>
    {message && <div className="status-message" role="status">{message}</div>}<p>By continuing, you agree to the <Link href="https://www.geld.sh/privacy" className="underline">privacy policy</Link>. You can connect a Git provider later.</p></div></div>;
}
