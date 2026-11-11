import { coverageOf, type DigestDocument } from './digest-document';

export interface ReviewsSummary {
  readonly coverage: 'complete' | 'partial' | 'unavailable';
  readonly label: string;
}

function countLabel(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

function requiredTally(document: DigestDocument): string | null {
  const required = document.requirement?.approvalsRequired ?? null;
  const left = document.requirement?.approvalsLeft ?? null;
  if (required === null || left === null || required <= 0 || left < 0 || left > required) return null;
  return `${required - left}/${required} required approvals`;
}

/** The Reviews row's heading: people only (bots are the Review bots row's), counted as far as the host let us read. */
export function reviewsSummary(document: DigestDocument): ReviewsSummary {
  const tally = requiredTally(document);
  const read = coverageOf(document, 'reviews').state;
  const coverage = read === 'unavailable' ? (tally === null ? 'unavailable' : 'partial') : read;
  if (coverage === 'unavailable') return { coverage, label: 'Reviews · Unavailable' };
  const people = document.reviewers.filter((reviewer) => reviewer.account.kind === 'person');
  const approvals = people.filter((reviewer) => reviewer.standing === 'approved').length;
  const changes = people.filter((reviewer) => reviewer.standing === 'changes_requested').length;
  const pending = people.filter((reviewer) => reviewer.request === 'pending').length;
  const observed = coverage === 'partial' ? 'observed ' : '';
  const tallies = [
    tally ?? (coverage === 'complete' || approvals > 0 ? countLabel(approvals, `${observed}approval`) : null),
    changes === 0 ? null : countLabel(changes, `${observed}change request`),
    pending === 0 ? null : countLabel(pending, `${observed}pending review`),
  ].filter((value) => value !== null);
  return { coverage, label: ['Reviews', ...(coverage === 'partial' ? ['Partial'] : []), ...tallies].join(' · ') };
}
