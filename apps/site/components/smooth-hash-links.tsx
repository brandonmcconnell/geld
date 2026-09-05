'use client';

import { useEffect } from 'react';

/**
 * Smooth scrolling only for same-page hash links (tables of contents, the
 * category pills). Navigating to another page snaps to the top, which a global
 * `scroll-behavior: smooth` would animate from the old scroll position.
 */
export function SmoothHashLinks() {
  useEffect(() => {
    const onClick = (event: MouseEvent): void => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest('a[href]');
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target !== '') return;
      const url = new URL(anchor.href, location.href);
      if (url.origin !== location.origin || url.pathname !== location.pathname || url.search !== location.search || url.hash === '') return;
      const id = decodeURIComponent(url.hash.slice(1));
      const destination = document.getElementById(id);
      if (destination === null) return;
      event.preventDefault();
      const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
      destination.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      history.pushState(null, '', url.hash);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);
  return null;
}
