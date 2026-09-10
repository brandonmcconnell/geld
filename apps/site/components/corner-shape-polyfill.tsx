'use client';

import { useEffect } from 'react';

/**
 * Loads the `corner-shape` polyfill (hyperellipse) only in browsers without
 * the native property, i.e. Safari and Firefox today. The dynamic import is a
 * separate chunk, so supporting browsers never download it; there the CSS in
 * `globals.css` is all that runs.
 */
export function CornerShapePolyfill() {
  useEffect(() => {
    if (typeof CSS === 'undefined' || CSS.supports('corner-shape', 'bevel')) return;
    let controller: { destroy(): void } | null = null;
    let cancelled = false;
    void import('hyperellipse').then(({ registerHyperellipse }) => {
      if (cancelled) return;
      controller = registerHyperellipse();
    });
    return () => {
      cancelled = true;
      controller?.destroy();
    };
  }, []);
  return null;
}
