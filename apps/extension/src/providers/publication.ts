import type { GeldSettings, RepositoryIdentity } from '@geld/core';
import { trustedSummaryPublisherIdsFor } from '@geld/core';
import { readProviderPublication } from '@geld/review';
import type { ProviderPublicationRead, ProviderReviewComment, ProviderReviewInput, ProviderSourceCoverage } from '@geld/review';

export class ProviderPublishedReview {
  private generation = 0;
  private signature = '';
  private value: ProviderPublicationRead | null = null;
  private failure = '';

  constructor(
    private readonly changed: () => void,
    private readonly read: typeof readProviderPublication = readProviderPublication,
  ) {}

  get result(): ProviderPublicationRead | null { return this.value; }
  get error(): string { return this.failure; }

  load(input: ProviderReviewInput, comments: readonly ProviderReviewComment[], sourceCoverage: ProviderSourceCoverage | undefined, settings: GeldSettings): void {
    const repository: RepositoryIdentity = { provider: input.subject.provider, origin: input.subject.origin, path: input.subject.repository };
    const trustedPublisherIds = trustedSummaryPublisherIdsFor(settings.trustedSummaryPublishers, repository);
    const signature = JSON.stringify([input, comments, sourceCoverage, trustedPublisherIds]);
    if (signature === this.signature) return;
    this.signature = signature;
    const generation = ++this.generation;
    // A previous source or trust decision must never survive a pending read.
    this.value = null;
    this.failure = '';
    void this.read({ input, comments, sourceCoverage, trustedPublisherIds }).then((result) => {
      if (generation !== this.generation) return;
      this.value = result;
      this.changed();
    }).catch(() => {
      if (generation !== this.generation) return;
      this.failure = 'The published summary could not be verified. Native review sources remain available.';
      this.changed();
    });
  }

  reset(): void {
    this.generation += 1;
    this.signature = '';
    this.value = null;
    this.failure = '';
  }
}
