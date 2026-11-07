import type { Metadata } from 'next';
import Link from 'next/link';

import { ExternalLink } from '@/components/external-link';
import { PageIntro, Prose } from '@/components/section';
import { SUPPORT_EMAIL } from '@/lib/integrations';
import { ISSUES_URL } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Support',
  description: 'How to get help with Geld, the extension and its integrations.',
  alternates: { canonical: '/support' },
};

export default function SupportPage() {
  return (
    <>
      <PageIntro eyebrow="Support" title="Get help with Geld." description="Questions, problems and requests about the extension and its integrations." />
      <div className="container-site pb-24">
        <Prose>
          <h2 id="contact">Contact</h2>
          <p>
            Email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. We answer within two working days.
          </p>
          <h2 id="issues">Report a problem</h2>
          <p>
            Open an issue on <ExternalLink href={ISSUES_URL}>GitHub</ExternalLink>. The extension’s options page has Report with diagnostics, which fills
            in the version and browser for you.
          </p>
          <h2 id="integrations">Integrations</h2>
          <p>
            Connected accounts (Linear, Jira, GitHub, GitLab, Bitbucket, Slack) are managed under Connected services in the extension’s options. Removing
            one there deletes its key from your device. For Slack, see <Link href="/integrations/slack">Geld for Slack</Link>.
          </p>
          <h2 id="privacy">Privacy</h2>
          <p>
            See the <Link href="/privacy">privacy policy</Link>, or email privacy@geld.sh.
          </p>
        </Prose>
      </div>
    </>
  );
}
