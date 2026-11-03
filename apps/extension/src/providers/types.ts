import type { FileStats, RepositoryIdentity } from '@geld/core';
import type { ProviderReviewComment, ProviderReviewInput } from '@geld/review';
import type { ProviderReviewAuthorPresentation, ProviderReviewPanelEvent, ProviderReviewRequirement, ProviderReviewSourceAction } from './review-panel';
import type { ProviderConfigFetcher } from './repo-config';

export type ReviewProvider = 'gitlab' | 'bitbucket';

interface ProviderPageIdentity {
  readonly provider: ReviewProvider;
  readonly repository: RepositoryIdentity;
  readonly url: string;
  readonly diffPageUrl: string;
  readonly diffUrl: string;
  readonly headSha: string | null;
  readonly version: string;
}

export interface ProviderReviewPage extends ProviderPageIdentity {
  readonly number: string;
  readonly kind: 'overview' | 'diff' | 'other';
}

export interface ProviderCommitPage extends ProviderPageIdentity {
  readonly kind: 'commit';
  readonly ref: string;
}

export interface ProviderComparePage extends ProviderPageIdentity {
  readonly kind: 'compare';
  readonly from: string;
  readonly to: string;
  readonly straight: boolean;
  readonly targetProjectId?: string;
}

export type ProviderStandalonePage = ProviderCommitPage | ProviderComparePage;
export type ProviderPage = ProviderReviewPage | ProviderStandalonePage;

export function isProviderReviewPage(page: ProviderPage): page is ProviderReviewPage {
  return page.kind === 'overview' || page.kind === 'diff' || page.kind === 'other';
}

export function immutableProviderPage(page: ProviderPage): boolean {
  const sha = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
  return page.headSha !== null && sha.test(page.headSha) && (page.kind !== 'compare' || (sha.test(page.from) && sha.test(page.to)));
}

export interface ProviderDiffResult {
  readonly files: readonly FileStats[];
  readonly revision: string;
  readonly complete: boolean;
  readonly patches?: ReadonlyMap<string, string>;
}

export interface ProviderDiffEntry {
  readonly path: string;
  readonly root: HTMLElement;
  readonly anchor: string | null;
  readonly additions: number | null;
  readonly deletions: number | null;
  prepareReveal?(): void;
  isExpanded?(): boolean;
  isViewed?(): boolean | null;
  readLines?(): readonly ProviderDiffLine[];
  expand(): boolean;
  collapse(): boolean;
  markViewed?(): boolean;
}

export interface ProviderDiffLine {
  readonly root: HTMLElement;
  readonly oldLine: number | null;
  readonly newLine: number | null;
  readonly oldText: string | null;
  readonly newText: string | null;
  readonly kind: 'context' | 'added' | 'removed' | 'hunk';
}

export interface ProviderTreeEntry {
  readonly path: string;
  readonly root: HTMLElement;
  /** Observed per-file visual wrapper, including native status/comment marks; never moved. */
  readonly presentationRoot?: HTMLElement;
  readonly link: HTMLAnchorElement | null;
}

export interface ProviderDiffView {
  readonly kind: string;
  readonly container: HTMLElement;
  readonly entries: readonly ProviderDiffEntry[];
  readonly tree: readonly ProviderTreeEntry[];
  readonly treeHost: HTMLElement | null;
  /** Verified native file-list root only; excludes provider search/header controls. */
  readonly treeContainer?: HTMLElement | null;
  navigateToPath?(path: string): boolean;
  readonly filteredPaths: ReadonlySet<string>;
  readonly virtualized: boolean;
}

export interface ProviderHeaderTarget {
  readonly hintHost?: HTMLElement;
  readonly hintBefore?: HTMLElement | null;
  readonly additions: HTMLElement | null;
  readonly deletions: HTMLElement | null;
  readonly files: HTMLElement | null;
  readonly hoverHosts?: readonly HTMLElement[];
  readonly keyboardHoverHosts?: readonly HTMLElement[];
  readonly accessibleSummaryHost?: HTMLElement;
  readonly labels?: readonly {
    readonly host: HTMLElement;
    readonly attribute: 'aria-label' | 'title';
    readonly count: 'files' | 'additions' | 'deletions' | 'lines';
  }[];
}

export interface ProviderListRow {
  readonly root: HTMLElement;
  readonly host: HTMLElement;
  readonly url: string;
  readonly author: string | null;
}

export interface ProviderReviewAction {
  readonly kind: 'approve' | 'request-changes' | 'comment';
  readonly available: boolean;
  readonly reason?: string;
  activate(): Promise<boolean>;
}

export interface ProviderReviewSnapshot {
  readonly sourceActions?: (comment: ProviderReviewComment) => readonly ProviderReviewSourceAction[];
  readonly renderComment?: (comment: ProviderReviewComment, host: HTMLElement) => boolean;
  readonly authorPresentation?: (comment: ProviderReviewComment) => ProviderReviewAuthorPresentation | null;
  readonly input: ProviderReviewInput;
  readonly comments: readonly ProviderReviewComment[];
  readonly events: readonly ProviderReviewPanelEvent[];
  readonly complete: boolean;
  readonly unavailable: readonly { readonly area: string; readonly reason: string }[];
  readonly approvalsRequired: number | null;
  readonly approvalsLeft: number | null;
  readonly requirements?: readonly ProviderReviewRequirement[] | null;
  readonly actions: readonly ProviderReviewAction[];
}

export interface ProviderConversationRoot {
  readonly root: HTMLElement;
  readonly anchors: readonly string[];
  readonly kind: 'comment' | 'activity';
}

export interface ProviderAdapter {
  readonly id: ReviewProvider;
  describe(url: URL, doc: Document): ProviderPage | null;
  readDiff(doc: Document): ProviderDiffView | null;
  headerTargets(doc: Document): readonly ProviderHeaderTarget[];
  listRows(doc: Document): readonly ProviderListRow[];
  eagerListDiffs?(doc: Document): boolean;
  reviewRefreshMs?(doc: Document): number;
  fetchDiff(page: ProviderPage, signal: AbortSignal): Promise<ProviderDiffResult>;
  readonly fetchConfig?: ProviderConfigFetcher;
  reviewHost?(doc: Document): HTMLElement | null;
  conversationRoots?(doc: Document): readonly ProviderConversationRoot[];
  descriptionHost?(doc: Document): HTMLElement | null;
  actionHost?(doc: Document): HTMLElement | null;
  fetchReview?(page: ProviderReviewPage, signal: AbortSignal, doc: Document): Promise<ProviderReviewSnapshot>;
}
