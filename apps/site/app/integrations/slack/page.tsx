import type { Metadata } from 'next';
import Link from 'next/link';

import { PageIntro, Prose } from '@/components/section';
import { SLACK_SCOPES, SUPPORT_EMAIL } from '@/lib/integrations';

export const metadata: Metadata = {
  title: 'Geld for Slack',
  description: 'See the Slack threads a pull request links to, as you can read them, right beside the pull request on GitHub.',
  alternates: { canonical: '/integrations/slack' },
};

export default function SlackIntegrationPage() {
  return (
    <>
      <PageIntro
        eyebrow="Integrations"
        title="Geld for Slack"
        description="Pull requests often start in a Slack thread. Geld shows that thread’s first message and replies beside the pull request on GitHub, read with your own Slack account, so you never have to go looking for it."
      />
      <div className="container-site pb-24">
        <Prose>
          <h2 id="what">What it does</h2>
          <p>
            Geld is a browser extension for code review on GitHub. Its Related links section lists the tickets, threads and agent sessions a pull request
            links to. With Slack connected, a link to a Slack thread shows the thread’s first message as its title, how many replies it has and which
            channel it is in, and opens to the whole thread.
          </p>
          <h2 id="connect">Connecting a workspace</h2>
          <ol>
            <li>Install the Geld extension and open its options.</li>
            <li>Turn on Connected services under Experiments.</li>
            <li>Under Connected services, choose Connect Slack workspace and sign in to Slack. Repeat it for each workspace you want.</li>
          </ol>
          <p>
            Some workspaces ask an admin to approve a new app before members can use it. Slack shows a request button in that case, and the admin gets
            the request.
          </p>
          <h2 id="access">What it reads, and why</h2>
          <p>Geld signs in as you, so it reads only what you can already read in Slack. It never asks for direct messages, and it never posts anything.</p>
          <ul>
            {SLACK_SCOPES.map(({ scope, reason }) => (
              <li key={scope}>
                <code>{scope}</code>: {reason}
              </li>
            ))}
          </ul>
          <h2 id="data">Where your data goes</h2>
          <p>
            Sign-in uses Slack’s PKCE flow, so no secret exists anywhere and the token goes straight from Slack to your browser. Slack sends your browser
            back to a page on geld.sh with a one-time code, which the extension exchanges itself; the code cannot be used without a value that never
            leaves your browser. The token is stored on your device only, never synced and never sent to Geld.
          </p>
          <p>
            Geld reads a thread only when a pull request you are viewing links to it, and caches what it read on your device for a day. AI context is
            off unless you turn it on for your Slack connection; then the thread is sent with the pull request to the AI gateway you configured, when you
            run Triage with AI. Removing the connection signs the token out of Slack and deletes it. See the <Link href="/privacy#connected-services">privacy policy</Link>.
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
