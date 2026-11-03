'use client';

import type { CategoryId, HiddenCategory } from '@geld/core';
import { categoryById, createMatcher, DEFAULT_SETTINGS, formatCount, pluralize, subtractTotals } from '@geld/core';
import { cn } from 'cn';
import { CheckIcon, ChevronDownIcon, EyeOffIcon, FileCodeIcon } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Diffstat } from '@/components/demo/diffstat';
import type { TourFile } from '@/components/tour/data';
import { TOUR_FILES, totalsOf } from '@/components/tour/data';
import { PrWindow } from '@/components/tour/pr-window';

export const TOGGLES: readonly CategoryId[] = ['tests', 'generated', 'docs', 'tooling'];

export interface Classified extends TourFile {
  readonly category: HiddenCategory | null;
}

export function useClassified(enabled: ReadonlySet<CategoryId>): readonly Classified[] {
  return useMemo(() => {
    const categories = Object.fromEntries(TOGGLES.map((id) => [id, enabled.has(id)]));
    const matcher = createMatcher({ ...DEFAULT_SETTINGS, categories });
    return TOUR_FILES.map((file) => ({ ...file, category: matcher.categorize(file.path) }));
  }, [enabled]);
}

/** "6 tests" with one category hiding files, "9 hidden" with several. */
export function hiddenLabel(hidden: readonly Classified[]): string {
  const ids = new Set(hidden.map((file) => file.category?.id));
  const only = hidden[0]?.category;
  if (ids.size === 1 && only) return `${formatCount(hidden.length)} ${hidden.length === 1 ? only.shortNoun : only.shortNounPlural}`;
  return `${formatCount(hidden.length)} hidden`;
}

export function NoiseScene() {
  const [enabled, setEnabled] = useState<ReadonlySet<CategoryId>>(() => new Set<CategoryId>(['tests', 'generated']));
  const [showHidden, setShowHidden] = useState(false);
  const files = useClassified(enabled);
  const hidden = files.filter((file) => file.category !== null);
  const shown = subtractTotals(totalsOf(files), totalsOf(hidden));

  const toggle = (id: CategoryId): void => {
    setEnabled((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const perCategory = TOGGLES.map((id) => ({ id, count: hidden.filter((file) => file.category?.id === id).length })).filter((entry) => entry.count > 0);

  return (
    <PrWindow
      tab="files"
      filesCount={shown.files}
      tabsEnd={
        <>
          {hidden.length > 0 ? <span className="border-b border-dotted border-muted-foreground/60 text-xs font-semibold text-muted-foreground">{hiddenLabel(hidden)}</span> : null}
          <Diffstat totals={shown} className="max-sm:[&>span:last-child]:hidden" />
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-1.5 border-b bg-muted/40 px-4 py-2.5" role="group" aria-label="Categories to hide">
        <span className="mr-1 text-xs text-muted-foreground">Hide</span>
        {TOGGLES.map((id) => {
          const on = enabled.has(id);
          return (
            <button
              key={id}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(id)}
              className={cn(
                'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/40',
                on ? 'border-foreground bg-foreground text-background' : 'bg-card text-muted-foreground hover:text-foreground',
              )}
            >
              <span className={cn('grid size-3.5 place-items-center rounded-full border transition-colors', on ? 'border-background bg-background text-foreground' : 'border-muted-foreground/50')}>
                {on ? <CheckIcon aria-hidden="true" className="size-2.5" strokeWidth={3} /> : null}
              </span>
              {categoryById(id).title}
            </button>
          );
        })}
      </div>

      <ul aria-label="Files to review">
        {files.map((file) => (
          <Collapse key={file.path} open={file.category === null}>
            <FileLine file={file} />
          </Collapse>
        ))}
      </ul>

      <div className={cn('border-t border-dashed transition-opacity duration-300', hidden.length === 0 && 'opacity-0')}>
        <div className="flex items-center justify-between gap-3 px-4 py-2 text-xs text-muted-foreground">
          <span className="inline-flex min-w-0 items-center gap-2">
            <EyeOffIcon aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="truncate">
              <span className="font-medium text-foreground">{pluralize(hidden.length, 'file', 'files')}</span> hidden
              <span className="max-sm:hidden">
                {perCategory.map((entry) => {
                  const category = categoryById(entry.id);
                  return ` · ${entry.count} ${entry.count === 1 ? category.shortNoun : category.shortNounPlural}`;
                })}
              </span>
            </span>
          </span>
          <button
            type="button"
            aria-expanded={showHidden}
            onClick={() => setShowHidden((value) => !value)}
            disabled={hidden.length === 0}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border bg-background px-2 py-1 font-medium text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/40"
          >
            {showHidden ? 'Hide' : 'Show'}
            <ChevronDownIcon aria-hidden="true" className={cn('size-3.5 transition-transform', showHidden && 'rotate-180')} />
          </button>
        </div>
        <ul aria-label="Hidden files" className="bg-muted/40">
          {files.map((file) => (
            <Collapse key={file.path} open={showHidden && file.category !== null}>
              <FileLine file={file} dim />
            </Collapse>
          ))}
        </ul>
      </div>
    </PrWindow>
  );
}

/** Height and opacity ease together, so a file slides out of one list and into the other. */
function Collapse({ open, children }: { readonly open: boolean; readonly children: React.ReactNode }) {
  return (
    <li
      aria-hidden={!open}
      className={cn('grid transition-[grid-template-rows,opacity] duration-300 ease-out', open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0')}
    >
      <div className="overflow-hidden">{children}</div>
    </li>
  );
}

function FileLine({ file, dim = false }: { readonly file: Classified; readonly dim?: boolean }) {
  const index = file.path.lastIndexOf('/');
  const directory = index === -1 ? '' : file.path.slice(0, index + 1);
  const name = file.path.slice(index + 1);
  return (
    <div className={cn('flex items-center gap-2 border-b px-4 py-1.5 font-mono text-xs', dim && 'text-muted-foreground')}>
      <FileCodeIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">
        <span className="text-muted-foreground">{directory}</span>
        <span className={dim ? undefined : 'text-foreground'}>{name}</span>
      </span>
      {dim && file.category ? <span className="shrink-0 rounded-full border px-1.5 font-sans text-[0.625rem]">{file.category.title}</span> : null}
      <span className="shrink-0 tabular-nums">
        <span className="text-addition">+{formatCount(file.additions)}</span> <span className="text-deletion">&minus;{formatCount(file.deletions)}</span>
      </span>
    </div>
  );
}
