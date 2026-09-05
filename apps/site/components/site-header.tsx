import { cn } from 'cn';
import Link from 'next/link';

import { GitHubIcon } from '@/components/icons';
import { Wordmark } from '@/components/logo';
import { buttonVariants } from '@/components/ui/button';
import { NAV_LINKS, REPO_URL } from '@/lib/site';

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="container-site flex h-14 items-center justify-between gap-6">
        <Link href="/" className="flex items-center rounded-md" aria-label="Geld home">
          <Wordmark height={20} alt="Geld" />
        </Link>
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
          <a
            href={REPO_URL}
            className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
            aria-label="Geld on GitHub"
            rel="noopener"
          >
            <GitHubIcon />
          </a>
        </nav>
      </div>
    </header>
  );
}
