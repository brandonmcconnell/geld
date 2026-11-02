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
import { AuthFrame } from './auth-frame';
import { useDashboard } from './app-shell';
type SignInMethod = 'otp' | 'magic' | 'password' | 'sso';
const signInMethods: readonly { id: SignInMethod; label: string }[] = [
  { id: 'otp', label: 'Email code' },
  { id: 'magic', label: 'Magic link' },
  { id: 'password', label: 'Password' },
  { id: 'sso', label: 'SSO' },
];
export function SignInForm({ intent = 'signin' }: { readonly intent?: 'signin' | 'signup' }) {
  const { session, refresh } = useDashboard();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [sent, setSent] = useState(false);
  const [method, setMethod] = useState<SignInMethod>('otp');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  function chooseMethod(next: SignInMethod) {
    setMethod(next);
    setSent(false);
    setPassword('');
    setOtp('');
    setMessage('');
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
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      if (method === 'sso') {
        const response = await fetch('/api/sso/sign-in', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        const value: unknown = await response.json();
        const success = z.object({ url: z.url() }).safeParse(value);
        const error = z.object({ error: z.string() }).safeParse(value);
        if (response.ok && success.success) {
          const target = new URL(success.data.url);
          if (target.protocol === 'https:') window.location.assign(target.href);
        } else setMessage(error.success ? error.data.error : 'SSO could not connect.');
      } else if (method === 'password') {
        const result = await authClient.signIn.email({ email, password, callbackURL: '/connect' });
        if (result.error) setMessage('Email or password could not be verified.');
        else {
          setPassword('');
          refresh();
          router.push('/connect');
        }
      } else if (method === 'magic') {
        const result = await authClient.signIn.magicLink({ email, callbackURL: '/connect' });
        setMessage(
          result.error ? 'The sign-in link could not be sent. Try again.' : 'Check your email for a sign-in link.',
        );
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
  return (
    <AuthFrame>
      <div className="auth-form">
        <p className="eyebrow">YOUR REVIEW WORKSPACE</p>
        <h1>{intent === 'signup' ? 'Create your account' : 'Welcome back'}</h1>
        <p className="auth-description">
          {intent === 'signup'
            ? 'Your code, your providers, one clear workspace.'
            : 'Sign in to your workspace. Pick up where you left off.'}
        </p>
        {!session.configured && (
          <div className="status-message" role="status">
            Sign-in is not configured in this environment.
          </div>
        )}
        <div className="social-signin">
          {['github', 'gitlab', 'bitbucket'].map((provider) => (
            <Button
              variant="outline"
              key={provider}
              disabled={busy || !session.configured}
              data-measure="provider-connect"
              onClick={() => social(provider)}
            >
              {provider === 'github' ? 'GitHub' : provider === 'gitlab' ? 'GitLab' : 'Bitbucket'}
              <ArrowRight size={15} />
            </Button>
          ))}
        </div>
        <div className="form-divider">or continue with email</div>
        <div className="auth-methods" role="group" aria-label="Sign-in method">
          {signInMethods
            .filter((option) => intent === 'signin' || option.id === 'otp' || option.id === 'magic')
            .map((option) => (
              <button
                type="button"
                key={option.id}
                aria-pressed={method === option.id}
                disabled={busy}
                onClick={() => chooseMethod(option.id)}
              >
                {option.label}
              </button>
            ))}
        </div>
        <form className="form-stack" onSubmit={submit}>
          <label>
            Email address
            <input
              name="email"
              className="field"
              type="email"
              autoComplete={method === 'password' ? 'username' : 'email'}
              value={email}
              required
              onChange={(event) => setEmail(event.target.value)}
              disabled={sent}
            />
          </label>
          {method === 'password' && (
            <label>
              Password
              <input
                name="password"
                className="field"
                type="password"
                autoComplete="current-password"
                value={password}
                required
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
          )}
          {sent && (
            <label>
              One-time code
              <input
                name="otp"
                className="field"
                value={otp}
                onChange={(event) => setOtp(event.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                required
              />
            </label>
          )}
          <Button type="submit" disabled={busy || !session.configured}>
            <Mail size={15} />
            {busy
              ? 'Connecting...'
              : method === 'password'
                ? 'Sign in with password'
                : method === 'sso'
                  ? 'Continue with company SSO'
                  : sent
                    ? 'Verify code'
                    : method === 'magic'
                      ? 'Send a sign-in link'
                      : 'Send a one-time code'}
          </Button>
          {sent && (
            <button className="auth-text-button" type="button" disabled={busy} onClick={() => chooseMethod('otp')}>
              Use a different email
            </button>
          )}
          {method === 'password' && (
            <Link className="auth-text-button" href="/forgot-password">
              Forgot password?
            </Link>
          )}
        </form>
        {message && (
          <div className="status-message" role="status">
            {message}
          </div>
        )}
        <p className="auth-switch">
          {intent === 'signup' ? 'Already have an account?' : 'New to Geld?'}{' '}
          <Link href={intent === 'signup' ? '/sign-in' : '/sign-up'}>
            {intent === 'signup' ? 'Sign in' : 'Create an account'}
          </Link>
        </p>
        <p className="auth-legal">
          By continuing, you agree to the{' '}
          <Link href="https://www.geld.sh/privacy" className="underline">
            privacy policy
          </Link>
          . You can connect a Git provider later.
        </p>
      </div>
    </AuthFrame>
  );
}
