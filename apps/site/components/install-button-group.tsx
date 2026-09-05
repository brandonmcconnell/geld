'use client';

import { cn } from 'cn';

import { BrowserIcon } from '@/components/browser-icons';
import { buttonVariants } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useCurrentBrowser } from '@/lib/detect-browser';
import type { InstallLink } from '@/lib/downloads';

/**
 * One prominent button for the browser we think the visitor is using, plus
 * icon-only buttons for the other three. Chrome is the server-rendered guess;
 * the real browser is read from the user agent after hydration.
 */
export function InstallButtonGroup({ links, size = 'default', className }: { readonly links: readonly InstallLink[]; readonly size?: 'default' | 'lg'; readonly className?: string | undefined }) {
  const current = useCurrentBrowser();

  const primary = links.find((link) => link.browser.id === current) ?? links[0];
  if (primary === undefined) return null;
  const others = links.filter((link) => link !== primary);
  const iconSize = size === 'lg' ? 'icon-lg' : 'icon';

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)} data-current-browser={current}>
      <a href={primary.href} className={buttonVariants({ size })} target="_blank" rel="noopener noreferrer" data-source={primary.source}>
        <BrowserIcon browser={primary.browser.id} />
        {primary.label}
      </a>
      <ul className="flex items-center gap-2" aria-label="Other browsers">
        {others.map((link) => (
          <li key={link.browser.id}>
            <Tooltip>
              <TooltipTrigger
                render={<a href={link.href} target="_blank" rel="noopener noreferrer" aria-label={link.label} data-source={link.source} />}
                className={buttonVariants({ variant: 'outline', size: iconSize, className: 'text-muted-foreground hover:text-foreground' })}
              >
                <BrowserIcon browser={link.browser.id} />
              </TooltipTrigger>
              <TooltipContent>{link.label}</TooltipContent>
            </Tooltip>
          </li>
        ))}
      </ul>
    </div>
  );
}
