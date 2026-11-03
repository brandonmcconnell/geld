'use client';

import { cn } from 'cn';
import { CheckIcon, ChevronDownIcon, LoaderCircleIcon, SendIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { BotId } from '@/components/tour/bits';
import { Avatar, BotMark, botName, Chip } from '@/components/tour/bits';
import { PrWindow } from '@/components/tour/pr-window';
import { Light } from '@/components/tour/scene-digest';

type RunState = 'findings' | 'earlier' | 'passed' | 'not-run' | 'running';

interface BotLine {
  readonly bot: BotId;
  readonly trigger: string;
  readonly state: RunState;
}

const START: readonly BotLine[] = [
  { bot: 'buggy', trigger: 'buggy run', state: 'findings' },
  { bot: 'codehopper', trigger: '@codehopper review', state: 'earlier' },
  { bot: 'gecko', trigger: '@gecko', state: 'passed' },
  { bot: 'devlin', trigger: '/devlin review', state: 'not-run' },
];

const STATE_WORD: Record<RunState, string> = { findings: 'Findings', earlier: 'Earlier commit', passed: 'Passed', 'not-run': 'Not run', running: 'Running' };
const STATE_CLASS: Record<RunState, string> = {
  findings: 'text-[#9a6700] dark:text-[#d29922]',
  earlier: 'text-muted-foreground',
  passed: 'text-addition',
  'not-run': 'text-muted-foreground',
  running: 'text-[#0969da] dark:text-[#4493f8]',
};

const OTHER_BOTS = ['Wingman', 'Clawed Review', 'cuboid', 'Kodo', 'Sorcery', 'Gemstone Code Assist'];

export function RequestScene() {
  const [lines, setLines] = useState<readonly BotLine[]>(START);
  const [ticked, setTicked] = useState<ReadonlySet<BotId>>(() => new Set<BotId>(['buggy', 'codehopper']));
  const [menuOpen, setMenuOpen] = useState(true);
  const [othersOpen, setOthersOpen] = useState(false);
  const [posted, setPosted] = useState<readonly string[]>([]);
  const running = lines.some((line) => line.state === 'running');

  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => setLines((current) => current.map((line) => (line.state === 'running' ? { ...line, state: 'passed' } : line))), 2600);
    return () => window.clearTimeout(timer);
  }, [running]);

  const run = (): void => {
    const picked = lines.filter((line) => ticked.has(line.bot));
    setPosted((current) => [...current, ...picked.map((line) => line.trigger)].slice(-START.length));
    setLines((current) => current.map((line) => (ticked.has(line.bot) ? { ...line, state: 'running' } : line)));
    setMenuOpen(false);
    setTicked(new Set());
  };

  const pickedCount = ticked.size;
  const first = lines.find((line) => ticked.has(line.bot));
  const runLabel = pickedCount === 0 ? 'Run' : pickedCount === 1 && first ? `Run ${botName(first.bot)}` : `Run ${pickedCount} bots`;

  return (
    <PrWindow tab="conversation" bodyClassName="min-h-96">
      <div className="m-3 rounded-lg border text-xs">
        <div className="relative flex items-center gap-3 px-3 py-2">
          <span className="w-20 shrink-0 text-muted-foreground">Review bots</span>
          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
            {lines
              .filter((line) => line.state !== 'not-run')
              .map((line) => (
                <Chip key={line.bot}>
                  <BotMark bot={line.bot} size={16} pill />
                  {botName(line.bot)}
                  {line.state === 'running' ? (
                    <LoaderCircleIcon aria-hidden="true" className="size-3 animate-spin text-[#0969da] dark:text-[#4493f8]" />
                  ) : (
                    <Light tone={line.state === 'passed' ? 'good' : line.state === 'findings' ? 'warn' : 'idle'} />
                  )}
                </Chip>
              ))}
          </div>
          <button
            type="button"
            aria-expanded={menuOpen}
            aria-label="Request a review"
            onClick={() => setMenuOpen((value) => !value)}
            className={cn('grid size-7 shrink-0 place-items-center rounded-md outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/40', menuOpen && 'bg-muted')}
          >
            {running ? <LoaderCircleIcon aria-hidden="true" className="size-3.5 animate-spin" /> : <SendIcon aria-hidden="true" className="size-3.5" />}
          </button>

          <div
            className={cn(
              'absolute top-full right-2 z-10 mt-1 w-72 max-w-[calc(100%-1rem)] origin-top-right rounded-lg border bg-popover text-popover-foreground shadow-xl transition-[opacity,transform] duration-200',
              menuOpen ? 'scale-100 opacity-100' : 'pointer-events-none scale-95 opacity-0',
            )}
            inert={!menuOpen}
          >
            <p className="border-b px-3 py-2 font-semibold">Request a review</p>
            <ul className="py-1">
              {lines.map((line) => {
                const on = ticked.has(line.bot);
                return (
                  <li key={line.bot}>
                    <label className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 hover:bg-muted/60">
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={line.state === 'running'}
                        onChange={() =>
                          setTicked((previous) => {
                            const next = new Set(previous);
                            if (next.has(line.bot)) next.delete(line.bot);
                            else next.add(line.bot);
                            return next;
                          })
                        }
                        className="size-3.5 accent-foreground"
                      />
                      <BotMark bot={line.bot} size={18} />
                      <span className="flex-1 font-medium">{botName(line.bot)}</span>
                      <span className={STATE_CLASS[line.state]}>{STATE_WORD[line.state]}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <button type="button" aria-expanded={othersOpen} onClick={() => setOthersOpen((value) => !value)} className="flex w-full items-center gap-1 border-t px-3 py-1.5 text-left text-muted-foreground hover:text-foreground">
              <ChevronDownIcon aria-hidden="true" className={cn('size-3.5 transition-transform', !othersOpen && '-rotate-90')} />
              Other bots (14)
            </button>
            {othersOpen ? <p className="px-3 pb-2 text-muted-foreground">{OTHER_BOTS.join(', ')} and more</p> : null}
            <div className="flex justify-end gap-2 border-t px-3 py-2">
              <button type="button" onClick={() => setMenuOpen(false)} className="rounded-md px-2 py-1 font-medium hover:bg-muted">
                Cancel
              </button>
              <button
                type="button"
                onClick={run}
                disabled={pickedCount === 0}
                className="rounded-md bg-[#1f883d] px-2.5 py-1 font-medium text-white transition-opacity disabled:opacity-50"
              >
                {runLabel}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-3 mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        <BotMark bot="buggy" size={18} />
        <span className="min-w-0 truncate">
          <span className="font-medium text-foreground">Buggy</span> reviewed · found 1 potential issue
        </span>
      </div>
      <div className="mx-3 mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        <BotMark bot="codehopper" size={18} />
        <span className="min-w-0 truncate">
          <span className="font-medium text-foreground">CodeHopper</span> reviewed · Actionable comments posted: 0
        </span>
      </div>
      <div className="mx-3 mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        <Avatar who="octocat" size={18} />
        <span className="min-w-0 truncate">
          <span className="font-medium text-foreground">octocat</span> pushed 1 commit · Warn when defaultPressed meets pressed
        </span>
      </div>
      <ul className="mx-3 mt-2 flex flex-col gap-2" aria-label="Comments posted">
        {posted.map((text, index) => (
          <li key={`${text}-${index}`} className="flex items-center gap-2 text-xs">
            <Avatar who="you" size={18} />
            <span className="rounded-lg border bg-card px-2.5 py-1 font-mono">{text}</span>
            <CheckIcon aria-hidden="true" className="size-3 text-muted-foreground" />
            <span className="text-muted-foreground">posted</span>
          </li>
        ))}
      </ul>
    </PrWindow>
  );
}
