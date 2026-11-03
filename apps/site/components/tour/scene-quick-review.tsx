'use client';

import { cn } from 'cn';
import { CheckIcon, CircleCheckIcon, FileCodeIcon, GitCommitHorizontalIcon, MessageSquareIcon, XIcon } from 'lucide-react';
import { useState } from 'react';

import { Avatar } from '@/components/tour/bits';
import type { PrTab } from '@/components/tour/pr-window';
import { PrWindow } from '@/components/tour/pr-window';
import { useInstantKey } from '@/components/tour/use-instant-key';

type Verdict = 'approve' | 'changes' | 'comment';

const VERDICT: Record<Verdict, { readonly label: string; readonly done: string; readonly submit: string }> = {
  approve: { label: 'Approve', done: 'Approved', submit: 'bg-[#1f883d] text-white' },
  changes: { label: 'Request changes', done: 'Changes requested', submit: 'bg-[#cf222e] text-white' },
  comment: { label: 'Comment', done: 'Review submitted', submit: 'border bg-muted text-foreground' },
};

const TAB_BODY: Record<PrTab, readonly { readonly icon: React.ReactNode; readonly text: string }[]> = {
  conversation: [
    { icon: <Avatar who="octocat" size={18} />, text: 'octocat opened this pull request' },
    { icon: <Avatar who="mona" size={18} />, text: 'mona approved these changes' },
    { icon: <Avatar who="hubot" size={18} />, text: 'hubot left 2 comments' },
    { icon: <Avatar who="octocat" size={18} />, text: 'octocat pushed 2 commits' },
    { icon: <Avatar who="mona" size={18} />, text: 'mona resolved a conversation' },
  ],
  commits: [
    { icon: <GitCommitHorizontalIcon aria-hidden="true" className="size-4 text-muted-foreground" />, text: 'Add pressed and onChange to Button' },
    { icon: <GitCommitHorizontalIcon aria-hidden="true" className="size-4 text-muted-foreground" />, text: 'Move toggle state into useToggle' },
    { icon: <GitCommitHorizontalIcon aria-hidden="true" className="size-4 text-muted-foreground" />, text: 'Warn when defaultPressed meets pressed' },
    { icon: <GitCommitHorizontalIcon aria-hidden="true" className="size-4 text-muted-foreground" />, text: 'Document the controlled mode' },
  ],
  checks: [
    { icon: <CircleCheckIcon aria-hidden="true" className="size-4 text-addition" />, text: 'CI / test (pull_request)' },
    { icon: <CircleCheckIcon aria-hidden="true" className="size-4 text-addition" />, text: 'CI / lint (pull_request)' },
    { icon: <CircleCheckIcon aria-hidden="true" className="size-4 text-addition" />, text: 'Vercel · widgets-docs' },
    { icon: <CircleCheckIcon aria-hidden="true" className="size-4 text-addition" />, text: 'Cursor Bugbot' },
    { icon: <CircleCheckIcon aria-hidden="true" className="size-4 text-addition" />, text: 'CodeRabbit' },
  ],
  files: [
    { icon: <FileCodeIcon aria-hidden="true" className="size-4 text-muted-foreground" />, text: 'src/Button.tsx' },
    { icon: <FileCodeIcon aria-hidden="true" className="size-4 text-muted-foreground" />, text: 'src/hooks/useToggle.ts' },
    { icon: <FileCodeIcon aria-hidden="true" className="size-4 text-muted-foreground" />, text: 'src/index.ts' },
    { icon: <FileCodeIcon aria-hidden="true" className="size-4 text-muted-foreground" />, text: 'src/types.ts' },
  ],
};

