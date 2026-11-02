'use client';

import { cn } from 'cn';
import { LogOutIcon, SettingsIcon } from 'lucide-react';
import Link from 'next/link';

import { UserGlyphIcon } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { DASHBOARD_ORIGIN } from '@/lib/dashboard';
import { useAccount } from '@/lib/account';

/**
 * Header account control. Signed in: avatar + login opening Settings / Sign
 * out. Signed out: an avatar-placeholder icon that starts sign-in. The icon is
 * hidden before hydration when the account cookie exists (`data-account` on
 * <html>, set by the inline script in layout.tsx) so signed-in visitors never
 * see it flash.
 */
export function AccountMenu({ className }: { readonly className?: string | undefined }) {
  const account = useAccount();

  if (account === null || account === undefined) {
    // Plain anchor: a route handler that sets a cookie and redirects must never be prefetched.
    return (
      <Tooltip>
        <TooltipTrigger
          render={<a href="/auth/start?next=/settings" aria-label="Sign in to Geld" />}
          className={cn(
            buttonVariants({ variant: 'ghost', size: 'icon-sm', className: 'border-input text-muted-foreground hover:text-foreground [[data-account]_&]:hidden' }),
            className,
          )}
        >
          {/* Clips the glyph to the cut corners (native corner-shape shapes the border, not the content); inherits the radius so the hover cut follows. Kept off the button itself so its ::after hit area stays unclipped. */}
          <span aria-hidden="true" className="block size-full overflow-clip rounded-[inherit] [corner-shape:inherit]">
            <UserGlyphIcon className="size-full" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">Sign in to Geld</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'group/geld geld-corners geld-cut-[7px] inline-flex h-8 items-center gap-2 border border-input p-0.5 text-sm outline-none hover:bg-muted sm:pr-2.5 focus-visible:ring-3 focus-visible:ring-ring/40 aria-expanded:bg-muted',
          className,
        )}
        aria-label={`Account: ${account.login}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- avatar from GitHub, already sized */}
        {account.avatarUrl?<img src={account.avatarUrl} alt="" width={26} height={26} className="geld-corners geld-cut-[6px] size-[26px]" referrerPolicy="no-referrer" />:<UserGlyphIcon className="size-[26px]"/>}
        <span className="hidden max-w-32 truncate font-medium sm:inline">{account.login}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <p className="px-2 py-1.5 text-xs text-muted-foreground">
          Signed in as <span className="font-medium text-foreground">{account.login}</span>
        </p>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href={`${DASHBOARD_ORIGIN}/settings/review`} />}>
          <SettingsIcon aria-hidden="true" className="text-muted-foreground" />
          Settings
        </DropdownMenuItem>
        <div>
          <DropdownMenuItem render={<a href={`${DASHBOARD_ORIGIN}/settings/account`} className="w-full" />}>
            <LogOutIcon aria-hidden="true" className="text-muted-foreground" />
            Manage account
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
