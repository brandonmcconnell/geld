'use client';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button, buttonVariants } from '@geld/ui';
import { authClient } from '@/lib/auth-client';
import { AuthFrame } from './auth-frame';
import Link from 'next/link';
export function PasswordReset() {
  const params = useSearchParams();
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  return (
    <AuthFrame>
      <div className="auth-form">
        <p className="eyebrow">ACCOUNT RECOVERY</p>
        <h1>{saved ? 'Password updated' : 'Set your password'}</h1>
        <p className="auth-description">
          {saved
            ? 'Sign in with your new password. You can also keep using email links and provider sign-in.'
            : 'Use at least 12 characters. You can keep using email links and provider sign-in.'}
        </p>
        {!saved && (
          <form
            className="form-stack"
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              try {
                const result = await authClient.resetPassword({
                  newPassword: password,
                  token: params.get('token') ?? '',
                });
                setMessage(
                  result.error ? 'This reset link is invalid or has expired.' : 'Your password has been saved.',
                );
                if (!result.error) {
                  setPassword('');
                  setSaved(true);
                }
              } catch {
                setMessage('Your password could not be saved.');
              }
              setBusy(false);
            }}
          >
            <label>
              New password
              <input
                name="password"
                className="field"
                type="password"
                minLength={12}
                autoComplete="new-password"
                value={password}
                required
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <Button type="submit" disabled={busy}>
              Save password
            </Button>
          </form>
        )}
        {message && (
          <p className="status-message" role="status">
            {message}
          </p>
        )}
        <Link className={saved ? buttonVariants() : 'auth-back'} href="/sign-in">
          Back to sign in
        </Link>
      </div>
    </AuthFrame>
  );
}
