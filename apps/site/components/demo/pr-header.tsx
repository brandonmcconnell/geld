import type { ChangeTotals } from '@geld/core';
import { formatCount, formatDiffstat, pluralize } from '@geld/core';
import { cn } from 'cn';

import { Diffstat } from '@/components/demo/diffstat';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface PrHeaderProps {
  /** Header numbers as GitHub prints them. */
  readonly shown: ChangeTotals;
  /** When set, the header is rendered the way Geld rewrites it. */
  readonly geld?: {
    readonly hidden: ChangeTotals;
    readonly all: ChangeTotals;
    readonly noun: string;
    readonly nounPlural: string;
  };
  readonly className?: string;
}

/** A trimmed-down GitHub pull request header: tab strip plus diffstat. */
export function PrHeader({ shown, geld, className }: PrHeaderProps) {
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-4 pt-2 text-sm', className)}>
      <ul className="-mb-px flex min-w-0 items-end gap-1 text-[0.8125rem] text-muted-foreground" aria-label="Pull request tabs">
        <Tab secondary>Conversation</Tab>
        <Tab count={4} secondary>
          Commits
        </Tab>
        <Tab count={2} secondary>
          Checks
        </Tab>
        <Tab count={shown.files} active>
          Files changed
        </Tab>
      </ul>
      <div className="flex items-center gap-2 pb-2">
        {geld ? (
          <Tooltip>
            <TooltipTrigger
              // A dotted bottom border rather than text-decoration: it follows the theme tokens in every browser.
              className="rounded-none border-b border-dotted border-muted-foreground/50 px-0.5 font-mono text-[0.8125rem] text-muted-foreground outline-none transition-colors hover:border-foreground/60 hover:text-foreground focus-visible:rounded-md focus-visible:ring-3 focus-visible:ring-ring/40"
              aria-label={`${pluralize(geld.hidden.files, geld.noun, geld.nounPlural)} hidden. Hover for the full breakdown.`}
            >
              {formatCount(geld.hidden.files)} {geld.hidden.files === 1 ? geld.noun : geld.nounPlural}
            </TooltipTrigger>
            <TooltipContent className="p-0">
              <Breakdown label={`Excluding ${geld.nounPlural}`} totals={shown} />
              <Breakdown label={`Including ${geld.nounPlural}`} totals={geld.all} />
              <Breakdown label={`${geld.nounPlural[0]?.toUpperCase() ?? ''}${geld.nounPlural.slice(1)} only`} totals={geld.hidden} />
            </TooltipContent>
          </Tooltip>
        ) : null}
        <Diffstat totals={shown} />
      </div>
    </div>
  );
}

function Tab({
  children,
  count,
  active,
  secondary,
}: {
  readonly children: React.ReactNode;
  readonly count?: number;
  readonly active?: boolean;
  /** Tabs that are only decoration; dropped on narrow screens to keep the header on one line. */
  readonly secondary?: boolean;
}) {
  return (
    <li
      className={cn(
        'flex items-center gap-1.5 rounded-t-md border-b-2 px-2.5 py-2 whitespace-nowrap',
        active === true ? 'border-foreground font-medium text-foreground' : 'border-transparent',
        secondary === true && 'hidden sm:flex',
      )}
      aria-current={active === true ? 'page' : undefined}
    >
      {children}
      {count !== undefined ? (
        <span className="rounded-full bg-muted px-1.5 py-px font-mono text-[0.6875rem] tabular-nums text-muted-foreground ring-1 ring-border ring-inset">
          {formatCount(count)}
        </span>
      ) : null}
    </li>
  );
}

function Breakdown({ label, totals }: { readonly label: string; readonly totals: ChangeTotals }) {
  return (
    <div className="flex items-center justify-between gap-6 px-3 py-1.5 text-xs not-last:border-b">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums">
        {pluralize(totals.files, 'file', 'files')} · {formatDiffstat(totals)}
      </span>
    </div>
  );
}
