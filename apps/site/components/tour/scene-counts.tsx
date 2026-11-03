'use client';

import type { ChangeTotals, CategoryId } from '@geld/core';
import { categoryById, formatCount, pluralize, subtractTotals } from '@geld/core';
import { FileCodeIcon, GitPullRequestIcon } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';

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
  const labelRef = useRef<HTMLSpanElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [caret, setCaret] = useState<number | null>(null);

  useLayoutEffect(() => {
    const label = labelRef.current;
    const box = boxRef.current;
    if (!label || !box) return;
    const measure = (): void => {
      const labelRect = label.getBoundingClientRect();
      setCaret(labelRect.left + labelRect.width / 2 - box.getBoundingClientRect().left);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    observer.observe(label);
    return () => observer.disconnect();
  }, [geld]);

  return (
    <PrWindow
      tab="files"
      filesCount={geld ? shown.files : all.files}
      tabsEnd={
        <span className="relative flex items-center gap-2">
          {geld ? (
            <span ref={labelRef} className="text-xs font-semibold text-muted-foreground underline decoration-muted-foreground/55 decoration-dotted underline-offset-3">
              {hiddenLabel(hidden)}
            </span>
          ) : null}
          <Diffstat totals={geld ? shown : all} />
          {geld ? (
            <div ref={boxRef} role="tooltip" className="geld-breakdown absolute top-[calc(100%+0.375rem)] right-0 z-20">
              <span aria-hidden="true" className="geld-breakdown__caret" style={{ left: caret ?? '50%' }} />
              <BreakdownRow label="Essential" totals={shown} />
              {rows.map((row) => (
                <BreakdownRow key={row.id} label={categoryById(row.id).title} totals={row.totals} />
              ))}
              <span role="separator" className="col-span-full my-[3px] border-t" />
              <BreakdownRow label="Total" totals={all} />
            </div>
          ) : null}
        </span>
      }
    >
      <ul aria-label="Files to review">
        {files
          .filter((file) => !geld || file.category === null)
          .slice(0, 5)
          .map((file) => (
            <li key={file.path} className="flex items-center gap-2 border-b px-4 py-1.5 font-mono text-xs">
              <FileCodeIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{file.path}</span>
              <span className="shrink-0 tabular-nums">
                <span className="text-addition">+{formatCount(file.additions)}</span> <span className="text-deletion">&minus;{formatCount(file.deletions)}</span>
              </span>
            </li>
          ))}
      </ul>

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

/** One line of the extension's tooltip (ui/tooltip.ts `row`): label, files, additions, deletions, as grid cells. */
function BreakdownRow({ label, totals }: { readonly label: string; readonly totals: ChangeTotals }) {
  return (
    <span className="contents">
      <span className="font-medium">{label}</span>{' '}
      <span className="font-semibold text-muted-foreground tabular-nums">{pluralize(totals.files, 'file', 'files')}</span>{' '}
      <span className="text-right font-semibold text-addition tabular-nums">+{formatCount(totals.additions)}</span>{' '}
      <span className="text-right font-semibold text-deletion tabular-nums">&minus;{formatCount(totals.deletions)}</span>
    </span>
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
