import type { GeldSettings } from '@geld/core';
import { DEFAULT_SETTINGS, findSettingsGist, readRemote, sectionsFor, SignedOutError } from '@geld/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { GitHubIcon } from '@/components/icons';
import { PageIntro, Prose } from '@/components/section';
import { SettingsForm } from '@/components/settings/settings-form';
import { buttonVariants } from '@/components/ui/button';
import { authConfig } from '@/lib/auth/config';
import { getSession } from '@/lib/auth/session';

export const metadata: Metadata = {
  title: 'Settings',
  description: 'Edit the Geld settings that sync to your GitHub account.',
  robots: { index: false, follow: false },
};

type AuthNotice = 'denied' | 'state' | 'exchange' | 'unconfigured' | 'signed-out';

const NOTICES: Readonly<Record<AuthNotice, string>> = {
  denied: 'Sign-in was cancelled on GitHub. Nothing was changed.',
  state: "Sign-in didn't complete: the link expired or didn't match this browser. Please try again.",
  exchange: "GitHub didn't complete the sign-in. Please try again.",
  unconfigured: "Sign-in isn't configured in this environment.",
  'signed-out': "You've been signed out. Sign in again to keep editing.",
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

  const session = await getSession(config);
  if (session === null) {
    return (
      <SignedOutView notice={notice}>
        <a href="/auth/start?next=/settings" className={buttonVariants({ size: 'lg' })}>
          <GitHubIcon />
          Sign in with GitHub
        </a>
        <p className="text-xs text-muted-foreground">
          Asks only for the <code className="code-chip">gist</code> scope. You can revoke it any time from your GitHub settings.
        </p>
      </SignedOutView>
    );
  }

  let gistId: string | null = null;
  let settings: GeldSettings = DEFAULT_SETTINGS;
  let updatedAt: string | null = null;
  try {
    const found = await findSettingsGist(session.token);
    if (found !== null) {
      const remote = await readRemote(session.token, found.id);
      gistId = found.id;
      if (remote !== null) {
        settings = remote.settings;
        updatedAt = remote.updatedAt;
      }
    }
  } catch (error) {
    if (error instanceof SignedOutError) redirect('/auth/expired');
    throw error;
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
            Signing in here uses the same GitHub OAuth App as the extension, with the <code>gist</code> scope only. The token is stored in an encrypted
            cookie in your browser; geld.sh has no database and only sees your settings while it is serving a request from you.{' '}
            <Link href="/privacy#sign-in">Privacy policy</Link>.
          </p>
        </Prose>
        <div className="mt-8 flex flex-col items-start gap-3">{children}</div>
      </div>
    </>
  );
}
