import type { Metadata } from 'next';

import { PageIntro } from '@/components/section';

/**
 * Where Slack sends the browser after signing in to Geld's Slack app. The extension opened this tab and reads the
 * code from its address, then closes it; the page itself reads nothing and sends nothing.
 */
export const metadata: Metadata = {
  title: 'Connecting Slack',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function SlackCallbackPage() {
  return <PageIntro eyebrow="Slack" title="Finishing your Slack connection." description="Geld closes this tab by itself. If it stays open, close it and check Connected services in the extension’s options." />;
}
