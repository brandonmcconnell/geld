import type { Metadata } from 'next';
import Link from 'next/link';

import { ExternalLink } from '@/components/external-link';
import { PageIntro, Prose } from '@/components/section';
import { DISCORD_SCOPES, discordBotInviteUrl, SUPPORT_EMAIL } from '@/lib/integrations';

export const metadata: Metadata = {
  title: 'Geld for Discord',
  description: 'See the Discord messages and threads a pull request links to, only where you can read them, beside the pull request on GitHub.',
  alternates: { canonical: '/integrations/discord' },
};

const CLIENT_ID = process.env.DISCORD_CLIENT_ID ?? '';

export default function DiscordIntegrationPage() {
  return (
    <>
      <PageIntro
        eyebrow="Integrations"
        title="Geld for Discord"
        description="Open-source projects often discuss a change in Discord. Geld shows the message or thread a pull request links to beside it on GitHub, only to people whose own roles let them read that channel."
      />
      <div className="container-site pb-24">
        <Prose>
          <h2 id="servers">For server admins</h2>
          <p>
            Discord has no way to read messages as a person, so Geld reads them with its bot. Add the bot to your server once:{' '}
            {CLIENT_ID === '' ? <span>the invite link is coming soon.</span> : <ExternalLink href={discordBotInviteUrl(CLIENT_ID)}>add Geld to a server</ExternalLink>}. It asks only
            to see channels and read their history, and it never posts, joins voice or changes anything.
          </p>
          <h2 id="connect">For readers</h2>
          <ol>
            <li>Install the Geld extension, open its options and turn on Connected services under Experiments.</li>
            <li>Under Connected services, choose Connect Discord and approve it.</li>
          </ol>
          <ul>
            {DISCORD_SCOPES.map(({ scope, reason }) => (
              <li key={scope}>
                <code>{scope}</code>: {reason}
              </li>
            ))}
          </ul>
          <h2 id="data">Where your data goes</h2>
          <p>
            When a pull request you are reading links a Discord message, the extension sends the link and your Discord token to Geld’s resolver on
            geld.sh. It asks Discord who you are, whether you are in that server and whether your roles let you see the channel, and only then reads the
            message as the bot and returns it to your browser. It stores and logs nothing; your browser caches what it read for a day. Sign-in and
            weekly renewals pass through Geld’s token service, which adds the app’s secret. See the <Link href="/privacy#connected-services">privacy policy</Link>.
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
