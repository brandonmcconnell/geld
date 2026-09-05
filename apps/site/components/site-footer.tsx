import Link from 'next/link';

import { Logomark } from '@/components/logo';
import { AUTHOR, ISSUES_URL, LICENSE_URL, NAV_LINKS, REPO_URL } from '@/lib/site';
import { EXTENSION_VERSION } from '@/lib/version';

const linkClass = 'text-sm text-muted-foreground transition-colors hover:text-foreground';

/** Off-site links open in a new tab; the label gets a hint for screen readers. */
function ExternalLink({ href, children }: { readonly href: string; readonly children: string }) {
  return (
    <a href={href} className={linkClass} target="_blank" rel="noopener noreferrer">
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

export function SiteFooter() {
  const profiles = AUTHOR.profiles.filter((profile): profile is { label: string; url: string } => profile.url !== null);
  return (
    <footer className="border-t">
      <div className="container-site grid gap-10 py-12 sm:grid-cols-[1fr_auto_auto_auto] sm:gap-16">
        <div className="flex flex-col gap-3">
          <Logomark height={28} alt="" />
          <p className="max-w-[17rem] text-sm text-muted-foreground text-pretty">Hides tests and other review noise from GitHub diffs. Open source and MIT licensed.</p>
          <p className="text-xs text-muted-foreground">
            Version <span className="font-mono">{EXTENSION_VERSION}</span>
          </p>
        </div>
        <FooterColumn title="Site">
          {NAV_LINKS.map((link) => (
            <li key={link.href}>
              <Link href={link.href} className={linkClass}>
                {link.label}
              </Link>
            </li>
          ))}
        </FooterColumn>
        <FooterColumn title="Project">
          <li>
            <ExternalLink href={REPO_URL}>Source on GitHub</ExternalLink>
          </li>
          <li>
            <ExternalLink href={ISSUES_URL}>Report an issue</ExternalLink>
          </li>
          <li>
            <ExternalLink href={LICENSE_URL}>MIT license</ExternalLink>
          </li>
        </FooterColumn>
        <FooterColumn title={AUTHOR.name}>
          {profiles.map((profile) => (
            <li key={profile.label}>
              <ExternalLink href={profile.url}>{profile.label}</ExternalLink>
            </li>
          ))}
        </FooterColumn>
      </div>
      <div className="container-site flex flex-col gap-2 border-t py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>© {AUTHOR.name}. Not affiliated with GitHub.</p>
        <p>No analytics, no cookies, no tracking on this site either.</p>
      </div>
    </footer>
  );
}

function FooterColumn({ title, children }: { readonly title: string; readonly children: React.ReactNode }) {
  return (
    <nav aria-label={title} className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">{title}</h2>
      <ul className="flex flex-col gap-2">{children}</ul>
    </nav>
  );
}
