'use client';

import { cn } from 'cn';

import type { SectionEntry } from '@/components/use-active-section';
import { useActiveSection } from '@/components/use-active-section';

export type TocEntry = SectionEntry;

interface SectionTocProps {
  readonly entries: readonly TocEntry[];
  /** Distance from the viewport top at which a section counts as current (matches `scroll-mt`). */
  readonly offset?: number;
  readonly className?: string;
}

/** Numbered table of contents that highlights the section currently in view. */
export function SectionToc({ entries, offset = 128, className }: SectionTocProps) {
  const active = useActiveSection(entries, offset);

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
