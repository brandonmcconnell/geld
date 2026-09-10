'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

/** How long the old page takes to leave, and the new one to arrive. Mirrored in globals.css. */
const LEAVE_MS = 180;
const ENTER_MS = 320;
/** Give up on a navigation that never lands (offline, blocked) so the page is not stuck faded out. */
const LEAVE_TIMEOUT_MS = 3000;

type Phase = 'idle' | 'leaving' | 'entering';

function internalDestination(event: MouseEvent): URL | null {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const target = event.target;
  if (!(target instanceof Element)) return null;
  const anchor = target.closest('a[href]');
  if (!(anchor instanceof HTMLAnchorElement) || anchor.target !== '' || anchor.hasAttribute('download')) return null;
  const url = new URL(anchor.href, location.href);
  if (url.origin !== location.origin) return null;
  // Same page (hash jumps, query-only changes) is not a route change.
  if (url.pathname === location.pathname) return null;
  return url;
}

/**
 * Page-to-page transition: the current page fades while a viewport-sized veil
 * blurs what is behind it, then the next page arrives the same way in
 * reverse (see `[data-route-phase]` in globals.css). Done on the live DOM
 * rather than with the View Transitions API because React's integration
 * snapshots the whole <main> (thousands of pixels tall, expensive to blur,
 * and drawn at the new scroll position so it appears to jump) and cancels the
 * cheap viewport-sized root snapshot that would avoid both.
 *
 * Internal link clicks are intercepted so the exit can play before the
 * router navigates; back/forward only plays the entrance.
 */
export function RouteTransition() {
  const router = useRouter();
  const pathname = usePathname();
  const [phase, setPhase] = useState<Phase>('idle');
  const [seenPathname, setSeenPathname] = useState(pathname);
  const pending = useRef<string | null>(null);

  // A new pathname committed: the new page is in the DOM, bring it in (state adjusted during render).
  if (pathname !== seenPathname) {
    setSeenPathname(pathname);
    setPhase('entering');
  }

  useEffect(() => {
    pending.current = null;
  }, [pathname]);

  useEffect(() => {
    if (phase !== 'entering') return;
    const timer = setTimeout(() => setPhase('idle'), ENTER_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    document.documentElement.dataset.routePhase = phase;
    return () => {
      delete document.documentElement.dataset.routePhase;
    };
  }, [phase]);

  useEffect(() => {
    const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
    const onClick = (event: MouseEvent): void => {
      const url = internalDestination(event);
      if (url === null || reduceMotion.matches) return;
      // Take over from <Link>: stop its handler and navigate once the exit has played.
      event.preventDefault();
      event.stopPropagation();
      const href = url.pathname + url.search + url.hash;
      if (pending.current !== null) return;
      pending.current = href;
      setPhase('leaving');
      setTimeout(() => {
        if (pending.current === href) router.push(href);
      }, LEAVE_MS);
      setTimeout(() => {
        if (pending.current === href) {
          pending.current = null;
          setPhase('idle');
        }
      }, LEAVE_TIMEOUT_MS);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [router]);

  return <div aria-hidden="true" className="route-veil" />;
}
