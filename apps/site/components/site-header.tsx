import Link from 'next/link';

import { AccountMenu } from '@/components/account-menu';
import { HeaderBrand } from '@/components/header-brand';
import { HEADER_SLOT_ID } from '@/components/header-slot';
import { NAV_LINKS } from '@/lib/site';

export function SiteHeader() {
  return (
    // Fixed rather than sticky so that a secondary bar joining the header (below) never changes the page's layout; the body pads for the base height.
    <header className="fixed inset-x-0 top-0 z-40 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70 [view-transition-name:site-header]">
      <div className="container-site flex h-14 items-center justify-between gap-6">
        <HeaderBrand />
        <nav aria-label="Primary" className="flex items-center gap-1 sm:gap-2">
          {NAV_LINKS.filter((link) => link.inHeader).map((link) => (
            <Link key={link.href} href={link.href} className="px-2 py-1.5 text-[0.8125rem] text-muted-foreground transition-colors hover:text-foreground sm:px-2.5 sm:text-sm">
              {link.label}
            </Link>
          ))}
          <AccountMenu className="ml-1 sm:ml-2" />
        </nav>
      </div>
      {/* Pages mount a secondary bar here (see components/use-header-slot) so it shares this one frosted surface. */}
      <div id={HEADER_SLOT_ID} className="empty:hidden" />
    </header>
  );
}
