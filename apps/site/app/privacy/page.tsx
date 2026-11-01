import type { Metadata } from 'next';
import { PRIVACY_SECTIONS, PRIVACY_UPDATED } from '@geld/domain/privacy';
import { PageIntro, Prose } from '@/components/section';
export const metadata: Metadata = { title: 'Privacy policy', description: 'How Geld processes account, review, billing and optional measurement data, and how to exercise your privacy rights.', alternates: { canonical: '/privacy' } };
export default function PrivacyPage() {
  return <><PageIntro eyebrow="Privacy policy" title="Your work deserves clear boundaries." description={`Last updated ${PRIVACY_UPDATED}. This policy covers the dashboard, website, extension and Action.`}/><div className="container-site pb-24"><Prose>{PRIVACY_SECTIONS.map((section) => <section key={section.id}><h2 id={section.id}>{section.title}</h2>{section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</section>)}</Prose></div></>;
}
