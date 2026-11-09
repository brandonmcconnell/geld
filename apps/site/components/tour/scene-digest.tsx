'use client';

import { cn } from 'cn';
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, CircleCheckIcon, CircleIcon, MessagesSquareIcon, RocketIcon, XIcon } from 'lucide-react';
import { useState } from 'react';

import type { BotId, Person } from '@/components/tour/bits';
import { Avatar, BotMark, CARD_HEAD, Chip, GeldRowTools, Meter } from '@/components/tour/bits';
import { Ping } from '@/components/tour/ping';
import { PrWindow } from '@/components/tour/pr-window';

interface Thread {
  readonly id: string;
  readonly title: string;
  readonly path: string;
  readonly by: { readonly bot: BotId } | { readonly person: Person };
  readonly said: string;
  readonly reply: string;
}

const THREADS: readonly Thread[] = [
  {
    id: 'default',
    title: 'Controlled value ignores defaultPressed',
    path: 'src/Button.tsx',
    by: { bot: 'buggy' },
    said: '`defaultPressed` is dropped once `pressed` is set. Warn in development.',
    reply: 'Added a dev warning in 3f2a91c.',
  },
  {
    id: 'aria',
    title: 'aria-pressed is missing when uncontrolled',
    path: 'src/Button.tsx',
    by: { person: 'hubot' },
    said: 'Screen readers only hear the state in controlled mode.',
    reply: 'Fixed, both branches set it now.',
  },
  {
    id: 'docs',
    title: 'Docs example still uses onClick',
    path: 'docs/button.mdx',
    by: { bot: 'codehopper' },
    said: 'The example passes `onClick`, which no longer toggles. Use `onChange`.',
    reply: 'Updated the example.',
  },
];

const SETTLED = 2;

export function DigestScene() {
  const [resolved, setResolved] = useState<ReadonlySet<string>>(() => new Set(['docs']));
  const [roundOpen, setRoundOpen] = useState(true);
  const [settledOpen, setSettledOpen] = useState(false);
  const [thread, setThread] = useState<string | null>('default');
  const open = THREADS.filter((entry) => !resolved.has(entry.id));
  const done = SETTLED + resolved.size;
  const total = SETTLED + THREADS.length;

  return (
    <PrWindow tab="conversation">
      <div className="m-3">
        <div className="rounded-lg border text-xs">
          <div className={CARD_HEAD}>
            <span className="font-semibold">Geld</span>
            <Meter done={done} total={total} />
            <span className="min-w-0 truncate text-muted-foreground tabular-nums">
              {done}/{total} resolved
            </span>
            {open.length > 0 ? (
              <span className="shrink-0 rounded-full bg-[#9a6700]/12 px-1.5 py-px text-[0.6875rem] font-medium whitespace-nowrap text-[#9a6700] dark:text-[#d29922]">{open.length} need you</span>
            ) : null}
            <GeldRowTools />
          </div>

          <DigestStatusRows resolved={resolved} />

          <GroupBand
            open={roundOpen}
            onToggle={() => {
              setRoundOpen((value) => !value);
              setSettledOpen(false);
            }}
          >
            {open.length > 0 ? '1 round to review' : 'Current round'}
          </GroupBand>
          <Collapsible open={roundOpen}>
            <div className="flex items-center gap-2 border-b px-3 py-1.5 text-[0.8125rem]">
              {open.length === 0 ? <CircleCheckIcon aria-hidden="true" className="size-4 text-addition" /> : <CircleIcon aria-hidden="true" className="size-4 text-muted-foreground" />}
              <span className="flex -space-x-1">
                <BotMark bot="buggy" size={18} className="ring-2 ring-card" />
                <Avatar who="hubot" size={18} />
                <BotMark bot="codehopper" size={18} className="ring-2 ring-card" />
              </span>
              <span className="font-semibold">Round 3</span>
              <Meter done={resolved.size} total={THREADS.length} />
              <span className="text-xs text-muted-foreground tabular-nums">
                {resolved.size}/{THREADS.length}
              </span>
              <span className="ml-auto text-xs text-muted-foreground">2h</span>
            </div>
            <ul className="border-b bg-muted/30">
              {THREADS.map((entry) => (
                <ThreadRow
                  key={entry.id}
                  thread={entry}
                  resolved={resolved.has(entry.id)}
                  open={thread === entry.id}
                  onToggle={() => setThread((current) => (current === entry.id ? null : entry.id))}
                  onResolve={() =>
                    setResolved((previous) => {
                      const next = new Set(previous);
                      if (next.has(entry.id)) next.delete(entry.id);
                      else next.add(entry.id);
                      return next;
                    })
                  }
                />
              ))}
            </ul>
          </Collapsible>
          <GroupBand
            open={settledOpen}
            onToggle={() => {
              setSettledOpen((value) => !value);
              setRoundOpen(false);
            }}
            last
          >
            2 settled rounds
          </GroupBand>
          <Collapsible open={settledOpen}>
            {[2, 1].map((round) => (
              <div key={round} className="flex items-center gap-2 border-t px-3 py-2 text-[0.8125rem]">
                <CircleCheckIcon aria-hidden="true" className="size-4 text-addition" />
                <span className="font-semibold">Round {round}</span>
                <Meter done={1} total={1} />
                <span className="ml-auto text-xs text-muted-foreground">{round === 2 ? 'yesterday' : '2 days ago'}</span>
              </div>
            ))}
          </Collapsible>
        </div>
      </div>
    </PrWindow>
  );
}

