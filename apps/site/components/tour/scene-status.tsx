'use client';

import { cn } from 'cn';
import { ChevronDownIcon, RotateCcwIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { PrState } from '@/components/tour/bits';
import { Avatar, STATE_COLOR } from '@/components/tour/bits';
import { Ping } from '@/components/tour/ping';
import { PrWindow, StateIcon, stateWord } from '@/components/tour/pr-window';

interface Option {
  readonly to: PrState;
  readonly label: string;
}

/** What the pill offers from each status: never the status it has, forward first, closing last. */
const OPTIONS: Record<PrState, readonly Option[]> = {
  open: [
    { to: 'merged', label: 'Squash and merge' },
    { to: 'draft', label: 'Convert to draft' },
    { to: 'closed', label: 'Close pull request' },
  ],
  draft: [
    { to: 'open', label: 'Ready for review' },
    { to: 'closed', label: 'Close pull request' },
  ],
  closed: [{ to: 'open', label: 'Reopen pull request' }],
  merged: [],
};

const EVENT: Record<PrState, string> = {
  open: 'marked this pull request as ready for review',
  draft: 'marked this pull request as draft',
  closed: 'closed this',
  merged: 'merged commit 3f2a91c into main',
};

const ICON_COLOR: Record<PrState, string> = {
  open: 'text-[#1f883d]',
  draft: 'text-[#6e7781]',
  merged: 'text-[#8250df]',
  closed: 'text-[#cf222e]',
};

export function StatusScene() {
  const [state, setState] = useState<PrState>('open');
  const [menuOpen, setMenuOpen] = useState(false);
  const [events, setEvents] = useState<readonly PrState[]>([]);
  const pillRef = useRef<HTMLButtonElement>(null);
  const options = OPTIONS[state];

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      pillRef.current?.focus();
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [menuOpen]);

  const change = (to: PrState): void => {
    setState(to);
    setEvents((current) => [...current, to].slice(-2));
    setMenuOpen(false);
  };

  const pill =
    options.length === 0 ? (
      <span className={cn('inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors duration-300', STATE_COLOR[state])}>
        <StateIcon state={state} />
        {stateWord(state)}
      </span>
    ) : (
      <span className="relative">
        <Ping tone={ICON_COLOR[state]} className="inline-flex rounded-full">
          <button
            ref={pillRef}
            type="button"
            aria-expanded={menuOpen}
            aria-label={`${stateWord(state)}. Change the status`}
            onClick={() => setMenuOpen((value) => !value)}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-semibold outline-none transition-[background-color,filter] duration-300 hover:brightness-95 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card',
              STATE_COLOR[state],
            )}
          >
            <StateIcon state={state} />
            {stateWord(state)}
            <ChevronDownIcon aria-hidden="true" strokeWidth={2.5} className={cn('-mr-1 size-3 opacity-80 transition-transform', menuOpen && 'rotate-180')} />
          </button>
        </Ping>
        <span
          className={cn(
            'absolute top-full left-0 z-20 mt-1.5 flex w-60 origin-top-left flex-col rounded-lg border bg-popover p-1 text-popover-foreground shadow-xl transition-[opacity,transform] duration-200',
            menuOpen ? 'scale-100 opacity-100' : 'pointer-events-none scale-95 opacity-0',
          )}
          inert={!menuOpen}
        >
          {options.map((option) => (
            <button
              key={option.to}
              type="button"
              onClick={() => change(option.to)}
              className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[0.8125rem] font-medium text-foreground outline-none hover:bg-muted focus-visible:bg-muted"
            >
              <StateIcon state={option.to} className={cn('size-4', ICON_COLOR[option.to])} />
              {option.label}
            </button>
          ))}
        </span>
      </span>
    );

  return (
    <PrWindow tab="conversation" pill={pill} merged={state === 'merged'} bodyClassName="min-h-72">
      <ul className="flex flex-col gap-3 p-4 text-[0.8125rem]">
        <li className="flex items-center gap-2.5">
          <Avatar who="mona" size={18} />
          <span className="min-w-0 truncate">
            <span className="font-medium">mona</span> approved these changes
          </span>
        </li>
        <li className="flex items-center gap-2.5">
          <Avatar who="hubot" size={18} />
          <span className="min-w-0 truncate">
            <span className="font-medium">hubot</span> approved these changes
          </span>
        </li>
        <li className="flex items-center gap-2.5 text-muted-foreground">
          <span aria-hidden="true" className="h-px flex-1 border-t border-dashed" />
          38 more timeline items
          <span aria-hidden="true" className="h-px flex-1 border-t border-dashed" />
        </li>
        {events.map((to, index) => (
          <li key={index} className="flex items-center gap-2.5">
            <span className={cn('grid size-[18px] place-items-center rounded-full', STATE_COLOR[to])}>
              <StateIcon state={to} className="size-2.5" />
            </span>
            <span className="min-w-0 truncate">
              <span className="font-medium">you</span> {EVENT[to]}
            </span>
          </li>
        ))}
      </ul>
      <div className="mx-4 mb-4 rounded-lg border">
        <p className="flex items-center gap-2 border-b px-3 py-2 text-xs font-medium">
          <span aria-hidden="true" className="size-3.5 rounded-full border-[3px] border-addition" />
          All checks have passed
        </p>
        <p className="flex items-center justify-between gap-3 px-3 py-2 text-xs text-muted-foreground">
          The merge box, at the very end of the page
          <span className={cn('rounded-md px-2 py-1 font-medium text-white', state === 'merged' ? 'bg-[#8250df]' : 'bg-[#1f883d]/60')}>{state === 'merged' ? 'Merged' : 'Squash and merge'}</span>
        </p>
      </div>
      {state === 'merged' ? (
        <button
          type="button"
          onClick={() => {
            setState('open');
            setEvents([]);
          }}
          className="mx-4 inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted"
        >
          <RotateCcwIcon aria-hidden="true" className="size-3" />
          Start over
        </button>
      ) : null}
    </PrWindow>
  );
}
