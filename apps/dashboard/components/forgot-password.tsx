'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Mail } from '@/components/icons';
import { Button } from '@/components/button';
import { authClient } from '@/lib/auth-client';
import { AuthFrame } from './auth-frame';
import { useDashboard } from './app-shell';
export function ForgotPassword() {
  const { session } = useDashboard();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  return (
    <AuthFrame>
      <div className="auth-form">
        <p className="eyebrow">ACCOUNT RECOVERY</p>
        <h1>{sent ? 'Check your inbox' : 'Forgot your password?'}</h1>
        <p className="auth-description">
          {sent
            ? 'If this address has an account, a password reset link is on its way. Follow the link to choose a new password.'
            : 'Enter the email you use for Geld. We will send you a link to reset your password.'}
        </p>
        {!sent && (
          <form
            className="form-stack"
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              setError('');
              try {
                const result = await authClient.requestPasswordReset({
                  email,
                  redirectTo: '/settings/account/reset-password',
                });
                if (result.error) setError('A reset link could not be sent. Try again.');
                else setSent(true);
              } catch {
                setError('A reset link could not be sent. Try again.');
              }
              setBusy(false);
            }}
          >
            <label>
              Email address
              <input
                className="field"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <Button type="submit" disabled={busy || !session.configured}>
              <Mail size={16} />
              {busy ? 'Sending link...' : 'Send reset link'}
            </Button>
          </form>
        )}
        {error && (
          <p role="alert" className="status-message">
            {error}
          </p>
        )}
        {!session.configured && <p className="status-message">Sign-in is not configured in this environment.</p>}
        <Link href="/sign-in" className="auth-back">
          <ArrowLeft size={14} />
          Back to sign in
        </Link>
      </div>
    </AuthFrame>
  );
}
