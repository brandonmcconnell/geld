import type { ChangeTotals } from '@geld/core';
import { formatCount } from '@geld/core';
import { cn } from 'cn';

/** GitHub's `+93 −53` with the five little blocks. */
export function Diffstat({ totals, className, blocks = true }: { readonly totals: ChangeTotals; readonly className?: string; readonly blocks?: boolean }) {
  const total = totals.additions + totals.deletions;
  const green = total === 0 ? 0 : Math.round((totals.additions / total) * 5);
  const red = total === 0 ? 0 : 5 - green;
  return (
    <span className={cn('inline-flex items-center gap-1.5 font-mono text-[0.8125rem] tabular-nums', className)}>
      <span className="text-addition">+{formatCount(totals.additions)}</span>
      <span className="text-deletion">&minus;{formatCount(totals.deletions)}</span>
      {blocks ? (
        <span aria-hidden="true" className="ml-0.5 inline-flex gap-px">
          {Array.from({ length: 5 }, (_, index) => (
            <span
              key={index}
              className={cn('size-2 rounded-[1px]', index < green ? 'bg-addition' : index < green + red ? 'bg-deletion' : 'bg-neutral-block')}
            />
          ))}
        </span>
      ) : null}
    </span>
  );
}
