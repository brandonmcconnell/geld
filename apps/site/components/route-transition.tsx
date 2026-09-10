'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

/** Crossfade length; mirrored by `::view-transition-*(root)` in globals.css. */
const CROSSFADE_MS = 160;
/** Give up waiting for a navigation that never lands (offline, blocked) so the page is not frozen. */
const NAVIGATION_TIMEOUT_MS = 2500;

/** Resolved by the component when the router has committed a new pathname. */
let settleNavigation: (() => void) | null = null;

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
 * Page-to-page crossfade with a blur, done with a view transition that this
 * component starts itself around `router.push`. Starting it here (rather than
 * through React's <ViewTransition>) keeps the browser's viewport-sized root
 * snapshot: the old page is frozen exactly as it was — scroll position
 * included — while the new page renders and scrolls to the top underneath,
 * and the two simply crossfade (see `::view-transition-*(root)` in
 * globals.css). Blurring a viewport is cheap; snapshotting <main> is not.
 *
 * Navigations this component did not start (back/forward) get a short fade-in
 * of the new page instead, since the old state cannot be captured after the
 * fact. Browsers without the API navigate as before.
 */
export function RouteTransition() {
  const router = useRouter();
  const pathname = usePathname();
  const ownNavigation = useRef(false);
  const mounted = useRef(false);

  // A new pathname committed: the new page is in the DOM.
  useEffect(() => {
    if (settleNavigation !== null) {
      // Our view transition is waiting for this: let it take the "new" snapshot.
      settleNavigation();
      settleNavigation = null;
      ownNavigation.current = false;
      return;
    }
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    // Back/forward: the old state was not captured, so fade the new page in.
    const root = document.documentElement;
    root.dataset.routeEntering = '';
    const timer = setTimeout(() => delete root.dataset.routeEntering, CROSSFADE_MS);
    return () => {
      clearTimeout(timer);
      delete root.dataset.routeEntering;
    };
  }, [pathname]);

  useEffect(() => {
    if (typeof document.startViewTransition !== 'function') return;
    const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
    const onClick = (event: MouseEvent): void => {
      const url = internalDestination(event);
      if (url === null || reduceMotion.matches || ownNavigation.current) return;
      // Take over from <Link>: stop its handler and navigate inside the transition.
      event.preventDefault();
      event.stopPropagation();
      const href = url.pathname + url.search + url.hash;
      ownNavigation.current = true;
      const committed = new Promise<void>((resolve) => {
        settleNavigation = resolve;
      });
      const timeout = new Promise<void>((resolve) => {
        setTimeout(resolve, NAVIGATION_TIMEOUT_MS);
      });
      document.startViewTransition(() => {
        router.push(href);
        return Promise.race([committed, timeout]);
      });
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [router]);

  return null;
}
