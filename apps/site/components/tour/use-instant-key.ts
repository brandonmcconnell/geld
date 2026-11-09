'use client';

import { useEffect, useState } from 'react';

/** Whether ⌘ (Ctrl off a Mac) is held, the key that turns Geld's controls into one-click actions. */
export function useInstantKey(): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const read = (event: KeyboardEvent): void => setHeld(event.metaKey || event.ctrlKey);
    const clear = (): void => setHeld(false);
    window.addEventListener('keydown', read);
    window.addEventListener('keyup', read);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', read);
      window.removeEventListener('keyup', read);
      window.removeEventListener('blur', clear);
    };
  }, []);
  return held;
}
