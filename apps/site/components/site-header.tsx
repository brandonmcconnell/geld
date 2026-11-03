import Link from 'next/link';

import { AccountMenu } from '@/components/account-menu';
import { HeaderBrand } from '@/components/header-brand';
import { HeaderDivider } from '@/components/header-divider';
import { HEADER_SLOT_ID } from '@/components/header-slot';
import { NavMenu } from '@/components/nav-menu';
import { NAV_LINKS } from '@/lib/site';

export function SiteHeader() {
  const links = NAV_LINKS.filter((link) => link.inHeader);
  return (
    // Fixed rather than sticky so that a secondary bar joining the header (below) never changes the page's layout; the body pads for the base height.
    <header className="group/header fixed inset-x-0 top-0 z-40 bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-transparent supports-[backdrop-filter]:bg-linear-to-t supports-[backdrop-filter]:from-background/90 supports-[backdrop-filter]:to-background/75 [view-transition-name:site-header]">
      <div className="container-site flex h-14 items-center justify-between gap-6">
        <div className="flex items-center">
          <NavMenu links={links} className="sm:hidden" />
          <HeaderBrand />
        </div>
        <nav aria-label="Primary" className="flex items-center gap-1 sm:gap-2">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className="hidden px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground sm:inline">
              {link.label}
            </Link>
          ))}
          <AccountMenu className="sm:ml-2" />
        </nav>
      </div>
      <HeaderDivider />
      {/* Pages mount a secondary bar here (see components/use-header-slot) so it shares this one frosted surface. */}
      <div id={HEADER_SLOT_ID} className="border-b empty:hidden" />
    </header>
  );
}
