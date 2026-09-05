import { globToRegExp } from './glob';

/**
 * Repository rules decide where Geld runs. They read like a .gitignore for
 * repositories:
 *
 * - `acme/widgets`   Geld stays off in that repository
 * - `acme`           shorthand for `acme/*` (the whole org/user)
 * - `!acme/widgets`  re-enable (last matching rule wins)
 * - `*`              turn off everywhere; combine with `!acme/*` for an allowlist
 *
 * An empty list means "run everywhere". Matching is case-insensitive because
 * GitHub treats owner and repository names that way.
 */

export interface RepoRule {
  readonly raw: string;
  readonly pattern: string;
  readonly negated: boolean;
  readonly regExp: RegExp;
}

export interface RepoDecision {
  readonly allowed: boolean;
  /** The rule that decided, or `null` when no rule matched. */
  readonly rule: RepoRule | null;
}

function normalizeRulePattern(pattern: string): string {
  let cleaned = pattern.trim().replace(/^\/+|\/+$/g, '');
  if (cleaned === '') return '';
  if (cleaned === '*' || cleaned === '**') return '**';
  // A bare owner covers all of its repositories.
  if (!cleaned.includes('/')) cleaned = `${cleaned}/*`;
  return cleaned;
}

export function compileRepoRules(lines: readonly string[]): readonly RepoRule[] {
  const rules: RepoRule[] = [];
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const negated = trimmed.startsWith('!');
    const pattern = normalizeRulePattern(negated ? trimmed.slice(1) : trimmed);
    if (pattern === '') continue;
    // Anchor to the full "owner/repo" string; `**` may span the slash.
    const source = pattern === '**' ? '^.*$' : globToRegExp(pattern, { caseSensitive: false }).source;
    rules.push({ raw: trimmed, pattern, negated, regExp: new RegExp(source, 'i') });
  }
  return rules;
}

/** Decide whether Geld should run for `owner/repo`. */
export function decideRepo(rules: readonly RepoRule[], repo: string): RepoDecision {
  const normalized = repo.trim().replace(/^\/+|\/+$/g, '').toLowerCase();
  let decision: RepoDecision = { allowed: true, rule: null };
  for (const rule of rules) {
    if (rule.regExp.test(normalized)) decision = { allowed: rule.negated, rule };
  }
  return decision;
}

/** Probe repo used to evaluate rules for a whole owner (`acme` → `acme/<probe>`). */
export function ownerProbe(owner: string): string {
  return `${owner}/\u0000probe`;
}

/**
 * Return the rule list that makes Geld `allowed` (or not) for `target`, which
 * is either `owner/repo` or a bare `owner`.
 *
 * Rules that name the target exactly are removed first, so toggling back
 * undoes an earlier toggle instead of stacking `acme` / `!acme` pairs. A new
 * rule is appended only when the remaining list does not already produce the
 * desired outcome (for example `acme/*` still covering `acme/widgets`).
 */
export function withRepoRule(lines: readonly string[], target: string, allowed: boolean): readonly string[] {
  const normalizedTarget = normalizeRulePattern(target).toLowerCase();
  const kept = lines.filter((line) => {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) return true;
    const pattern = normalizeRulePattern(trimmed.startsWith('!') ? trimmed.slice(1) : trimmed).toLowerCase();
    return pattern !== normalizedTarget;
  });
  const probe = target.includes('/') ? target : ownerProbe(target);
  if (decideRepo(compileRepoRules(kept), probe).allowed === allowed) return kept;
  return [...kept, allowed ? `!${target}` : target];
}

/** Owner + repository from a GitHub pathname such as `/acme/widgets/pull/1`. */
export function repoFromPathname(pathname: string): string | null {
  const match = /^\/([^/]+)\/([^/]+)(?:\/|$)/.exec(pathname);
  if (match === null) return null;
  const [, owner, repo] = match;
  if (owner === undefined || repo === undefined) return null;
  // Top-level GitHub routes that look like owner/repo but are not.
  if (RESERVED_OWNERS.has(owner.toLowerCase())) return null;
  return `${owner}/${repo}`;
}

const RESERVED_OWNERS = new Set([
  'settings',
  'notifications',
  'pulls',
  'issues',
  'marketplace',
  'explore',
  'topics',
  'trending',
  'search',
  'orgs',
  'organizations',
  'users',
  'login',
  'logout',
  'join',
  'sponsors',
  'codespaces',
  'features',
  'about',
  'pricing',
  'new',
  'dashboard',
  'apps',
  'enterprise',
  'security',
  'site',
  'sessions',
  'account',
]);
