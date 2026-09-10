'use client';

import { usePathname } from 'next/navigation';
import { useState } from 'react';

/**
 * Whether the page this component was mounted on is the one being shown. The
 * router keeps previous pages mounted but hidden for a while after navigating
 * away; anything that reaches outside its page (portals, window listeners)
 * should stand down while that is the case.
 */
export function useIsCurrentPage(): boolean {
  const pathname = usePathname();
  const [ownPathname] = useState(pathname);
  return pathname === ownPathname;
}
