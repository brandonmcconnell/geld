import { formatCount } from '@geld/core';
import { cn } from 'cn';
import { BotIcon, CircleCheckIcon, CircleXIcon, FileDiffIcon, GitPullRequestIcon, LoaderCircleIcon, MessageSquareIcon, RocketIcon, ShieldAlertIcon, UsersIcon } from 'lucide-react';
import type { Ref } from 'react';

import type { Digest, DigestRow, Person } from '@/lib/pile-items';

import { AgentMark, Face } from './pile-card';

const LABEL: Record<DigestRow, string> = {
  changes: 'Changes',
  reviews: 'Reviews',
  comments: 'Comments',
  agent: 'Agent review',
  checks: 'Checks',
  preview: 'Preview',
  security: 'Reports',
};

/**
 * What Geld makes of the pile: one card with a line per kind of thing that
 * landed, each line filling in as its items are gathered into it. Lines with
 * nothing gathered yet stand dimmed in place, so the card never jumps.
 */
export function DigestCard({
  digest,
  rows,
  open,
  rowRef,
  cardRef,
  width,
  compact,
  maxHeight,
}: {
  readonly digest: Digest;
  readonly rows: readonly DigestRow[];
  readonly open: boolean;
  readonly rowRef: (row: DigestRow) => (el: HTMLElement | null) => void;
  readonly cardRef: Ref<HTMLDivElement>;
  readonly width: number;
  /** Too little room for a line each: every line becomes a chip, and the chips wrap. */
  readonly compact: boolean;
  /** The room it has; never more, so it never covers the hero's words. */
  readonly maxHeight: number;
}) {
  return (
    <div
      ref={cardRef}
      style={{ width, maxHeight }}
      className={cn(
        'pointer-events-auto flex origin-bottom-right flex-col overflow-hidden rounded-xl border bg-card text-[0.8125rem] shadow-xl transition-[opacity,scale] duration-300',
        open ? 'scale-100 opacity-100' : 'pointer-events-none scale-95 opacity-0',
      )}
    >
      {!compact && (
        <div className="flex items-center gap-2 px-4 pt-3 pb-2.5">
          <GitPullRequestIcon aria-hidden="true" className="size-4 shrink-0 text-addition" />
          <span className="min-w-0 truncate font-semibold">Add a controlled mode to Button</span>
          <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">#128</span>
        </div>
      )}
      {compact ? (
        <div className="flex flex-1 flex-wrap content-start gap-1.5 p-2">
          {rows.map((row) => (
            <span
              key={row}
              ref={rowRef(row)}
              aria-label={LABEL[row]}
              className={cn('inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[0.75rem] whitespace-nowrap tabular-nums transition-opacity duration-300', !filled(digest, row) && 'opacity-30')}
            >
              <ChipValue digest={digest} row={row} />
            </span>
          ))}
        </div>
      ) : (
        rows.map((row) => (
          <div key={row} ref={rowRef(row)} className={cn('flex min-h-11 flex-1 items-center gap-3 border-t px-4 py-2 transition-opacity duration-300', !filled(digest, row) && 'opacity-30')}>
            <span className="w-[5.5rem] shrink-0 text-[0.75rem] text-muted-foreground">{LABEL[row]}</span>
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <RowValue digest={digest} row={row} />
            </span>
          </div>
        ))
      )}
    </div>
  );
}

function filled(digest: Digest, row: DigestRow): boolean {
  switch (row) {
    case 'changes':
      return digest.files.length + digest.setAside > 0;
    case 'reviews':
      return digest.reviews.approved.length + digest.reviews.changes.length > 0;
    case 'comments':
      return digest.comments + digest.botComments > 0;
    case 'agent':
      return digest.agent !== null;
    case 'checks':
      return digest.checks.passed + digest.checks.failed + digest.checks.running > 0;
    case 'preview':
      return digest.previews > 0;
    case 'security':
      return digest.security.length > 0;
  }
}

