'use client';

import { cn } from 'cn';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useHeaderSlot } from '@/components/use-header-slot';

interface SubBarProps {
  readonly 'aria-label': string;
  readonly children: ReactNode;
  readonly className?: string;
}

/**
 * A secondary bar that starts in the page flow and, once scrolled up to the
 * top bar, moves into the header's slot so both rows share one frosted
 * surface (no seam, no second blur). The header is in the flow too, so it
 * growing by the bar's height exactly replaces the space the bar left: nothing
 * below shifts. Detection uses a one-pixel sentinel just above the bar's place
 * in the flow: once the sentinel is under the top bar, the bar is stuck.
 */
export function SubBar({ 'aria-label': ariaLabel, children, className }: SubBarProps) {
  const sentinel = useRef<HTMLDivElement | null>(null);
  const [stuck, setStuck] = useState(false);
  const slot = useHeaderSlot();

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

  const bar = (
    <nav aria-label={ariaLabel} className={cn(stuck && slot !== null ? undefined : 'border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70', className)}>
      {children}
    </nav>
  );

  return (
    <>
      <div ref={sentinel} aria-hidden="true" className="h-px -mb-px" />
      {stuck && slot !== null ? createPortal(bar, slot) : <div className="sticky top-[calc(3.5rem+1px)] z-30">{bar}</div>}
    </>
  );
}