/** The digest's status rows, shared with the Flow scene so the two windows' rows read and measure the same. `resolved` is the digest's threads resolved so far. */
export function DigestStatusRows({ resolved }: { readonly resolved: ReadonlySet<string> }) {
  return (
    <>
      <StatusRow label="Reviews">
        <Chip>
          <Avatar who="mona" size={16} className="ring-0" />
          mona
          <CheckIcon aria-hidden="true" className="size-3 text-addition" strokeWidth={3} />
          <span className="sr-only">{' approved'}</span>
        </Chip>
        <Chip>
          <Avatar who="hubot" size={16} className="ring-0" />
          hubot
          <XIcon aria-hidden="true" className="size-3 text-deletion" strokeWidth={3} />
          <span className="sr-only">{' requested changes,'}</span>
          <MessagesSquareIcon aria-hidden="true" className="size-3 text-muted-foreground" />1<span className="sr-only">{' comment'}</span>
        </Chip>
        <span className="text-muted-foreground tabular-nums">1/2 approvals</span>
      </StatusRow>
      <StatusRow label="Review bots">
        <Chip square>
          <BotMark bot="buggy" size={16} />
          Buggy <span className="text-muted-foreground">{resolved.has('default') ? 'resolved' : '1 issue'}</span>
          <Light tone={resolved.has('default') ? 'good' : 'warn'} />
        </Chip>
        <Chip square>
          <BotMark bot="codehopper" size={16} />
          CodeHopper <span className="text-muted-foreground">{resolved.has('docs') ? 'resolved' : '1 issue'}</span>
          <Light tone={resolved.has('docs') ? 'good' : 'warn'} />
        </Chip>
        <Chip square>
          <BotMark bot="gecko" size={16} />
          Gecko <span className="text-muted-foreground">5/5</span>
          <Light tone="good" />
        </Chip>
      </StatusRow>
      <StatusRow label="CI checks">
        <span aria-hidden="true" className="size-3.5 shrink-0 rounded-full border-[3px] border-addition" />
        <span>18 successful checks</span>
        <span className="text-muted-foreground">·</span>
        <RocketIcon aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
        <span>1 preview ready</span>
      </StatusRow>
    </>
  );
}

function StatusRow({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <div className="flex min-h-8 items-center gap-3 border-b px-3 py-1 last:border-b-0">
      <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
      <div className="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap">{children}</div>
    </div>
  );
}

