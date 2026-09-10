'use client';

import { cn } from 'cn';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';

interface SubBarProps {
  readonly 'aria-label': string;
  readonly children: ReactNode;
  readonly className?: string;
}

/**
 * A secondary bar that sticks under the top bar. While it is stuck, it reports
 * `data-subbar="stuck"`, which globals.css uses to drop the top bar's bottom
 * border so the two read as one frosted surface. Detection uses a one-pixel
 * sentinel just above the bar: once the sentinel is scrolled under the top
 * bar, the bar is stuck.
 */
export function SubBar({ 'aria-label': ariaLabel, children, className }: SubBarProps) {
  const sentinel = useRef<HTMLDivElement | null>(null);
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const node = sentinel.current;
    if (node === null) return;
    // Header is 3.5rem + 1px border; the sentinel counts as gone once under it.
    const observer = new IntersectionObserver(([entry]) => setStuck(entry !== undefined && !entry.isIntersecting && entry.boundingClientRect.top < 0), {
      rootMargin: '-57px 0px 0px 0px',
      threshold: 0,
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div ref={sentinel} aria-hidden="true" className="h-px -mb-px" />
      <nav
        aria-label={ariaLabel}
        data-subbar={stuck ? 'stuck' : 'free'}
        className={cn('sticky top-[calc(3.5rem+1px)] z-30 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70', className)}
      >
        {children}
      </nav>
    </>
  );
}
