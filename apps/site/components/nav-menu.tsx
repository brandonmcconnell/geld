'use client';

import { cn } from 'cn';
import { MenuIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { NavLink } from '@/lib/site';

/** The header's links behind one control, for windows too narrow to list them. */
export function NavMenu({ links, className }: { readonly links: readonly NavLink[]; readonly className?: string }) {
  const pathname = usePathname();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Menu"
        className={cn(
          'geld-corners geld-cut-[7px] inline-grid size-8 place-items-center border border-input text-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/40 aria-expanded:bg-muted',
          className,
        )}
      >
        <MenuIcon aria-hidden="true" className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-48">
        {links.map((link) => (
          <DropdownMenuItem key={link.href} render={<Link href={link.href} aria-current={pathname === link.href ? 'page' : undefined} />} className="aria-[current=page]:font-medium">
            {link.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
