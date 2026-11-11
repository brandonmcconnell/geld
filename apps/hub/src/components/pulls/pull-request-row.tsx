import { GitBranchIcon, GitLabLogo } from "@geld/hub-icons";
import { cn } from "@geld/hub-ui/lib/utils";
import { Link, useRouter } from "@tanstack/react-router";
import { memo } from "react";
import {
  CommentsChip,
  listRowClassName,
  listRowHoverClassName,
  RepoChip,
  RowAvatar,
  RowLabels,
  RowNumber,
  RowStateIcon,
  RowTime,
  rowAccessibleName,
} from "#/components/shared/list-row";
import { PullSignalsStat } from "#/components/pulls/pull-signals-stat";
import { SelectableRow } from "#/components/shared/list-selection";
import { HighlightedText } from "#/components/shared/search-highlight";
import { useIsSkeletonSample } from "#/components/shared/skeleton-sample";
import { formatRelativeTime } from "#/lib/format-relative-time";
import type { PullSummary } from "#/lib/github.types";
import { getPrStateConfig } from "#/lib/pr-state";
import { preloadRouteOnce } from "#/lib/route-preload";

export function pullSelectionKey(pull: PullSummary) {
  const key = `${pull.repository.fullName}#${pull.number}`;
  return pull.provider ? `${pull.provider}:${key}` : key;
}

const PROVIDER_ROW_NAMES = {
  gitlab: "GitLab",
  bitbucket: "Bitbucket",
} as const;

function ProviderMark({ provider }: { provider: "gitlab" | "bitbucket" }) {
  return provider === "gitlab" ? (
    <GitLabLogo className="size-3 text-muted-foreground" />
  ) : (
    <GitBranchIcon size={12} className="shrink-0 text-muted-foreground" />
  );
}

export const PullRequestRow = memo(function PullRequestRow({
  pr,
  showRepository = true,
}: {
  pr: PullSummary;
  showRepository?: boolean;
}) {
  const { icon: Icon, color } = getPrStateConfig(pr);
  const href = `/${pr.repository.owner}/${pr.repository.name}/pull/${pr.number}`;
  const router = useRouter();
  const isSample = useIsSkeletonSample();
  const preloadDetail = () => {
    if (!isSample) void preloadRouteOnce(router, href);
  };
  const time = formatRelativeTime(pr.updatedAt, undefined, { compact: true });

  const content = (
    <>
      <RowStateIcon className={color}>
        <Icon size={14} strokeWidth={2} />
      </RowStateIcon>
      <RowNumber number={pr.number} />
      <div className="flex min-w-0 flex-1 flex-col gap-1 md:flex-row md:items-center md:gap-2">
        <p
          title={pr.title}
          className="text-[13px] font-medium text-foreground md:truncate"
        >
          <HighlightedText text={pr.title} />
        </p>
        <PullSignalsStat pr={pr} />
        <p className="flex min-w-0 items-center gap-1 truncate text-xs text-muted-foreground md:hidden">
          <span className="truncate">{pr.repository.fullName}</span>
          <span className="tabular-nums">#{pr.number}</span>
          <span aria-hidden>·</span>
          <span className="tabular-nums">{time}</span>
        </p>
      </div>
      <div className="hidden min-w-0 shrink items-center gap-1 md:flex">
        <RowLabels labels={pr.labels} />
        {showRepository ? (
          <RepoChip
            fullName={pr.repository.fullName}
            ownerAvatarUrl={pr.repository.ownerAvatarUrl}
          />
        ) : null}
        <CommentsChip count={pr.comments} />
        {pr.provider ? (
          <span
            className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
            title={`From ${PROVIDER_ROW_NAMES[pr.provider]}`}
          >
            <ProviderMark provider={pr.provider} />
          </span>
        ) : null}
      </div>
      <span className="hidden shrink-0 items-center gap-2 md:ml-3 md:flex">
        <RowAvatar actor={pr.author} />
        <RowTime>{time}</RowTime>
      </span>
    </>
  );

  // Another provider's row opens in the hub's page for it, and takes no
  // part in bulk actions, which are GitHub's.
  if (pr.provider) {
    return (
      <Link
        to="/provider-pull"
        search={{
          provider: pr.provider,
          repository: pr.repository.fullName,
          number: pr.number,
        }}
        preload={false}
        aria-label={`${rowAccessibleName(pr)}, from ${PROVIDER_ROW_NAMES[pr.provider]}`}
        className={cn(listRowClassName, listRowHoverClassName)}
      >
        {content}
      </Link>
    );
  }

  return (
    <SelectableRow
      selectionKey={pullSelectionKey(pr)}
      label={`Select #${pr.number} ${pr.title}`}
    >
      <Link
        to={href}
        preload={false}
        onMouseEnter={preloadDetail}
        onFocus={preloadDetail}
        onTouchStart={preloadDetail}
        aria-label={rowAccessibleName(pr)}
        className={cn(listRowClassName, listRowHoverClassName)}
      >
        {content}
      </Link>
    </SelectableRow>
  );
});
