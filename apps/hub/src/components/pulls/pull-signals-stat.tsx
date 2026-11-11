import type { ChangeTotals } from "@geld/core";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@geld/hub-ui/components/tooltip";
import { useQuery } from "@tanstack/react-query";
import { RowDiffStat } from "#/components/shared/list-row";
import { useIsSkeletonSample } from "#/components/shared/skeleton-sample";
import { hiddenLabel, type PullSignals } from "#/lib/geld/pull-signals";
import { getPullSignals } from "#/lib/github.functions";
import type { PullSummary } from "#/lib/github.types";
import { useInView } from "#/lib/use-in-view";

const SIGNALS_STALE_MS = 10 * 60 * 1000;

function BreakdownRow({
  label,
  totals,
  strong = false,
}: {
  label: string;
  totals: ChangeTotals;
  strong?: boolean;
}) {
  return (
    <tr className={strong ? "font-medium" : undefined}>
      <th
        scope="row"
        className={strong ? "pr-4 text-left font-medium" : "pr-4 text-left font-normal"}
      >
        {label}
      </th>
      <td className="pr-3 text-right text-muted-foreground">
        {totals.files} {totals.files === 1 ? "file" : "files"}
      </td>
      <td className="pr-2 text-right text-added">+{totals.additions}</td>
      <td className="text-right text-removed">−{totals.deletions}</td>
    </tr>
  );
}

function SignalsBreakdown({ signals }: { signals: PullSignals }) {
  return (
    <div className="flex flex-col gap-1.5">
      <table className="text-xs tabular-nums">
        <tbody>
          <BreakdownRow label="Essential" totals={signals.essential} />
          {signals.hidden.map((entry) => (
            <BreakdownRow
              key={entry.id}
              label={entry.title}
              totals={entry.totals}
            />
          ))}
          <BreakdownRow label="Total" totals={signals.total} strong />
        </tbody>
      </table>
      {signals.partial ? (
        <p className="text-xs text-muted-foreground">
          Counted from the first {signals.total.files} files.
        </p>
      ) : null}
    </div>
  );
}

/**
 * The row's line counts. GitHub's totals show first, and once the row nears
 * the viewport they give way to the lines left to review, with what Geld's
 * categories set aside named beside them.
 */
export function PullSignalsStat({ pr }: { pr: PullSummary }) {
  const isSample = useIsSkeletonSample();
  const eligible = !(isSample || pr.provider);
  const { ref, inView } = useInView<HTMLSpanElement>(eligible);
  const { data: signals } = useQuery({
    queryKey: [
      "geld",
      "pullSignals",
      pr.repository.fullName,
      pr.number,
      pr.updatedAt,
    ],
    queryFn: () =>
      getPullSignals({
        data: {
          owner: pr.repository.owner,
          repo: pr.repository.name,
          pullNumber: pr.number,
        },
      }),
    enabled: eligible && inView,
    staleTime: SIGNALS_STALE_MS,
    retry: false,
  });

  const label = signals ? hiddenLabel(signals) : null;
  // The stat is hidden on narrow screens and absent without counts, so a
  // boxed marker of its own is what the visibility check watches.
  const marker = (
    <span
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute size-px"
    />
  );
  if (!(signals && label)) {
    return (
      <>
        {marker}
        <RowDiffStat additions={pr.additions} deletions={pr.deletions} />
      </>
    );
  }

  return (
    <>
      {marker}
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            data-testid="pull-signals"
            className="hidden shrink-0 items-center gap-1.5 text-xs font-[450] tabular-nums md:flex"
          >
            <span className="text-added">+{signals.essential.additions}</span>
            <span className="text-removed">
              −{signals.essential.deletions}
            </span>
            <span className="text-muted-foreground underline decoration-dotted underline-offset-2">
              {label}
            </span>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <SignalsBreakdown signals={signals} />
        </TooltipContent>
      </Tooltip>
    </>
  );
}
