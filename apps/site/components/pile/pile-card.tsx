import { formatCount } from '@geld/core';
import { cn } from 'cn';
import { BotIcon, ChartNoAxesColumnIcon, CheckIcon, CircleCheckIcon, CircleXIcon, FileCodeIcon, FileDiffIcon, LoaderCircleIcon, MessageSquareIcon, RocketIcon, ShieldAlertIcon } from 'lucide-react';

import type { PileItem, Person } from '@/lib/pile-items';
import { setAsideAs } from '@/lib/pile-items';

const PEOPLE: Record<Person, string> = {
  mona: 'bg-[oklch(0.72_0.14_330)]',
  hubot: 'bg-[oklch(0.74_0.13_70)]',
  octocat: 'bg-[oklch(0.68_0.12_250)]',
  nadia: 'bg-[oklch(0.68_0.12_160)]',
};

export function Face({ who, size = 22, className }: { readonly who: Person; readonly size?: number; readonly className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-grid shrink-0 place-items-center rounded-full font-semibold text-white uppercase ring-2 ring-card', PEOPLE[who], className)}
      style={{ width: size, height: size, fontSize: size * 0.46 }}
    >
      {who[0]}
    </span>
  );
}

/** The made-up agent reviewer's mark: a cut-corner square holding a spark, so no real bot is implied. */
export function AgentMark({ size = 22, className }: { readonly size?: number; readonly className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" className={cn('shrink-0', className)}>
      <path d="M7 2H22V17L17 22H2V7Z" className="fill-foreground" />
      <path d="M12 6.5L13.4 10.6L17.5 12L13.4 13.4L12 17.5L10.6 13.4L6.5 12L10.6 10.6Z" className="fill-background" />
    </svg>
  );
}

/** One thing a pull request asks of its reviewer, as it lands on the pile. */
export function PileCard({ item }: { readonly item: PileItem }) {
  switch (item.kind) {
    case 'file': {
      const aside = setAsideAs(item.path);
      return (
        <Shell>
          <FileCodeIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <span className={cn('font-mono text-[0.6875rem]', aside && 'text-muted-foreground')}>{item.path.split('/').pop()}</span>
          {aside ? (
            <span className="rounded-sm border px-1.5 text-[0.6875rem] text-muted-foreground">{aside.shortNoun}</span>
          ) : (
            <span className="font-mono text-[0.75rem] font-semibold tabular-nums">
              <span className="text-addition">+{formatCount(item.additions)}</span> <span className="text-deletion">&minus;{formatCount(item.deletions)}</span>
            </span>
          )}
        </Shell>
      );
    }
    case 'comment':
      return (
        <Shell tall>
          <Face who={item.who} />
          <span className="flex w-[8.5rem] flex-col whitespace-normal">
            <span className="flex items-center gap-1 text-[0.75rem] font-semibold">
              {item.who}
              <MessageSquareIcon aria-hidden="true" className="size-3 text-muted-foreground" />
            </span>
            <span className="leading-snug">{item.text}</span>
          </span>
        </Shell>
      );
    case 'bot':
      return (
        <Shell tall>
          <span className="grid size-[22px] shrink-0 place-items-center rounded-[5px] bg-muted text-muted-foreground">
            <BotIcon aria-hidden="true" className="size-3.5" />
          </span>
          <span className="flex w-[8.5rem] flex-col whitespace-normal">
            <span className="text-[0.75rem] font-semibold">{item.name}</span>
            <span className="leading-snug text-muted-foreground">{item.text}</span>
          </span>
        </Shell>
      );
    case 'agent':
      return (
        <Shell tall>
          <AgentMark />
          <span className="flex flex-col">
            <span className="text-[0.75rem] font-semibold">Agent review</span>
            <span className="text-muted-foreground">
              <span className="font-semibold text-foreground tabular-nums">{item.score}/5</span> · {item.findings} findings
            </span>
          </span>
        </Shell>
      );
    case 'check':
      return (
        <Shell>
          {item.state === 'passed' ? (
            <CircleCheckIcon aria-hidden="true" className="size-4 text-addition" />
          ) : item.state === 'failed' ? (
            <CircleXIcon aria-hidden="true" className="size-4 text-deletion" />
          ) : (
            <LoaderCircleIcon aria-hidden="true" className="size-4 text-[oklch(0.7_0.14_75)]" />
          )}
          <span className="font-mono text-[0.75rem]">{item.name}</span>
          <span className="text-muted-foreground">{item.state}</span>
        </Shell>
      );
    case 'preview':
      return (
        <Shell>
          <RocketIcon aria-hidden="true" className="size-4 text-muted-foreground" />
          <span className="font-semibold">Preview ready</span>
        </Shell>
      );
    case 'security':
      return (
        <Shell>
          <ShieldAlertIcon aria-hidden="true" className="size-4 text-deletion" />
          <span>{item.text}</span>
        </Shell>
      );
    case 'coverage':
      return (
        <Shell>
          <ChartNoAxesColumnIcon aria-hidden="true" className="size-4 text-muted-foreground" />
          <span>{item.percent}%</span>
          <span className="font-semibold text-deletion tabular-nums">{item.change}%</span>
        </Shell>
      );
    case 'review':
      return (
        <Shell>
          <Face who={item.who} />
          <span>
            <span className="font-semibold">{item.who}</span> {item.verdict === 'approved' ? 'approved' : 'wants changes'}
          </span>
          {item.verdict === 'approved' ? (
            <CheckIcon aria-hidden="true" className="size-4 text-addition" strokeWidth={2.5} />
          ) : (
            <FileDiffIcon aria-hidden="true" className="size-4 text-deletion" />
          )}
        </Shell>
      );
  }
}

function Shell({ children, tall = false }: { readonly children: React.ReactNode; readonly tall?: boolean }) {
  return <span className={cn('flex items-center gap-2 px-2.5 text-[0.75rem] whitespace-nowrap', tall ? 'py-2' : 'h-9')}>{children}</span>;
}
