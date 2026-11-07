import type { Metadata } from 'next';
import Link from 'next/link';

import { PageIntro, Prose } from '@/components/section';
import { SUPPORT_EMAIL, TEAMS_PERMISSIONS } from '@/lib/integrations';

export const metadata: Metadata = {
  title: 'Geld for Microsoft Teams',
  description: 'See the Teams channel messages a pull request links to, as you can read them, beside the pull request on GitHub.',
  alternates: { canonical: '/integrations/teams' },
};

export default function TeamsIntegrationPage() {
  return (
    <>
      <PageIntro
        eyebrow="Integrations"
        title="Geld for Microsoft Teams"
        description="When a pull request links a Teams channel message, Geld shows the message and its replies beside the pull request on GitHub, read with your own Microsoft account."
      />
      <div className="container-site pb-24">
        <Prose>
          <h2 id="connect">Connecting your organisation</h2>
          <ol>
            <li>Install the Geld extension, open its options and turn on Connected services under Experiments.</li>
            <li>Under Connected services, choose Connect Microsoft Teams and sign in with your work account.</li>
          </ol>
          <p>
            Reading channel messages needs an administrator’s consent once for the organisation. If Microsoft asks for it, send your admin this page:
            they sign in and approve Geld for everyone, and nobody else needs to again.
          </p>
          <h2 id="access">What it reads, and why</h2>
          <p>Geld signs in as you, so it reads only channels in teams you are a member of. It never reads chats, and it never posts.</p>
          <ul>
            {TEAMS_PERMISSIONS.map(({ scope, reason }) => (
              <li key={scope}>
                <code>{scope}</code>: {reason}
              </li>
            ))}
          </ul>
          <h2 id="data">Where your data goes</h2>
          <p>
            Microsoft gives a web app its tokens only with the app’s secret, so the sign-in and each hourly renewal pass through Geld’s token service on
            geld.sh, which adds the secret and hands the tokens back to your browser. It stores nothing and logs nothing. Messages are read from your
            browser straight from Microsoft Graph and cached on your device. See the <Link href="/privacy#connected-services">privacy policy</Link>.
          </p>
          <h2 id="support">Support</h2>
          <p>
            Email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> or see <Link href="/support">support</Link>.
          </p>
        </Prose>
      </div>
    </>
  );
}
