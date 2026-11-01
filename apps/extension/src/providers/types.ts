import type { FileStats, RepositoryIdentity } from '@geld/core';
import type { ProviderReviewComment, ProviderReviewInput } from '@geld/review';
import type { ProviderReviewPanelEvent, ProviderReviewSourceAction } from './review-panel';
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
  readonly link: HTMLAnchorElement | null;
}

export interface ProviderDiffView {
  readonly kind: string;
  readonly container: HTMLElement;
  readonly entries: readonly ProviderDiffEntry[];
  readonly tree: readonly ProviderTreeEntry[];
  readonly treeHost: HTMLElement | null;
  readonly filteredPaths: ReadonlySet<string>;
  readonly virtualized: boolean;
}

export interface ProviderHeaderTarget {
  readonly additions: HTMLElement | null;
  readonly deletions: HTMLElement | null;
  readonly files: HTMLElement | null;
  readonly hoverHosts?: readonly HTMLElement[];
  readonly labels?: readonly {
    readonly host: HTMLElement;
    readonly attribute: 'aria-label' | 'title';
    readonly count: 'files' | 'additions' | 'deletions';
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
  readonly input: ProviderReviewInput;
  readonly comments: readonly ProviderReviewComment[];
  readonly events: readonly ProviderReviewPanelEvent[];
  readonly complete: boolean;
  readonly unavailable: readonly { readonly area: string; readonly reason: string }[];
  readonly approvalsRequired: number | null;
  readonly approvalsLeft: number | null;
  readonly actions: readonly ProviderReviewAction[];
}

export interface ProviderAdapter {
  readonly id: ReviewProvider;
  describe(url: URL, doc: Document): ProviderPage | null;
  readDiff(doc: Document): ProviderDiffView | null;
  headerTargets(doc: Document): readonly ProviderHeaderTarget[];
  listRows(doc: Document): readonly ProviderListRow[];
  fetchDiff(page: ProviderPage, signal: AbortSignal): Promise<ProviderDiffResult>;
  readonly fetchConfig?: ProviderConfigFetcher;
  reviewHost?(doc: Document): HTMLElement | null;
  actionHost?(doc: Document): HTMLElement | null;
  fetchReview?(page: ProviderReviewPage, signal: AbortSignal, doc: Document): Promise<ProviderReviewSnapshot>;
}
