'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

/** Fade-out plus fade-in; mirrored by `::view-transition-*(root)` in globals.css. */
const ENTER_MS = 320;
/** Give up waiting for a navigation that never lands (offline, blocked) so the page is not frozen. */
const NAVIGATION_TIMEOUT_MS = 2500;

/** Resolved by the component when the router has committed a new pathname. */
let settleNavigation: (() => void) | null = null;

/**
 * A couple of frames (or 50ms, whichever comes first) so the router's
 * scroll-to-top has been applied before the browser captures the new page.
 * Some engines otherwise snapshot it at the old scroll offset and jump when
 * the transition ends.
 */
function afterScrollSettles(): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 50);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  });
}

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
 * Page-to-page fade: the old page blurs and fades out, then the new one blurs
 * and fades in, via a view transition that this component starts itself
 * around `router.push`. Starting it here (rather than through React's
 * <ViewTransition>) keeps the browser's viewport-sized root snapshot: the old
 * page is frozen exactly as it was — scroll position included — while the new
 * page renders and scrolls to the top underneath. The header is snapshotted
 * separately and snaps (see `::view-transition-*` in globals.css). Blurring a
 * viewport is cheap; snapshotting <main> is not.
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
    const timer = setTimeout(() => delete root.dataset.routeEntering, ENTER_MS);
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
      // While the transition runs, the header wordmark's own 500ms reveal is
      // switched off (globals.css): the header snaps to its new state, instead
      // of continuing to animate underneath the snapshots and jumping when they
      // are removed.
      const root = document.documentElement;
      root.dataset.routeTransition = '';
      const transition = document.startViewTransition(async () => {
        router.push(href);
        await Promise.race([committed, timeout]);
        // The router scrolls the new page to the top (or its hash) during commit; let that land before the capture.
        if (url.hash === '') window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
        await afterScrollSettles();
      });
      void transition.finished.finally(() => {
        delete root.dataset.routeTransition;
      });
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [router]);

  return null;
}
