'use client';

import { pluralize } from '@geld/core';
import { cn } from 'cn';
import { ChevronDownIcon, EyeOffIcon } from 'lucide-react';
import { useId, useState } from 'react';

import { FileRow } from '@/components/demo/file-row';
import type { ClassifiedFile } from '@/components/demo/sample-pr';

/**
 * The borderless "N test files hidden" row Geld appends below the diff, with
 * its "Show test files" toggle. Expanding reveals the files in place.
 */
export function HiddenRow({
  files,
  noun,
  nounPlural,
  defaultOpen = false,
  overlayOnDesktop = false,
}: {
  readonly files: readonly ClassifiedFile[];
  readonly noun: string;
  readonly nounPlural: string;
  readonly defaultOpen?: boolean;
  /**
   * On wide screens, drop the expanded list over whatever follows instead of
   * pushing it down (the home page has room; phones do not, so they still push).
   */
  readonly overlayOnDesktop?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const label = pluralize(files.length, noun, nounPlural);
  return (
    <div className={cn('border-t border-dashed', overlayOnDesktop && 'lg:relative')} data-hidden-open={open}>
      <div className="flex items-center justify-between gap-3 px-4 py-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <EyeOffIcon aria-hidden="true" className="size-3.5" />
          <span>
            <span className="font-medium text-foreground">{label}</span> hidden
          </span>
        </span>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
          className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs font-medium text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/40"
        >
          {/* Both labels occupy the same grid cell so the button keeps the wider width and nothing shifts. */}
          <span className="grid text-left">
            <span aria-hidden={open} className={cn('col-start-1 row-start-1', open && 'invisible')}>
              Show {nounPlural}
            </span>
            <span aria-hidden={!open} className={cn('col-start-1 row-start-1', !open && 'invisible')}>
              Hide {nounPlural}
            </span>
          </span>
          <ChevronDownIcon aria-hidden="true" className={open ? 'size-3.5 rotate-180 transition-transform motion-reduce:transition-none' : 'size-3.5 transition-transform motion-reduce:transition-none'} />
        </button>
      </div>
      <ul
        id={panelId}
        hidden={!open}
        className={cn(
          'border-t bg-muted/40',
          // Sits just below the frame, matching its border and radius, above the next section.
          overlayOnDesktop && 'lg:absolute lg:inset-x-[-1px] lg:top-full lg:z-10 lg:rounded-b-xl lg:border lg:border-t-0 lg:bg-card lg:shadow-lg',
        )}
      >
        {files.map((file) => (
          <FileRow key={file.path} file={file} dim />
        ))}
      </ul>
    </div>
  );
}