export function Light({ tone }: { readonly tone: 'good' | 'warn' | 'bad' | 'idle' }) {
  if (tone === 'good') return <CheckIcon aria-hidden="true" className="size-3 text-addition" strokeWidth={3} />;
  if (tone === 'bad') return <XIcon aria-hidden="true" className="size-3 text-deletion" strokeWidth={3} />;
  return <span aria-hidden="true" className={cn('size-2 rounded-full', tone === 'warn' ? 'bg-[#bf8700]' : 'bg-muted-foreground/50')} />;
}

function GroupBand({ open, onToggle, children, last = false }: { readonly open: boolean; readonly onToggle: () => void; readonly children: React.ReactNode; readonly last?: boolean }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className={cn('flex w-full items-center gap-1.5 bg-muted/70 px-3 py-1 text-left text-[0.75rem] font-semibold outline-none hover:bg-muted focus-visible:bg-muted', !last && 'border-b', last && 'rounded-b-lg')}
    >
      <ChevronDownIcon aria-hidden="true" className={cn('size-3.5 text-muted-foreground transition-transform', !open && '-rotate-90')} />
      {children}
    </button>
  );
}

function Collapsible({ open, children }: { readonly open: boolean; readonly children: React.ReactNode }) {
  return (
    <div className={cn('grid transition-[grid-template-rows] duration-300 ease-out', open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
      <div className="overflow-hidden" inert={!open}>
        {children}
      </div>
    </div>
  );
}

function ThreadRow({
  thread,
  resolved,
  open,
  onToggle,
  onResolve,
}: {
  readonly thread: Thread;
  readonly resolved: boolean;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly onResolve: () => void;
}) {
  const author = 'bot' in thread.by ? <BotMark bot={thread.by.bot} size={16} /> : <Avatar who={thread.by.person} size={16} className="ring-0" />;
  return (
    <li className="border-t first:border-t-0">
      <button type="button" aria-expanded={open} onClick={onToggle} className={cn('flex w-full items-center gap-2 py-1.5 pr-3 pl-6 text-left outline-none hover:bg-muted/60 focus-visible:bg-muted', open && 'border-b')}>
        {resolved ? <CircleCheckIcon aria-hidden="true" className="size-3.5 shrink-0 text-addition" /> : <CircleIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />}
        {author}
        <span className={cn('min-w-0 truncate font-medium', resolved && 'text-muted-foreground')}>{thread.title}</span>
        <span className="shrink-0 font-mono text-[0.6875rem] text-muted-foreground max-sm:hidden">{thread.path}</span>
        <ChevronRightIcon aria-hidden="true" className={cn('ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
      </button>
      <Collapsible open={open}>
        <div className="flex flex-col gap-1.5 py-1.5 pr-3 pl-6">
          <div className="flex items-start gap-2">
            {author}
            <p className="max-w-[85%] rounded-xl rounded-tl-sm border bg-card px-2.5 py-1 leading-5">{formatInline(thread.said)}</p>
          </div>
          <div className="flex items-start justify-end gap-2">
            <p className="max-w-[85%] rounded-xl rounded-tr-sm bg-[oklch(0.62_0.15_255/0.14)] px-2.5 py-1 leading-5">{thread.reply}</p>
            <Avatar who="octocat" size={16} className="ring-0" />
          </div>
          <div className="flex items-center justify-end gap-2">
            <span className="flex-1 rounded-md border bg-card px-2 py-0.5 text-muted-foreground">Reply…</span>
            <Ping on={open} className="inline-flex rounded-md">
              <button
                type="button"
                onClick={onResolve}
                className="rounded-md border bg-card px-2 py-0.5 font-medium outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/40"
              >
                {resolved ? 'Unresolve' : 'Resolve conversation'}
              </button>
            </Ping>
          </div>
        </div>
      </Collapsible>
    </li>
  );
}

/** Backticks as code, the one bit of Markdown the sample comments use. */
function formatInline(text: string): React.ReactNode {
  return text.split(/(`[^`]+`)/).map((part, index) =>
    part.startsWith('`') ? (
      <code key={index} className="rounded bg-muted px-1 font-mono text-[0.6875rem]">
        {part.slice(1, -1)}
      </code>
    ) : (
      part
    ),
  );
}
