'use client';

import { cn } from 'cn';
import { TextAlignStartIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { NavLink } from '@/lib/site';

/** The header's links behind one control, for windows too narrow to list them. */
export function NavMenu({ links, className }: { readonly links: readonly NavLink[]; readonly className?: string }) {
  const pathname = usePathname();
  return (
    <DropdownMenu>
      {/* A bare glyph in a 44px hit area: the icon sits on the column's edge and the area reaches 12px past it, ending where the wordmark begins. */}
      <DropdownMenuTrigger
        aria-label="Menu"
        className={cn(
          '-ml-3 inline-grid size-11 shrink-0 place-items-center text-foreground/75 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset aria-expanded:text-foreground',
          className,
        )}
      >
        <TextAlignStartIcon aria-hidden="true" className="size-5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent alignOffset={12} className="min-w-48">
        {links.map((link) => (
          <DropdownMenuItem key={link.href} render={<Link href={link.href} aria-current={pathname === link.href ? 'page' : undefined} />} className="aria-[current=page]:font-medium">
            {link.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
