'use client';

import { cn } from 'cn';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Wordmark } from '@/components/logo';

/** The hero wordmark on the home page carries this id so the header can watch it. */
export const HERO_WORDMARK_ID = 'hero-wordmark';

/**
 * The wordmark in the top bar. On the home page it stays hidden while the big
 * hero wordmark is still showing beneath the bar, and comes into focus (fade
 * plus unblur) once the hero mark is entirely under or above the bar.
 */
export function HeaderBrand() {
  const pathname = usePathname();
  // Whether the hero wordmark has been scrolled under the bar, remembered per
  // pathname so a return to the home page starts hidden again.
  const [hero, setHero] = useState<{ readonly pathname: string; readonly covered: boolean }>({ pathname, covered: false });
  const visible = pathname !== '/' || (hero.pathname === pathname && hero.covered);

  useEffect(() => {
    const target = document.getElementById(HERO_WORDMARK_ID);
    if (target === null) return;
    const barHeight = document.querySelector('header')?.getBoundingClientRect().height ?? 56;
    // The observer reports the initial position as soon as it is attached, so
    // no synchronous measurement is needed here.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setHero({ pathname, covered: entry.boundingClientRect.bottom <= barHeight });
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
      data-visible={visible}
      className={cn(
        'flex items-center rounded-md transition-[opacity,filter] duration-500 ease-out will-change-[opacity,filter] motion-reduce:transition-none',
        visible ? 'opacity-100 blur-none' : 'pointer-events-none opacity-0 blur-[5px]',
      )}
    >
      <Wordmark height={20} alt="Geld" />
    </Link>
  );
}
