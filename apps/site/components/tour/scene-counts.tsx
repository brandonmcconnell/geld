'use client';

import type { ChangeTotals, CategoryId } from '@geld/core';
import { categoryById, formatCount, formatDiffstat, pluralize, subtractTotals } from '@geld/core';
import { cn } from 'cn';
import { GitPullRequestIcon } from 'lucide-react';
import { useState } from 'react';

import { Diffstat } from '@/components/demo/diffstat';
import { totalsOf } from '@/components/tour/data';
import { PrWindow } from '@/components/tour/pr-window';
import { hiddenLabel, TOGGLES, useClassified } from '@/components/tour/scene-noise';
import { Switch } from '@/components/ui/switch';

const ENABLED: ReadonlySet<CategoryId> = new Set<CategoryId>(['tests', 'generated', 'docs']);

const LIST: readonly { readonly number: number; readonly title: string; readonly all: ChangeTotals; readonly hidden: ChangeTotals; readonly label: string }[] = [
  { number: 127, title: 'Fix focus ring on disabled toggles', all: { files: 3, additions: 20, deletions: 6 }, hidden: { files: 1, additions: 9, deletions: 2 }, label: '1 test' },
  { number: 126, title: 'Regenerate the API client', all: { files: 9, additions: 1204, deletions: 811 }, hidden: { files: 8, additions: 1190, deletions: 806 }, label: '8 generated' },
];

export function CountsScene() {
  const [geld, setGeld] = useState(true);
  const files = useClassified(ENABLED);
  const hidden = files.filter((file) => file.category !== null);
  const all = totalsOf(files);
  const shown = subtractTotals(all, totalsOf(hidden));
  const rows = TOGGLES.map((id) => ({ id, totals: totalsOf(hidden.filter((file) => file.category?.id === id)) })).filter((row) => row.totals.files > 0);

  return (
    <PrWindow
      tab="files"
      filesCount={geld ? shown.files : all.files}
      tabsEnd={
        <>
          {geld ? <span className="border-b border-dotted border-muted-foreground/60 text-xs font-semibold text-muted-foreground">{hiddenLabel(hidden)}</span> : null}
          <Diffstat totals={geld ? shown : all} />
        </>
      }
    >
      <div className="px-4 pt-3">
        <p className="mb-2 text-xs text-muted-foreground">Rest on the label in the header and the counts split by category:</p>
        <div className="rounded-lg border bg-popover text-popover-foreground shadow-sm" aria-label="Line counts" role="group">
          <p className="border-b px-3 py-1.5 font-mono text-[0.625rem] font-medium tracking-[0.12em] text-muted-foreground uppercase">Line counts</p>
          <Breakdown label="Essential" totals={shown} strong />
          {rows.map((row) => (
            <Breakdown key={row.id} label={categoryById(row.id).title} totals={row.totals} />
          ))}
          <Breakdown label="Total" totals={all} className="border-t" />
        </div>
      </div>

      <div className="mt-4 border-t">
        <div className="flex items-center justify-between gap-3 bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">acme/widgets · Pull requests</span>
          <label className="inline-flex items-center gap-2">
            <span>{geld ? 'With Geld' : 'GitHub only'}</span>
            <Switch checked={geld} onCheckedChange={setGeld} aria-label="Show Geld's counts" />
          </label>
        </div>
        <ul>
          <ListRow number={128} title="Add a controlled mode to Button" all={all} hidden={totalsOf(hidden)} label={hiddenLabel(hidden)} geld={geld} />
          {LIST.map((row) => (
            <ListRow key={row.number} {...row} geld={geld} />
          ))}
        </ul>
      </div>
    </PrWindow>
  );
}

function Breakdown({ label, totals, strong = false, className }: { readonly label: string; readonly totals: ChangeTotals; readonly strong?: boolean; readonly className?: string }) {
  return (
    <div className={cn('flex items-center justify-between gap-4 px-3 py-1.5 text-xs', className)}>
      <span className={strong ? 'font-semibold' : 'text-muted-foreground'}>{label}</span>
      <span className="tabular-nums">
        <span className="mr-2 text-muted-foreground">{pluralize(totals.files, 'file', 'files')}</span>
        <span className="font-semibold">{formatDiffstat(totals)}</span>
      </span>
    </div>
  );
}

function ListRow({
  number,
  title,
  all,
  hidden,
  label,
  geld,
}: {
  readonly number: number;
  readonly title: string;
  readonly all: ChangeTotals;
  readonly hidden: ChangeTotals;
  readonly label: string;
  readonly geld: boolean;
}) {
  const shown = subtractTotals(all, hidden);
  return (
    <li className="flex items-start gap-2.5 border-t px-4 py-2">
      <GitPullRequestIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-addition" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{title}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          #{number} opened yesterday by octocat
          {geld ? (
            <>
              {' • '}
              <span className="text-muted-foreground">{label}</span>{' '}
              <span className="font-semibold text-addition">+{formatCount(shown.additions)}</span>{' '}
              <span className="font-semibold text-deletion">&minus;{formatCount(shown.deletions)}</span>
            </>
          ) : null}
        </p>
      </div>
    </li>
  );
}
