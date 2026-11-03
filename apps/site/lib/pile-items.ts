import type { HiddenCategory } from '@geld/core';
import { createMatcher, DEFAULT_SETTINGS } from '@geld/core';

/**
 * What lands on the home page's pile: everything a pull request asks of a
 * reviewer at once, and the digest Geld makes of it. No real review bot is
 * named; the agent review is a made-up one.
 */

export type Person = 'mona' | 'hubot' | 'octocat' | 'nadia';

export type PileItem =
  | { readonly kind: 'file'; readonly id: string; readonly path: string; readonly additions: number; readonly deletions: number }
  | { readonly kind: 'comment'; readonly id: string; readonly who: Person; readonly text: string; readonly needsYou?: boolean }
  | { readonly kind: 'bot'; readonly id: string; readonly name: string; readonly text: string }
  | { readonly kind: 'agent'; readonly id: string; readonly score: number; readonly findings: number }
  | { readonly kind: 'check'; readonly id: string; readonly name: string; readonly state: 'passed' | 'failed' | 'running' }
  | { readonly kind: 'preview'; readonly id: string; readonly name: string }
  | { readonly kind: 'security'; readonly id: string; readonly text: string }
  | { readonly kind: 'coverage'; readonly id: string; readonly percent: number; readonly change: number }
  | { readonly kind: 'review'; readonly id: string; readonly who: Person; readonly verdict: 'approved' | 'changes' };

/** In the order they fall: tall cards between thin ones and every kind early, so even a short pile is a mixed mess. */
export const PILE_ITEMS: readonly PileItem[] = [
  { kind: 'file', id: 'lock', path: 'pnpm-lock.yaml', additions: 1204, deletions: 811 },
  { kind: 'comment', id: 'c1', who: 'mona', text: 'Nit: call this prop pressed?' },
  { kind: 'check', id: 'k1', name: 'test · node 22', state: 'failed' },
  { kind: 'file', id: 'button', path: 'src/Button.tsx', additions: 18, deletions: 9 },
  { kind: 'agent', id: 'agent', score: 3, findings: 4 },
  { kind: 'review', id: 'r1', who: 'hubot', verdict: 'changes' },
  { kind: 'bot', id: 'b1', name: 'deploy-bot', text: 'Deployed to staging' },
  { kind: 'preview', id: 'p1', name: 'widgets-docs' },
  { kind: 'comment', id: 'c2', who: 'octocat', text: 'Fixed, mind another look?', needsYou: true },
  { kind: 'file', id: 'btest', path: 'src/Button.test.tsx', additions: 38, deletions: 12 },
  { kind: 'security', id: 's1', text: '2 vulnerable deps' },
  { kind: 'comment', id: 'c3', who: 'hubot', text: 'This breaks the uncontrolled case.' },
  { kind: 'review', id: 'r2', who: 'mona', verdict: 'approved' },
  { kind: 'file', id: 'schema', path: 'src/api/__generated__/schema.ts', additions: 64, deletions: 20 },
  { kind: 'bot', id: 'b2', name: 'lint-bot', text: '3 lint warnings' },
  { kind: 'check', id: 'k2', name: 'lint', state: 'passed' },
  { kind: 'coverage', id: 'cov', percent: 84.2, change: -1.3 },
  { kind: 'comment', id: 'c4', who: 'nadia', text: 'Should Switch get the same API?', needsYou: true },
  { kind: 'file', id: 'snap', path: 'src/__snapshots__/Button.test.tsx.snap', additions: 6, deletions: 8 },
  { kind: 'file', id: 'toggle', path: 'src/hooks/useToggle.ts', additions: 8, deletions: 7 },
  { kind: 'check', id: 'k3', name: 'build', state: 'passed' },
  { kind: 'file', id: 'docs', path: 'docs/button.mdx', additions: 22, deletions: 4 },
  { kind: 'bot', id: 'b3', name: 'size-bot', text: 'Bundle +1.2 kB (gzip)' },
  { kind: 'file', id: 'index', path: 'src/index.ts', additions: 2, deletions: 1 },
  { kind: 'file', id: 'ci', path: '.github/workflows/ci.yml', additions: 3, deletions: 1 },
  { kind: 'check', id: 'k4', name: 'e2e', state: 'running' },
];

const matcher = createMatcher({ ...DEFAULT_SETTINGS, categories: { tests: true, generated: true, docs: true, tooling: true } });

/** The category Geld sets a file aside under, or null for a file worth reviewing. The extension's matcher decides. */
export function setAsideAs(path: string): HiddenCategory | null {
  return matcher.categorize(path);
}

/** The digest's rows, in the order the card lists them. */
export type DigestRow = 'changes' | 'reviews' | 'comments' | 'agent' | 'checks' | 'preview' | 'security';

export const DIGEST_ROWS: readonly DigestRow[] = ['changes', 'reviews', 'comments', 'agent', 'checks', 'preview', 'security'];

/** Which row an item is gathered into. Set-aside files and bot comments are tallied, not listed. */
export function rowOf(item: PileItem): DigestRow {
  switch (item.kind) {
    case 'file':
      return 'changes';
    case 'review':
      return 'reviews';
    case 'comment':
    case 'bot':
      return 'comments';
    case 'agent':
      return 'agent';
    case 'check':
      return 'checks';
    case 'preview':
      return 'preview';
    case 'security':
    case 'coverage':
      return 'security';
  }
}

export interface Digest {
  readonly files: readonly { readonly path: string; readonly additions: number; readonly deletions: number }[];
  readonly setAside: number;
  readonly reviews: { readonly approved: readonly Person[]; readonly changes: readonly Person[] };
  readonly commenters: readonly Person[];
  readonly comments: number;
  readonly needsYou: number;
  readonly botComments: number;
  readonly agent: { readonly score: number; readonly findings: number } | null;
  readonly checks: { readonly passed: number; readonly failed: number; readonly running: number };
  readonly previews: number;
  readonly security: readonly string[];
}

/** What the items gathered so far add up to. */
export function digestOf(items: readonly PileItem[]): Digest {
  const files: { path: string; additions: number; deletions: number }[] = [];
  let setAside = 0;
  const approved: Person[] = [];
  const changes: Person[] = [];
  const commenters: Person[] = [];
  let comments = 0;
  let needsYou = 0;
  let botComments = 0;
  let agent: Digest['agent'] = null;
  const checks = { passed: 0, failed: 0, running: 0 };
  let previews = 0;
  const security: string[] = [];
  for (const item of items) {
    switch (item.kind) {
      case 'file':
        if (setAsideAs(item.path) === null) files.push({ path: item.path, additions: item.additions, deletions: item.deletions });
        else setAside += 1;
        break;
      case 'review':
        (item.verdict === 'approved' ? approved : changes).push(item.who);
        break;
      case 'comment':
        comments += 1;
        if (item.needsYou === true) needsYou += 1;
        if (!commenters.includes(item.who)) commenters.push(item.who);
        break;
      case 'bot':
        botComments += 1;
        break;
      case 'agent':
        agent = { score: item.score, findings: item.findings };
        break;
      case 'check':
        checks[item.state] += 1;
        break;
      case 'preview':
        previews += 1;
        break;
      case 'security':
        security.push(item.text);
        break;
      case 'coverage':
        security.push(`Coverage ${item.percent}% (${item.change > 0 ? '+' : ''}${item.change}%)`);
        break;
    }
  }
  return { files, setAside, reviews: { approved, changes }, commenters, comments, needsYou, botComments, agent, checks, previews, security };
}
