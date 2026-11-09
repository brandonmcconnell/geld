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
  // Large only from 375px: below that the large row wraps, so it takes the default size the page's lower row already uses.
  const large = size === 'lg';
  const primaryClass = buttonVariants({ className: cn(large && 'min-[375px]:h-11 min-[375px]:px-5 min-[375px]:text-[0.95rem] min-[375px]:geld-cut-[10px] min-[375px]:[&_svg:not([class*="size-"])]:size-[18px]') });
  const iconClass = buttonVariants({
    variant: 'outline',
    size: 'icon',
    className: cn('text-muted-foreground hover:text-foreground', large && 'min-[375px]:size-11 min-[375px]:geld-cut-[10px] min-[375px]:[&_svg:not([class*="size-"])]:size-[18px]'),
  });

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)} data-current-browser={current}>
      <a href={primary.href} className={primaryClass} target="_blank" rel="noopener noreferrer" data-source={primary.source}>
        <BrowserIcon browser={primary.browser.id} />
        {primary.label}
      </a>
      <ul className="flex items-center gap-2" aria-label="Other browsers">
        {others.map((link) => (
          <li key={link.browser.id}>
            <Tooltip>
              <TooltipTrigger
                render={<a href={link.href} target="_blank" rel="noopener noreferrer" aria-label={link.label} data-source={link.source} />}
                className={iconClass}
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
