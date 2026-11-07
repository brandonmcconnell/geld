import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { PageIntro } from '@/components/section';

/**
 * Where a service sends the browser after signing in to one of Geld's apps for it. The extension opened this tab and
 * reads the code from its address, then closes it; the page itself reads nothing and sends nothing.
 */
const SERVICES: Readonly<Record<string, string>> = { slack: 'Slack', teams: 'Microsoft Teams', discord: 'Discord' };

export function generateStaticParams(): { service: string }[] {
  return Object.keys(SERVICES).map((service) => ({ service }));
}

export const metadata: Metadata = {
  title: 'Connecting',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default async function CallbackPage({ params }: { readonly params: Promise<{ readonly service: string }> }) {
  const { service } = await params;
  const name = SERVICES[service];
  if (name === undefined) notFound();
  return <PageIntro eyebrow={name} title={`Finishing your ${name} connection.`} description="Geld closes this tab by itself. If it stays open, close it and check Connected services in the extension’s options." />;
}
