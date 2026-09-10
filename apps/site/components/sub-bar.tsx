'use client';

import { cn } from 'cn';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useHeaderSlot } from '@/components/use-header-slot';
import { useIsCurrentPage } from '@/components/use-is-current-page';

interface SubBarProps {
  readonly 'aria-label': string;
  readonly children: ReactNode;
  readonly className?: string;
}

/**
 * A secondary bar that lives in the page flow and, once scrolled up to the
 * top bar, is shown inside the header's slot instead, so both rows share one
 * frosted surface. The in-flow original stays exactly where it is — made
 * invisible and inert rather than removed — so nothing below it ever moves;
 * and the header is fixed, so its growth does not move anything either.
 * Detection uses a one-pixel sentinel just above the bar: once it is under the
 * top bar, the bar is stuck.
 */
export function SubBar({ 'aria-label': ariaLabel, children, className }: SubBarProps) {
  const sentinel = useRef<HTMLDivElement | null>(null);
  const [stuck, setStuck] = useState(false);
  const slot = useHeaderSlot();
  const isCurrent = useIsCurrentPage();
  // A page the router keeps mounted but hidden must not put its bar in the header.
  const inHeader = stuck && isCurrent && slot !== null;

  useEffect(() => {
    const node = sentinel.current;
    if (node === null) return;
    // The root is the viewport minus the top bar (3.5rem + 1px), extended far
    // below the fold, so "not intersecting" can only mean "under the top bar" —
    // including when the sentinel scrolls from above the viewport to below it
    // in one jump, which would otherwise fire no callback.
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry !== undefined) setStuck(!entry.isIntersecting);
      },
      { rootMargin: '-57px 0px 100000px 0px', threshold: 0 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div ref={sentinel} aria-hidden="true" className="h-px -mb-px" />
      <div className={cn('sticky top-[calc(3.5rem+1px)] z-30', inHeader && 'pointer-events-none invisible')} aria-hidden={inHeader} inert={inHeader}>
        <nav aria-label={ariaLabel} className={cn('border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70', className)}>
          {children}
        </nav>
      </div>
      {inHeader && slot !== null
        ? createPortal(
            <nav aria-label={ariaLabel} className={className}>
              {children}
            </nav>,
            slot,
          )
        : null}
    </>
  );
}
