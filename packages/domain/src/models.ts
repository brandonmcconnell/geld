import { z } from 'zod';

export const providerSchema = z.enum(['github', 'gitlab', 'bitbucket']);
export type Provider = z.infer<typeof providerSchema>;
export const resourceSchema = z.object({
  provider: providerSchema,
  host: z.string().min(1),
  owner: z.string().min(1),
  repo: z.string().min(1),
});
export type RepositoryRef = z.infer<typeof resourceSchema>;
export const pullRefSchema = resourceSchema.extend({ number: z.number().int().positive() });
export type PullRef = z.infer<typeof pullRefSchema>;
export const capabilitySchema = z.enum(['read', 'comment', 'review', 'merge', 'settings', 'manage_access', 'delete']);
export type Capability = z.infer<typeof capabilitySchema>;
export type Permission = 'none' | 'read' | 'triage' | 'write' | 'maintain' | 'admin';
export type ReviewEvent = 'comment' | 'approve' | 'request_changes';
export type Visibility = 'names' | 'request' | 'count' | 'none';

export interface PullSummary {
  readonly ref: PullRef;
  readonly id: string;
  readonly title: string;
  readonly author: string;
  readonly authorAvatar: string | null;
  readonly state: 'open' | 'closed' | 'merged';
  readonly draft: boolean;
  readonly updatedAt: string;
  readonly url: string;
  readonly headSha: string;
  readonly baseSha: string;
  readonly additions: number;
  readonly deletions: number;
  readonly labels: readonly string[];
  readonly reviewers: readonly string[];
}

export interface PullDetail extends PullSummary {
  readonly startSha?: string;
  readonly headBranch?: string;
  readonly body: string;
  readonly capabilities: readonly Capability[];
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly cursor: string | null;
  readonly total: number | null;
  readonly capped: boolean;
}

export type ProviderResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: 'signed_out' | 'unavailable' | 'invalid_response' | 'not_found' | 'unsupported' }
  | { readonly ok: false; readonly reason: 'permission'; readonly required: string | null; readonly url: string | null }
  | { readonly ok: false; readonly reason: 'rate_limit'; readonly retryAt: number | null };

export interface RepositorySummary {
  readonly ref: RepositoryRef;
  readonly id: string;
  readonly private: boolean;
  readonly permission: Permission;
  readonly url: string;
}

export interface ProviderComment {
  readonly id: string;
  readonly author: string;
  readonly body: string;
  readonly path: string | null;
  readonly line: number | null;
  readonly url: string;
}

export interface ProviderThread {
  readonly id: string;
  readonly path: string | null;
  readonly line: number | null;
  readonly resolved: boolean;
  readonly outdated: boolean;
  readonly comments: readonly ProviderComment[];
}

export interface ReviewSubmission {
  readonly event: ReviewEvent;
  readonly body: string;
  readonly headSha: string;
}

export interface LineComment {
  readonly oldPath?: string;
  readonly body: string;
  readonly path: string;
  readonly line: number;
  readonly side: 'old' | 'new';
  readonly headSha: string;
}

export interface ProviderClient {
  readonly provider: Provider;
  repositories(cursor?: string | null): Promise<ProviderResult<Page<RepositorySummary>>>;
  pulls(repo: RepositoryRef, cursor?: string | null): Promise<ProviderResult<Page<PullSummary>>>;
  pull(ref: PullRef): Promise<ProviderResult<PullDetail>>;
  diff(ref: PullRef): Promise<ProviderResult<string>>;
  comments(ref: PullRef): Promise<ProviderResult<readonly ProviderComment[]>>;
  comment(ref: PullRef, body: string): Promise<ProviderResult<string>>;
  lineComment(ref: PullRef, comment: LineComment): Promise<ProviderResult<string>>;
  review(ref: PullRef, review: ReviewSubmission): Promise<ProviderResult<string>>;
  threads(ref: PullRef): Promise<ProviderResult<readonly ProviderThread[]>>;
  reply(ref: PullRef, threadId: string, body: string): Promise<ProviderResult<void>>;
  resolve(ref: PullRef, threadId: string, resolved: boolean): Promise<ProviderResult<void>>;
  requestReviewers(ref: PullRef, reviewers: readonly string[], remove?: boolean): Promise<ProviderResult<void>>;
}
