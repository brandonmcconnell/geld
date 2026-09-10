'use client';

import { Dialog } from '@base-ui/react/dialog';
import { cn } from 'cn';
import { ChevronDownIcon } from 'lucide-react';
import { useRef, useState } from 'react';

import type { SectionEntry } from '@/components/use-active-section';
import { useActiveSection } from '@/components/use-active-section';

interface SectionNavMobileProps {
  readonly entries: readonly SectionEntry[];
  /** Distance from the viewport top at which a section counts as current (matches `scroll-mt`). */
  readonly offset?: number;
  readonly className?: string;
}

type Direction = 'down' | 'up';

interface Shown {
  readonly index: number;
  readonly direction: Direction;
  /** The label on its way out, animated in the same direction. */
  readonly leaving: number | null;
}

function Label({ entry, index, motion, onDone }: { readonly entry: SectionEntry; readonly index: number; readonly motion: string; readonly onDone?: () => void }) {
  return (
    <span data-motion={motion} onAnimationEnd={onDone} className="subnav-label col-start-1 row-start-1 flex items-baseline gap-2.5 whitespace-nowrap">
      <span className="font-mono text-xs tabular-nums text-muted-foreground">{String(index + 1).padStart(2, '0')}</span>
      <span className="truncate font-medium">{entry.label}</span>
    </span>
  );
}

/**
 * Phone-sized stand-in for the sidebar table of contents: a bar stuck under
 * the top bar that names the section in view. When the section changes, the
 * old name blurs, fades and slides out in the scroll direction while the new
 * one arrives from the other side. Tapping it opens the full list as a modal
 * sheet under the bar; the page cannot scroll while it is open.
 */
export function SectionNavMobile({ entries, offset = 128, className }: SectionNavMobileProps) {
  const active = useActiveSection(entries, offset);
  const activeIndex = Math.max(0, entries.findIndex((entry) => entry.id === active));
  const [shown, setShown] = useState<Shown>({ index: activeIndex, direction: 'down', leaving: null });
  const [open, setOpen] = useState(false);
  const navRef = useRef<HTMLElement | null>(null);
  // Where the sheet starts: the bar's bottom edge, read when it opens.
  const [sheetTop, setSheetTop] = useState(0);

  // The section changed since the last render: start the swap (state adjusted during render, not in an effect).
  if (activeIndex !== shown.index) {
    setShown({ index: activeIndex, direction: activeIndex > shown.index ? 'down' : 'up', leaving: shown.index });
  }
  const settle = (): void => setShown((current) => (current.leaving === null ? current : { ...current, leaving: null }));

  const current = entries[shown.index];
  const leaving = shown.leaving === null ? undefined : entries[shown.leaving];
  if (current === undefined) return null;

  return (
    <nav
      ref={navRef}
      aria-label="On this page"
      data-subbar="mobile"
      // Above the backdrop while the list is open, so the bar stays crisp as the sheet's anchor.
      className={cn('sticky top-[calc(3.5rem+1px)] border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70 lg:hidden', open ? 'z-50' : 'z-30', className)}
    >
      <Dialog.Root
        open={open}
        onOpenChange={(next) => {
          if (next) setSheetTop(navRef.current?.getBoundingClientRect().bottom ?? 0);
          setOpen(next);
        }}
        modal
      >
        <Dialog.Trigger
          aria-label={`Section ${shown.index + 1} of ${entries.length}: ${current.label}. Show all sections.`}
          className="container-site flex w-full items-center justify-between gap-3 py-2.5 text-left text-sm outline-none focus-visible:bg-muted/60"
        >
          {/* Old and new labels share one grid cell; the bar clips the one sliding out. */}
          <span className="grid min-w-0 flex-1 overflow-hidden">
            <Label key={`in-${shown.index}`} entry={current} index={shown.index} motion={shown.leaving === null ? 'none' : `in-${shown.direction}`} />
            {leaving !== undefined && shown.leaving !== null ? (
              <Label key={`out-${shown.leaving}`} entry={leaving} index={shown.leaving} motion={`out-${shown.direction}`} onDone={settle} />
            ) : null}
          </span>
          <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span className="font-mono tabular-nums">
              {shown.index + 1}/{entries.length}
            </span>
            <ChevronDownIcon aria-hidden="true" className={cn('size-4 transition-transform motion-reduce:transition-none', open && 'rotate-180')} />
          </span>
        </Dialog.Trigger>
        <Dialog.Portal>
          {/* Sits under the top bar (z-40) and this bar (z-50), so both stay sharp; only the page behind dims. */}
          <Dialog.Backdrop className="fixed inset-0 z-35 bg-background/50 backdrop-blur-[2px] transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none" />
          <Dialog.Popup
            aria-label="Sections"
            initialFocus={false}
            finalFocus={false}
            style={{ top: sheetTop, maxHeight: `calc(100dvh - ${sheetTop}px)` }}
            className={cn(
              'fixed inset-x-0 z-50 overflow-y-auto overscroll-contain border-b bg-background/85 shadow-md outline-none backdrop-blur supports-[backdrop-filter]:bg-background/70',
              'transition-[opacity,transform] duration-150 ease-out data-ending-style:-translate-y-1 data-ending-style:opacity-0 data-starting-style:-translate-y-1 data-starting-style:opacity-0 motion-reduce:transition-none',
            )}
          >
            <ol className="container-site py-2">
              {entries.map((entry, index) => {
                const isActive = index === shown.index;
                return (
                  <li key={entry.id}>
                    <a
                      href={`#${entry.id}`}
                      aria-current={isActive ? 'location' : undefined}
                      onClick={() => setOpen(false)}
                      className={cn(
                        'flex items-baseline gap-2.5 py-2 text-sm outline-none focus-visible:bg-muted/60',
                        isActive ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      <span className="font-mono text-xs tabular-nums">{String(index + 1).padStart(2, '0')}</span>
                      {entry.label}
                    </a>
                  </li>
                );
              })}
            </ol>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </nav>
  );
}
