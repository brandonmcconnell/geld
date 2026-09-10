'use client';

import { cn } from 'cn';
import { useEffect, useState } from 'react';

export interface TocEntry {
  readonly id: string;
  readonly label: string;
}

interface SectionTocProps {
  readonly entries: readonly TocEntry[];
  /** Distance from the viewport top at which a section counts as current (matches `scroll-mt`). */
  readonly offset?: number;
  readonly className?: string;
}

/**
 * Numbered table of contents that highlights the section currently in view:
 * the last section whose top has scrolled past `offset` (the first one while
 * still above it), or the final one once the page is scrolled to the bottom.
 */
export function SectionToc({ entries, offset = 128, className }: SectionTocProps) {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
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
      // Above the first section (the intro) the first entry is the sensible highlight.
      setActive((current ?? sections[0])?.id ?? null);
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
  }, [entries, offset]);

  return (
    <ol className={cn('flex flex-col gap-2 border-l text-sm', className)}>
      {entries.map((entry, index) => {
        const isActive = entry.id === active;
        return (
          <li key={entry.id}>
            <a
              href={`#${entry.id}`}
              aria-current={isActive ? 'location' : undefined}
              className={cn(
                '-ml-px flex items-baseline gap-2.5 border-l py-1 pl-4 whitespace-nowrap transition-colors',
                isActive ? 'border-foreground font-medium text-foreground' : 'border-transparent text-muted-foreground hover:border-foreground/40 hover:text-foreground',
              )}
            >
              <span className="font-mono text-xs tabular-nums">{String(index + 1).padStart(2, '0')}</span>
              {entry.label}
            </a>
          </li>
        );
      })}
    </ol>
  );
}
