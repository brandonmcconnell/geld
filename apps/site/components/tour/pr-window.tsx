'use client';

import { cn } from 'cn';
import { GitMergeIcon, GitPullRequestClosedIcon, GitPullRequestDraftIcon, GitPullRequestIcon } from 'lucide-react';
import { useEffect, useRef } from 'react';

import type { PrState } from '@/components/tour/bits';
import { TOUR_FILES } from '@/components/tour/data';
import { STATE_COLOR } from '@/components/tour/bits';

export type PrTab = 'conversation' | 'commits' | 'checks' | 'files';

const TABS: readonly { readonly id: PrTab; readonly label: string; readonly count?: number; readonly path: string }[] = [
  { id: 'conversation', label: 'Conversation', count: 6, path: '' },
  { id: 'commits', label: 'Commits', count: 4, path: '/commits' },
  { id: 'checks', label: 'Checks', count: 18, path: '/checks' },
  { id: 'files', label: 'Files changed', count: TOUR_FILES.length, path: '/files' },
];

const STATE_WORD: Record<PrState, string> = { open: 'Open', draft: 'Draft', merged: 'Merged', closed: 'Closed' };

export function StateIcon({ state, className }: { readonly state: PrState; readonly className?: string }) {
  const Icon = state === 'merged' ? GitMergeIcon : state === 'closed' ? GitPullRequestClosedIcon : state === 'draft' ? GitPullRequestDraftIcon : GitPullRequestIcon;
  return <Icon aria-hidden="true" className={cn('size-3.5', className)} strokeWidth={2.5} />;
}

/** GitHub's state label, as a plain label. */
export function StatePill({ state }: { readonly state: PrState }) {
  return (
    <span className={cn('inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-semibold', STATE_COLOR[state])}>
      <StateIcon state={state} />
      {STATE_WORD[state]}
    </span>
  );
}

export function stateWord(state: PrState): string {
  return STATE_WORD[state];
}

/**
 * A browser window holding a trimmed GitHub pull request: address bar, title,
 * state label, tabs, then whatever the scene puts in the body.
 */
const CONTROL = 'a[href], button, input, select, [role="switch"], [role="checkbox"]';

export function PrWindow({
  tab,
  onTab,
  pill,
  tabsEnd,
  filesCount,
  merged = false,
  children,
  className,
  bodyClassName,
}: {
  readonly tab: PrTab;
  readonly onTab?: (tab: PrTab) => void;
  /** Replaces the plain Open label. */
  readonly pill?: React.ReactNode;
  /** What stands at the right end of the tab bar (counts, the review group). */
  readonly tabsEnd?: React.ReactNode;
  /** The Files changed count, as Geld rewrites it. */
  readonly filesCount?: number;
  readonly merged?: boolean;
  readonly children: React.ReactNode;
  readonly className?: string;
  readonly bodyClassName?: string;
}) {
  const path = TABS.find((entry) => entry.id === tab)?.path ?? '';
  const root = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = root.current;
    if (node === null) return;
    // Out of view, the window's ping pauses (`ping-fade`).
    const observer = new IntersectionObserver(([entry]) => {
      if (entry) node.toggleAttribute('data-offscreen', !entry.isIntersecting);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={root}
      onClickCapture={(event) => {
        // The first press on a control marks the scene used, which fades its ping (`ping-fade`).
        if (event.target instanceof Element && event.target.closest(CONTROL)) event.currentTarget.dataset.used = '';
      }}
      className={cn('@container flex flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-[0_24px_60px_-28px_rgb(0_0_0/0.35)]', className)}
    >
      <div className="flex h-9 shrink-0 items-center gap-3 border-b bg-muted/60 px-3">
        <span aria-hidden="true" className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-foreground/15" />
          <span className="size-2.5 rounded-full bg-foreground/15" />
          <span className="size-2.5 rounded-full bg-foreground/15" />
        </span>
        <span className="min-w-0 flex-1 truncate rounded-md bg-background px-2.5 py-0.5 text-center font-mono text-[0.6875rem] text-muted-foreground">
          github.com/acme/widgets/pull/128{path}
        </span>
        <span aria-hidden="true" className="w-[42px]" />
      </div>
      <div className="shrink-0 px-4 pt-3">
        <p className="truncate text-[1.0625rem] font-semibold tracking-tight">
          Add a controlled mode to Button <span className="font-normal text-muted-foreground">#128</span>
        </p>
        <div className="mt-2 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          {pill ?? <StatePill state="open" />}
          <span className="min-w-0 truncate">
            <span className="font-medium text-foreground">octocat</span> {merged ? 'merged' : 'wants to merge'} 4 commits into <code className="rounded bg-muted px-1 font-mono">main</code>
          </span>
        </div>
      </div>
      <div className="mt-2 flex shrink-0 items-end justify-between gap-3 border-b px-2">
        {/* Clickable tabs all stay, scrolling sideways when they do not fit; a static bar drops the ones nobody needs on a narrow window. */}
        <ul
          className={cn('-mb-px flex min-w-0 items-end text-[0.8125rem] text-muted-foreground', onTab ? 'overflow-x-auto [scrollbar-width:none]' : 'overflow-hidden')}
          aria-label="Pull request tabs"
        >
          {TABS.map((entry) => {
            const active = entry.id === tab;
            const count = entry.id === 'files' && filesCount !== undefined ? filesCount : entry.count;
            const content = (
              <>
                {entry.label}
                {count !== undefined ? (
                  <span className="rounded-full bg-muted px-1.5 font-mono text-[0.625rem] tabular-nums ring-1 ring-border ring-inset">{count}</span>
                ) : null}
              </>
            );
            const classes = cn(
              'flex items-center gap-1.5 border-b-2 px-2.5 py-2 whitespace-nowrap',
              active ? 'border-[#fd8c73] font-medium text-foreground' : 'border-transparent',
            );
            return (
              <li key={entry.id} className={cn('shrink-0', !onTab && entry.id !== 'files' && entry.id !== tab && '@max-xl:hidden')}>
                {onTab ? (
                  <button type="button" aria-current={active ? 'page' : undefined} onClick={() => onTab(entry.id)} className={cn(classes, 'outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50')}>
                    {content}
                  </button>
                ) : (
                  <span aria-current={active ? 'page' : undefined} className={classes}>
                    {content}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        {tabsEnd ? <div className="flex shrink-0 items-center gap-2 pb-1.5">{tabsEnd}</div> : null}
      </div>
      {/* Never a scroll container: a wheel over the window must scroll the page, so every scene is laid out to fit. */}
      <div className={cn('min-h-0 flex-1 overflow-hidden', bodyClassName)}>{children}</div>
    </div>
  );
}
