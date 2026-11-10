import type { GeldSettings, SettingsIssue } from '@geld/core';
import { DEFAULT_SETTINGS, findSettingsGist, readRemoteValidated, sectionsFor, SignedOutError } from '@geld/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { GitHubIcon } from '@/components/icons';
import { PageIntro, Prose } from '@/components/section';
import { CorruptedSettings } from '@/components/settings/corrupted-settings';
import { ReconnectNotice } from '@/components/settings/reconnect-notice';
import { SettingsForm } from '@/components/settings/settings-form';
import { buttonVariants } from '@/components/ui/button';
import { authConfig } from '@/lib/auth/config';
import { resolveSession } from '@/lib/auth/session';

export const metadata: Metadata = {
  title: 'Settings',
  description: 'Edit the Geld settings that sync to your GitHub account.',
  robots: { index: false, follow: false },
};

type AuthNotice = 'denied' | 'state' | 'exchange' | 'unconfigured' | 'signed-out' | 'unavailable';

const NOTICES: Readonly<Record<AuthNotice, string>> = {
  denied: 'Sign-in was cancelled on GitHub. Nothing was changed.',
  state: "Sign-in didn't complete: the link expired or didn't match this browser. Please try again.",
  exchange: "GitHub didn't complete the sign-in. Please try again.",
  unconfigured: "Sign-in isn't configured in this environment.",
  'signed-out': "You've been signed out. Sign in again to keep editing.",
  unavailable: "GitHub couldn't be reached to renew your sign-in. Try again in a moment.",
};

function isAuthNotice(value: unknown): value is AuthNotice {
  return typeof value === 'string' && value in NOTICES;
}

const SECTIONS = sectionsFor('site');

export default async function SettingsPage({ searchParams }: PageProps<'/settings'>) {
  const { auth } = await searchParams;
  const notice = isAuthNotice(auth) ? NOTICES[auth] : null;

  const config = authConfig();
  if (config === null) {
    return (
      <SignedOutView notice={notice}>
        <p className="border border-dashed px-4 py-3 text-sm text-muted-foreground">
          Sign-in isn&apos;t configured in this environment, so settings can only be edited in the extension for now.
        </p>
      </SignedOutView>
    );
  }

  // Pages cannot write cookies, so an expiring token is renewed by /auth/refresh
  // and the page reloads; if GitHub was unreachable just now (`auth=unavailable`)
  // stay here and offer a retry instead of bouncing back and forth.
  const access = await resolveSession(config, null);
  if (access.status === 'stale' && auth !== 'unavailable') redirect('/auth/refresh?next=/settings');
  if (access.status === 'stale') {
    return (
      <SignedOutView notice={notice}>
        <a href="/auth/refresh?next=/settings" className={buttonVariants({ size: 'lg' })}>
          Try again
        </a>
      </SignedOutView>
    );
  }
  if (access.status !== 'ok') {
    return (
      <SignedOutView notice={notice}>
        <a href="/auth/start?next=/settings" className={buttonVariants({ size: 'lg' })}>
          <GitHubIcon />
          Sign in with GitHub
        </a>
        <p className="text-xs text-muted-foreground">
          Signs you in through the Geld GitHub App; your settings live in a secret gist on your account. You can revoke it any time from your GitHub
          settings.
        </p>
      </SignedOutView>
    );
  }
  const { session } = access;

  let gistId: string | null = null;
  let settings: GeldSettings = DEFAULT_SETTINGS;
  let updatedAt: string | null = null;
  let invalid: { readonly gistId: string; readonly htmlUrl: string; readonly issues: readonly SettingsIssue[] } | null = null;
  try {
    const found = await findSettingsGist(session.token);
    if (found !== null) {
      gistId = found.id;
      // Strict read: a hand-edited gist with mistakes is reported, never silently repaired.
      const read = await readRemoteValidated(session.token, found.id);
      if (read.kind === 'valid') {
        settings = read.remote.settings;
        updatedAt = read.remote.updatedAt;
      } else if (read.kind === 'invalid') {
        invalid = { gistId: read.gistId, htmlUrl: read.htmlUrl, issues: read.issues };
      }
    }
  } catch (error) {
    if (error instanceof SignedOutError) redirect('/auth/expired');
    throw error;
  }

  if (invalid !== null) {
    return (
      <>
        <PageIntro
          eyebrow="Settings"
          title="Your Geld settings."
          description={
            <>
              Signed in as <span className="font-medium text-foreground">{session.login}</span>. Your settings gist could not be read, so nothing can be
              changed here until it is fixed or reset.
            </>
          }
        />
        <div className="container-site pb-32">
          {session.auth === 'oauth' ? <ReconnectNotice next="/settings" /> : null}
          <CorruptedSettings gistId={invalid.gistId} htmlUrl={invalid.htmlUrl} issues={invalid.issues} />
        </div>
      </>
    );
  }

  return (
    <>
      <PageIntro
        eyebrow="Settings"
        title="Your Geld settings."
        description={
          <>
            Signed in as <span className="font-medium text-foreground">{session.login}</span>. Changes are saved to a secret gist on your GitHub
            account, and the extension picks them up when your browser starts or you open its popup or options.
          </>
        }
      />
      <div className="container-site pb-32">
        {session.auth === 'oauth' ? <ReconnectNotice next="/settings" /> : null}
        <SettingsForm sections={SECTIONS} initialSettings={settings} initialGistId={gistId} updatedAt={updatedAt} login={session.login} />
      </div>
    </>
  );
}

function SignedOutView({ notice, children }: { readonly notice: string | null; readonly children: React.ReactNode }) {
  return (
    <>
      <PageIntro eyebrow="Settings" title="Your settings, on every device." description="Edit the same settings the extension uses, from any browser." />
      <div className="container-site pb-32">
        {notice !== null ? (
          <p role="status" className="mb-8 max-w-2xl border bg-muted/40 px-4 py-3 text-sm">
            {notice}
          </p>
        ) : null}
        <Prose>
          <p>
            Geld keeps your settings in a <strong>secret gist on your own GitHub account</strong> when you sign in. The extension reads and writes it,
            and so does this page, so a change made here shows up in the extension the next time it pulls: when your browser starts, or when you
            open its popup or options.
          </p>
          <p>
            Signing in here uses the same Geld GitHub App as the extension. The token is stored in an encrypted cookie in your browser, expires after
            eight hours and is renewed while you keep using the site; geld.sh has no database and only sees your settings while it is serving a request
            from you. <Link href="/privacy#sign-in">Privacy policy</Link>.
          </p>
        </Prose>
        <div className="mt-8 flex flex-col items-start gap-3">{children}</div>
      </div>
    </>
  );
}
