'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { Wordmark } from '@/components/logo';

/** The hero wordmark on the home page carries this id so the header can watch it. */
export const HERO_WORDMARK_ID = 'hero-wordmark';

type HeroState = 'none' | 'showing' | 'covered';

/**
 * The hero wordmark of the page on screen. The router keeps previous pages
 * mounted but hidden for a while, so the id can exist more than once; only a
 * rendered one counts.
 */
function visibleHero(): HTMLElement | null {
  for (const candidate of document.querySelectorAll<HTMLElement>(`#${HERO_WORDMARK_ID}`)) {
    if (candidate.checkVisibility()) return candidate;
  }
  return null;
}

/**
 * The wordmark in the top bar. On a page with a hero wordmark it stays hidden
 * while that mark is still showing beneath the bar, and comes into focus (fade
 * plus unblur) once the mark is entirely under or above the bar.
 *
 * The state is written straight to the link as `data-hero`, synchronously in
 * the effect that follows every route change, so a route transition's new
 * snapshot already shows the right state. Before hydration the CSS in
 * `header-brand` (globals.css) uses `:root:has(#hero-wordmark)` instead.
 */
export function HeaderBrand() {
  const pathname = usePathname();
  const link = useRef<HTMLAnchorElement | null>(null);

  useEffect(() => {
    const node = link.current;
    if (node === null) return;
    const apply = (state: HeroState): void => {
      node.dataset.hero = state;
      const visible = state !== 'showing';
      node.setAttribute('aria-hidden', String(!visible));
      if (visible) node.removeAttribute('tabindex');
      else node.tabIndex = -1;
    };
    const hero = visibleHero();
    if (hero === null) {
      apply('none');
      return;
    }
    const barHeight = node.closest('header')?.getBoundingClientRect().height ?? 56;
    const measure = (): void => apply(hero.getBoundingClientRect().bottom <= barHeight ? 'covered' : 'showing');
    measure();
    const observer = new IntersectionObserver(measure, { rootMargin: `-${barHeight}px 0px 0px 0px`, threshold: 0 });
    observer.observe(hero);
    return () => observer.disconnect();
  }, [pathname]);

  return (
    <Link ref={link} href="/" aria-label="Geld home" className="header-brand flex items-center">
      <Wordmark height={20} alt="Geld" />
    </Link>
  );
}
