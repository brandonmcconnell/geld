'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { visibleHero } from '@/components/header-brand';

/**
 * The line under the header's main row. On a page with a hero wordmark it
 * starts invisible and is fully drawn halfway to the point where the wordmark
 * passes under the bar, so a visitor landing on the page sees no border.
 *
 * The fade itself is a scroll-driven animation (`hero-divider` in globals.css);
 * this only measures where it ends, on every route change and resize. Browsers
 * without scroll-driven animations get the same fade from a scroll listener.
 */
export function HeaderDivider() {
  const pathname = usePathname();
  const node = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const wrapper = node.current;
    if (wrapper === null) return;
    const hero = visibleHero();
    if (hero === null) {
      wrapper.dataset.heroFade = 'off';
      wrapper.style.removeProperty('--hero-fade-end');
      wrapper.style.removeProperty('opacity');
      return;
    }

    let end = 1;
    const measure = (): void => {
      const covered = hero.getBoundingClientRect().bottom + window.scrollY - wrapper.getBoundingClientRect().bottom;
      end = Math.max(1, covered / 2);
      wrapper.style.setProperty('--hero-fade-end', `${end}px`);
    };
    const scrollDriven = CSS.supports('animation-timeline: scroll()');
    let frame: number | null = null;
    const paint = (): void => {
      frame = null;
      wrapper.style.opacity = String(Math.min(1, window.scrollY / end));
    };
    const onScroll = (): void => {
      if (frame === null) frame = requestAnimationFrame(paint);
    };
    const onResize = (): void => {
      measure();
      if (!scrollDriven) onScroll();
    };

    measure();
    wrapper.dataset.heroFade = 'on';
    if (!scrollDriven) {
      paint();
      window.addEventListener('scroll', onScroll, { passive: true });
    }
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [pathname]);

  return (
    <div ref={node} aria-hidden="true" className="hero-divider">
      {/* As a secondary bar approaches from below this fades out (scroll-linked, see `header-divider` in globals.css), so the two rows become one surface; the slot then carries the bottom border. */}
      <div className="header-divider h-px bg-border transition-opacity duration-150 ease-out motion-reduce:transition-none group-has-[#site-subbar:not(:empty)]/header:opacity-0" />
    </div>
  );
}