export function QuickReviewScene() {
  const [tab, setTab] = useState<PrTab>('checks');
  const [box, setBox] = useState<Verdict | null>(null);
  const [words, setWords] = useState('');
  const [mine, setMine] = useState<Verdict | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const instant = useInstantKey();

  const send = (verdict: Verdict): void => {
    setMine(verdict === 'comment' ? mine : verdict);
    setSaid(VERDICT[verdict].done);
    setBox(null);
    setWords('');
  };

  const press = (verdict: Verdict, event: React.MouseEvent): void => {
    if ((event.metaKey || event.ctrlKey) && verdict !== 'comment') send(verdict);
    else setBox((current) => (current === verdict ? null : verdict));
  };

  const approvals = 1 + (mine === 'approve' ? 1 : 0);
  const requests = mine === 'changes' ? 1 : 0;

  return (
    <PrWindow
      tab={tab}
      onTab={setTab}
      tabsEnd={
        <>
          <span className="hidden items-center gap-1.5 text-xs text-muted-foreground tabular-nums sm:inline-flex" aria-label={`${approvals} approvals, ${requests} requests for changes`}>
            {approvals}
            <CheckIcon aria-hidden="true" className="size-3.5 text-addition" strokeWidth={2.5} />
            {requests > 0 ? (
              <>
                {requests}
                <XIcon aria-hidden="true" className="size-3.5 text-deletion" strokeWidth={2.5} />
              </>
            ) : null}
            1
            <MessageSquareIcon aria-hidden="true" className="size-3.5" />
          </span>
          <span className="inline-flex overflow-hidden rounded-md border shadow-xs" role="group" aria-label="Review">
            <Segment label="Approve" pressed={box === 'approve'} current={mine === 'approve'} onClick={(event) => press('approve', event)} tone="good" instant={instant}>
              <CheckIcon aria-hidden="true" className="size-4" strokeWidth={2.25} />
            </Segment>
            <Segment label="Request changes" pressed={box === 'changes'} current={mine === 'changes'} onClick={(event) => press('changes', event)} tone="bad" instant={instant}>
              <XIcon aria-hidden="true" className="size-4" strokeWidth={2.25} />
            </Segment>
            <Segment label="Comment" pressed={box === 'comment'} current={false} onClick={(event) => press('comment', event)} tone="plain" instant={false}>
              <MessageSquareIcon aria-hidden="true" className="size-4" />
            </Segment>
          </span>
        </>
      }
      bodyClassName="relative min-h-80"
    >
      <ul className="flex flex-col gap-3 p-4 text-[0.8125rem]">
        {TAB_BODY[tab].map((row) => (
          <li key={row.text} className="flex items-center gap-2.5">
            {row.icon}
            <span className="min-w-0 truncate">{row.text}</span>
          </li>
        ))}
      </ul>
      <p className="px-4 text-xs text-muted-foreground" aria-live="polite">
        {said ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border bg-muted/60 px-2 py-0.5 font-medium text-foreground">
            <CheckIcon aria-hidden="true" className="size-3 text-addition" strokeWidth={3} />
            {said}
          </span>
        ) : (
          'Switch tabs: the review group stays put.'
        )}
      </p>

      <div
        className={cn(
          'absolute top-2 right-2 z-10 w-72 max-w-[calc(100%-1rem)] origin-top-right rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-xl transition-[opacity,transform] duration-200',
          box ? 'scale-100 opacity-100' : 'pointer-events-none scale-95 opacity-0',
        )}
        inert={box === null}
      >
        <textarea
          value={words}
          onChange={(event) => setWords(event.target.value)}
          placeholder="Leave a comment"
          aria-label="Comment"
          rows={3}
          className="w-full resize-none rounded-md border bg-background px-2 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        />
        <div className="mt-1 flex justify-end gap-1.5">
          <button type="button" onClick={() => setBox(null)} className="h-6 rounded-md px-2 text-xs font-medium hover:bg-muted">
            Cancel
          </button>
          <button
            type="button"
            disabled={box !== 'approve' && words.trim() === ''}
            onClick={() => box && send(box)}
            className={cn('h-6 rounded-md px-2.5 text-xs font-medium transition-opacity disabled:opacity-50', box ? VERDICT[box].submit : '')}
          >
            {box ? VERDICT[box].label : 'Send'}
          </button>
        </div>
      </div>
    </PrWindow>
  );
}

function Segment({
  label,
  pressed,
  current,
  onClick,
  tone,
  instant,
  children,
}: {
  readonly label: string;
  readonly pressed: boolean;
  readonly current: boolean;
  readonly onClick: (event: React.MouseEvent) => void;
  readonly tone: 'good' | 'bad' | 'plain';
  readonly instant: boolean;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={current ? `${label} (your current review)` : label}
      aria-expanded={pressed}
      title={tone === 'plain' ? label : `${label}\n⌘ 1-click review`}
      onClick={onClick}
      className={cn(
        'relative grid h-7 w-8 place-items-center bg-card outline-none not-first:border-l focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring/60',
        tone === 'good' && 'text-addition hover:bg-addition-muted',
        tone === 'bad' && 'text-deletion hover:bg-deletion-muted',
        tone === 'plain' && 'hover:bg-muted',
        (pressed || current) && 'bg-muted shadow-[inset_0_1px_2px_rgb(0_0_0/0.15)]',
      )}
    >
      {children}
      {instant ? <span aria-hidden="true" className="absolute right-0.5 bottom-0.5 text-[0.5rem] leading-none font-bold">↗</span> : null}
    </button>
  );
}
