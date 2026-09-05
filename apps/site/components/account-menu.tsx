'use client';

import { cn } from 'cn';
import { CircleUserRoundIcon, LogOutIcon, SettingsIcon } from 'lucide-react';
import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
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
          render={<a href="/auth/start?next=/settings" aria-label="Sign in with GitHub" />}
          className={cn(buttonVariants({ variant: 'outline', size: 'icon-sm', className: 'rounded-full text-muted-foreground [[data-account]_&]:hidden' }), className)}
        >
          <CircleUserRoundIcon aria-hidden="true" className="size-[18px]" />
        </TooltipTrigger>
        <TooltipContent side="bottom">Sign in with GitHub</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'inline-flex h-8 items-center gap-2 rounded-full border bg-background pr-2.5 pl-0.5 text-sm outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/40 aria-expanded:bg-muted',
          className,
        )}
        aria-label={`Account: ${account.login}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- avatar from GitHub, already sized */}
        <img src={account.avatarUrl} alt="" width={26} height={26} className="size-[26px] rounded-full" referrerPolicy="no-referrer" />
        <span className="hidden max-w-32 truncate font-medium sm:inline">{account.login}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <p className="px-2 py-1.5 text-xs text-muted-foreground">
          Signed in as <span className="font-medium text-foreground">{account.login}</span>
        </p>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/settings" />}>
          <SettingsIcon aria-hidden="true" className="text-muted-foreground" />
          Settings
        </DropdownMenuItem>
        <form method="post" action="/auth/signout">
          <DropdownMenuItem render={<button type="submit" className="w-full" />}>
            <LogOutIcon aria-hidden="true" className="text-muted-foreground" />
            Sign out
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
