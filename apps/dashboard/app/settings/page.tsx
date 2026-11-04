import Link from 'next/link';
const pages = [
  {
    href: '/settings/enterprise',
    name: 'Enterprise',
    description: 'Your instances, outbound connectors and self-hosting',
  },
  {
    href: '/settings/review',
    name: 'Review preferences',
    description: 'Shared matcher settings and GitHub gist sync',
  },
  {
    href: '/settings/account',
    name: 'Account',
    description: 'Email, password, connected identities and your data',
  },
  {
    href: '/connect',
    name: 'Git connections',
    description: 'GitHub, GitLab and Bitbucket access',
  },
  {
    href: '/settings/providers',
    name: 'AI providers',
    description: 'Geld billing, your providers and model selection',
  },
  {
    href: '/settings/billing',
    name: 'Billing',
    description: 'Seats, pooled credits and spending caps',
  },
  {
    href: '/settings/security',
    name: 'Security',
    description: 'Your team audit log and grant ledger',
  },
];
export default function SettingsPage() {
  return (
    <div className="page">
      <p className="eyebrow">WORKSPACE</p>
      <h1>Settings</h1>
      <div className="settings-card">
        {pages.map((page) => (
          <Link key={page.href} href={page.href} className="settings-row">
            <div>
              <h3>{page.name}</h3>
              <p>{page.description}</p>
            </div>
            <span>↗</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
