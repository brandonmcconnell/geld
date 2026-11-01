import type { ProviderReviewInput } from '@geld/review';

export interface OwnedComment {
  readonly id: string;
  readonly authorId: string;
  readonly body: string;
}

export interface ProviderCiReview {
  readonly input: ProviderReviewInput;
  readonly comments: readonly OwnedComment[];
  readonly notes: readonly string[];
}

export interface ProviderCiAdapter {
  identity(): Promise<string>;
  load(): Promise<ProviderCiReview>;
  head(): Promise<string>;
  upsert(id: string | null, body: string): Promise<void>;
}
