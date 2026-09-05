import type { ChangeTotals } from '@geld/core';
import { formatCount, formatDiffstat, pluralize } from '@geld/core';
import { GitPullRequestIcon, MessageSquareIcon } from 'lucide-react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface PrListRowProps {
  readonly number: number;
  readonly title: string;
  readonly author: string;
  readonly when: string;
  readonly comments: number;
  readonly shown: ChangeTotals;
  readonly hidden: ChangeTotals;
  readonly all: ChangeTotals;
  readonly noun: string;
  readonly nounPlural: string;
}

/** A pull request list row with Geld's `N tests +A −D` chip. */
export function PrListRow({ number, title, author, when, comments, shown, hidden, all, noun, nounPlural }: PrListRowProps) {
  return (
    <div className="flex items-start gap-3 px-4 py-3 text-sm not-last:border-b">
      <GitPullRequestIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-addition" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          #{number} opened {when} by {author}
        </p>
      </div>
      <Tooltip>
        <TooltipTrigger className="inline-flex shrink-0 items-center gap-1.5 rounded-md border bg-muted/40 px-1.5 py-0.5 font-mono text-xs tabular-nums outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/40">
          <span className="text-muted-foreground">{pluralize(hidden.files, noun, nounPlural)}</span>
          <span className="text-addition">+{formatCount(shown.additions)}</span>
          <span className="text-deletion">&minus;{formatCount(shown.deletions)}</span>
        </TooltipTrigger>
        <TooltipContent className="font-mono text-xs tabular-nums">
          <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1">
            <dt className="text-muted-foreground">Excluding {nounPlural}</dt>
            <dd>{formatDiffstat(shown)}</dd>
            <dt className="text-muted-foreground">Including {nounPlural}</dt>
            <dd>{formatDiffstat(all)}</dd>
            <dt className="text-muted-foreground">{nounPlural} only</dt>
            <dd>{formatDiffstat(hidden)}</dd>
          </dl>
        </TooltipContent>
      </Tooltip>
      <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
        <MessageSquareIcon aria-hidden="true" className="size-3.5" />
        {comments}
      </span>
    </div>
  );
}
