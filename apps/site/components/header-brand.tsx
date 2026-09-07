'use client';

import { cn } from 'cn';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Wordmark } from '@/components/logo';

/** The hero wordmark on the home page carries this id so the header can watch it. */
export const HERO_WORDMARK_ID = 'hero-wordmark';

interface HeroState {
  readonly pathname: string;
  /** A hero wordmark exists on this page (so the bar's mark starts hidden). */
  readonly present: boolean;
  /** The hero wordmark has scrolled entirely under or above the bar. */
  readonly covered: boolean;
}

/**
 * The wordmark in the top bar. On a page with a hero wordmark it stays hidden
 * while that mark is still showing beneath the bar, and comes into focus (fade
 * plus unblur) once the mark is entirely under or above the bar.
 *
 * The pre-hydration state comes from CSS (`header-brand` in globals.css uses
 * `:root:has(#hero-wordmark)`), not from the pathname: during revalidation
 * renders the pathname is not reliable, which once left the mark visible on a
 * freshly loaded home page.
 */
export function HeaderBrand() {
  const pathname = usePathname();
  const [state, setState] = useState<HeroState>({ pathname, present: false, covered: false });
  // A stale entry from another page must not leak into this one.
  const hero = state.pathname === pathname ? state : { pathname, present: false, covered: false };
  const visible = !hero.present || hero.covered;

  useEffect(() => {
    const target = document.getElementById(HERO_WORDMARK_ID);
    if (target === null) return;
    const barHeight = document.querySelector('header')?.getBoundingClientRect().height ?? 56;
    // The observer reports the initial position as soon as it is attached.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setState({ pathname, present: true, covered: entry.boundingClientRect.bottom <= barHeight });
      },
      { rootMargin: `-${barHeight}px 0px 0px 0px`, threshold: 0 },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [pathname]);

  return (
    <Link
      href="/"
      aria-label="Geld home"
      aria-hidden={!visible}
      tabIndex={visible ? undefined : -1}
      data-covered={hero.covered}
      className={cn('header-brand flex items-center', !visible && 'pointer-events-none')}
    >
      <Wordmark height={20} alt="Geld" />
    </Link>
  );
}