function RowValue({ digest, row }: { readonly digest: Digest; readonly row: DigestRow }) {
  switch (row) {
    case 'changes': {
      const additions = digest.files.reduce((sum, file) => sum + file.additions, 0);
      const deletions = digest.files.reduce((sum, file) => sum + file.deletions, 0);
      return (
        <span className="flex min-w-0 flex-col">
          <span className="flex items-center gap-2">
            <FileDiffIcon aria-hidden="true" className="size-4 shrink-0" />
            <span className="font-semibold tabular-nums">
              {digest.files.length} {digest.files.length === 1 ? 'file' : 'files'} to review
            </span>
            <span className="font-mono text-[0.75rem] font-semibold tabular-nums">
              <span className="text-addition">+{formatCount(additions)}</span> <span className="text-deletion">&minus;{formatCount(deletions)}</span>
            </span>
          </span>
          {digest.setAside > 0 && <span className="text-[0.75rem] text-muted-foreground tabular-nums">{digest.setAside} set aside · tests, generated, docs</span>}
        </span>
      );
    }
    case 'reviews':
      return (
        <>
          <Stack people={[...digest.reviews.approved, ...digest.reviews.changes]} fallback={<UsersIcon aria-hidden="true" className="size-4" />} />
          <span className="flex flex-wrap items-center gap-x-2 tabular-nums">
            {digest.reviews.approved.length > 0 && (
              <span className="inline-flex items-center gap-1">
                <CircleCheckIcon aria-hidden="true" className="size-3.5 text-addition" />
                {digest.reviews.approved.length} approved
              </span>
            )}
            {digest.reviews.changes.length > 0 && (
              <span className="inline-flex items-center gap-1">
                <CircleXIcon aria-hidden="true" className="size-3.5 text-deletion" />
                {digest.reviews.changes.length} changes requested
              </span>
            )}
          </span>
        </>
      );
    case 'comments':
      return (
        <>
          <Stack people={digest.commenters} fallback={<MessageSquareIcon aria-hidden="true" className="size-4" />} />
          <span className="flex min-w-0 flex-col tabular-nums">
            <span>
              <span className="font-semibold">{digest.comments}</span> {digest.comments === 1 ? 'comment' : 'comments'}
              {digest.needsYou > 0 && <span className="ml-1.5 rounded-full bg-foreground px-1.5 py-px text-[0.6875rem] font-semibold text-background">{digest.needsYou} for you</span>}
            </span>
            {digest.botComments > 0 && (
              <span className="inline-flex items-center gap-1 text-[0.75rem] text-muted-foreground">
                <BotIcon aria-hidden="true" className="size-3" />
                {digest.botComments} bot {digest.botComments === 1 ? 'comment' : 'comments'} folded
              </span>
            )}
          </span>
        </>
      );
    case 'agent':
      return (
        <>
          <AgentMark size={18} />
          {digest.agent ? (
            <span className="tabular-nums">
              <span className="font-semibold">{digest.agent.score}/5</span> · {digest.agent.findings} findings
            </span>
          ) : (
            <span>Waiting</span>
          )}
        </>
      );
    case 'checks': {
      const { passed, failed, running } = digest.checks;
      return (
        <span className="flex flex-wrap items-center gap-x-2.5 tabular-nums">
          {passed > 0 && (
            <span className="inline-flex items-center gap-1">
              <CircleCheckIcon aria-hidden="true" className="size-3.5 text-addition" />
              {passed} passed
            </span>
          )}
          {failed > 0 && (
            <span className="inline-flex items-center gap-1">
              <CircleXIcon aria-hidden="true" className="size-3.5 text-deletion" />
              {failed} failed
            </span>
          )}
          {running > 0 && (
            <span className="inline-flex items-center gap-1">
              <LoaderCircleIcon aria-hidden="true" className="size-3.5 text-[oklch(0.7_0.14_75)]" />
              {running} running
            </span>
          )}
          {passed + failed + running === 0 && <span>Waiting</span>}
        </span>
      );
    }
    case 'preview':
      return (
        <>
          <RocketIcon aria-hidden="true" className="size-4 shrink-0" />
          <span className="tabular-nums">{digest.previews > 0 ? `${digest.previews} ready` : 'None yet'}</span>
        </>
      );
    case 'security':
      return (
        <>
          <ShieldAlertIcon aria-hidden="true" className={cn('size-4 shrink-0', digest.security.length > 0 && 'text-deletion')} />
          <span className="min-w-0 truncate">{digest.security[0] ?? 'None yet'}</span>
          {digest.security.length > 1 && <span className="shrink-0 text-muted-foreground tabular-nums">+{digest.security.length - 1}</span>}
        </>
      );
  }
}

function ChipValue({ digest, row }: { readonly digest: Digest; readonly row: DigestRow }) {
  switch (row) {
    case 'changes':
      return (
        <>
          <FileDiffIcon aria-hidden="true" className="size-3.5" />
          <span className="font-semibold">
            {digest.files.length} to review
          </span>
          {digest.setAside > 0 && <span className="text-muted-foreground">· {digest.setAside} aside</span>}
        </>
      );
    case 'reviews':
      return (
        <>
          <Stack people={[...digest.reviews.approved, ...digest.reviews.changes]} size={16} fallback={<UsersIcon aria-hidden="true" className="size-3.5" />} />
          {digest.reviews.approved.length > 0 && <CircleCheckIcon aria-hidden="true" className="size-3.5 text-addition" />}
          {digest.reviews.changes.length > 0 && <CircleXIcon aria-hidden="true" className="size-3.5 text-deletion" />}
        </>
      );
    case 'comments':
      return (
        <>
          <Stack people={digest.commenters} size={16} fallback={<MessageSquareIcon aria-hidden="true" className="size-3.5" />} />
          <span>
            {digest.comments} {digest.comments === 1 ? 'comment' : 'comments'}
          </span>
        </>
      );
    case 'agent':
      return (
        <>
          <AgentMark size={14} />
          <span className="font-semibold">{digest.agent ? `${digest.agent.score}/5` : '–'}</span>
        </>
      );
    case 'checks':
      return (
        <>
          {digest.checks.passed > 0 && <CircleCheckIcon aria-hidden="true" className="size-3.5 text-addition" />}
          {digest.checks.passed > 0 && digest.checks.passed}
          {digest.checks.failed > 0 && <CircleXIcon aria-hidden="true" className="size-3.5 text-deletion" />}
          {digest.checks.failed > 0 && digest.checks.failed}
          {digest.checks.passed + digest.checks.failed === 0 && <LoaderCircleIcon aria-hidden="true" className="size-3.5" />}
        </>
      );
    case 'preview':
      return (
        <>
          <RocketIcon aria-hidden="true" className="size-3.5" />
          {digest.previews > 0 ? 'Ready' : 'None'}
        </>
      );
    case 'security':
      return (
        <>
          <ShieldAlertIcon aria-hidden="true" className={cn('size-3.5', digest.security.length > 0 && 'text-deletion')} />
          {digest.security.length}
        </>
      );
  }
}

function Stack({ people, fallback, size = 20 }: { readonly people: readonly Person[]; readonly fallback: React.ReactNode; readonly size?: number }) {
  if (people.length === 0) return <span className="grid shrink-0 place-items-center text-muted-foreground">{fallback}</span>;
  return (
    <span className="flex shrink-0 -space-x-1.5">
      {people.map((who) => (
        <Face key={who} who={who} size={size} />
      ))}
    </span>
  );
}
