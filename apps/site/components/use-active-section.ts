'use client';

import { useEffect, useState } from 'react';

export interface SectionEntry {
  readonly id: string;
  readonly label: string;
}

export interface ActiveSection {
  readonly id: string | null;
  /** False until the first measurement; before that `id` is just the first entry. */
  readonly measured: boolean;
}

/**
 * Id of the section currently in view: the last one whose top has scrolled
 * past `offset` (the first one while still above it), or the final one once
 * the page is scrolled to the bottom. Updated at most once per frame.
 */
export function useActiveSection(entries: readonly SectionEntry[], offset: number, enabled = true): ActiveSection {
  const [active, setActive] = useState<ActiveSection>({ id: entries[0]?.id ?? null, measured: false });

  useEffect(() => {
    if (!enabled) return;
    const sections = entries.map((entry) => document.getElementById(entry.id)).filter((element): element is HTMLElement => element !== null);
    if (sections.length === 0) return;
    let frame: number | null = null;

    const update = (): void => {
      frame = null;
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      let current: HTMLElement | null = null;
      if (atBottom) {
        current = sections[sections.length - 1] ?? null;
      } else {
        for (const section of sections) {
          if (section.getBoundingClientRect().top <= offset) current = section;
          else break;
        }
      }
      const id = (current ?? sections[0])?.id ?? null;
      setActive((previous) => (previous.measured && previous.id === id ? previous : { id, measured: true }));
    };
    const schedule = (): void => {
      if (frame === null) frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [entries, offset, enabled]);

  return active;
}
