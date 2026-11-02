'use client';
import { useEffect } from 'react';
export function CornerShapePolyfill() {
  useEffect(() => {
    if (CSS.supports('corner-shape', 'bevel')) return;
    let controller: { destroy(): void; refresh(): void } | null = null;
    let cancelled = false;
    const updateChoice = (event: Event) => {
      if (event.target instanceof HTMLInputElement && ['checkbox', 'radio'].includes(event.target.type))
        requestAnimationFrame(() => {
          if (!cancelled) controller?.refresh();
        });
    };
    void import('hyperellipse').then(({ registerHyperellipse }) => {
      if (cancelled) return;
      controller = registerHyperellipse();
      document.addEventListener('change', updateChoice);
    });
    return () => {
      cancelled = true;
      document.removeEventListener('change', updateChoice);
      controller?.destroy();
    };
  }, []);
  return null;
}
