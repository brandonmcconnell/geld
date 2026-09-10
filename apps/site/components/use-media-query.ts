'use client';

import { useSyncExternalStore } from 'react';

/** Whether a media query matches; `false` on the server and before hydration. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = matchMedia(query);
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    },
    () => matchMedia(query).matches,
    () => false,
  );
}
