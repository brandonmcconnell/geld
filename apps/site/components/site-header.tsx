import { cn } from 'cn';
import Link from 'next/link';

import { AccountMenu } from '@/components/account-menu';
import { HeaderBrand } from '@/components/header-brand';
import { NAV_LINKS } from '@/lib/site';

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="container-site flex h-14 items-center justify-between gap-6">
        <HeaderBrand />
        <nav aria-label="Primary" className="flex items-center gap-1 sm:gap-2">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                'rounded-md px-2 py-1.5 text-[0.8125rem] text-muted-foreground transition-colors hover:text-foreground sm:px-2.5 sm:text-sm',
                !link.compact && 'hidden sm:inline-block',
              )}
            >
              {link.label}
            </Link>
          ))}
          <AccountMenu className="ml-1 sm:ml-2" />
        </nav>
      </div>
    </header>
  );
}
