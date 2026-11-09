'use client';

import { useEffect } from 'react';

/**
 * Selected text swaps foreground and background (`::selection` in globals.css),
 * but the logo is an image, which `::selection` never paints. While the
 * selection holds a logo it is marked `data-selected`, and `Wordmark` /
 * `Logomark` invert themselves.
 */
export function BrandSelection() {
  useEffect(() => {
    const sync = (): void => {
      const selection = document.getSelection();
      const ranges: Range[] = [];
      if (selection !== null && !selection.isCollapsed) {
        for (let index = 0; index < selection.rangeCount; index += 1) ranges.push(selection.getRangeAt(index));
      }
      // Ranges, not `Selection.containsNode`: Chrome's answers false for a node with no text of its own.
      for (const logo of document.querySelectorAll('[data-brand-logo]')) {
        logo.toggleAttribute('data-selected', ranges.some((range) => range.intersectsNode(logo)));
      }
    };
    document.addEventListener('selectionchange', sync);
    return () => document.removeEventListener('selectionchange', sync);
  }, []);
  return null;
}
