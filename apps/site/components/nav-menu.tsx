'use client';

import { cn } from 'cn';
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
          'menu-trigger -ml-3 inline-grid size-11 shrink-0 place-items-center text-foreground/75 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset aria-expanded:text-foreground',
          className,
        )}
      >
        <MenuGlyph />
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

/**
 * Three bars bent like the site's cut corners: the top bar at its left end,
 * the bottom bar at its right, and the middle bar at both, all three the same
 * width. Hover flattens the bends part-way. Open straightens every bend: the
 * top and bottom bars become the two halves of the stroke from top left to
 * bottom right, and the middle bar the whole stroke from bottom left to top
 * right (`menu-glyph` in globals.css). Every state moves the same seven
 * segments by transforms only, so any state turns into any other, even mid-way.
 */
function MenuGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="menu-glyph size-5">
      <path className="menu-glyph__top" d="M6 6H21" />
      <path className="menu-glyph__top-bend" d="M6 6L3 9" />
      <path className="menu-glyph__middle-bend-start" d="M5 12L3 14" />
      <path className="menu-glyph__middle" d="M5 12H19" />
      <path className="menu-glyph__middle-bend-end" d="M19 12L21 10" />
      <path className="menu-glyph__bottom" d="M3 18H18" />
      <path className="menu-glyph__bottom-bend" d="M18 18L21 15" />
    </svg>
  );
}
