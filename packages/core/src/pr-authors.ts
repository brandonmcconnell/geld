/**
 * Rules for hiding pull requests by who opened them, in PR lists and stacks:
 * dependency bots first and foremost. One login pattern per line, matched
 * case-insensitively against the author's login as GitHub shows it
 * (`dependabot[bot]`, `renovate[bot]`, `github-actions[bot]`, `octocat`).
 * `*` matches any run of characters and everything else is literal, so
 * `*[bot]` means "every GitHub App", and `#` starts a comment. Unlike file
 * patterns there is no negation: the list is short and explicit.
 */

export interface AuthorRules {
  /** Whether a login is hidden by the rules. */
  hides(login: string): boolean;
  /** The rule that hid a login, for explanations. */
  explain(login: string): string | null;
  readonly isEmpty: boolean;
}

const NEVER: AuthorRules = { hides: () => false, explain: () => null, isEmpty: true };

function escapeRegExp(text: string): string {
  return text.replace(/[\\^$.+?()|[\]{}]/g, '\\$&');
}

/** `*[bot]` → /^.*\[bot\]$/i */
export function authorPatternToRegExp(pattern: string): RegExp {
  return new RegExp(`^${pattern.split('*').map(escapeRegExp).join('.*')}$`, 'i');
}

export function normalizeAuthorRule(line: string): string | null {
  const trimmed = line.trim();
  if (trimmed === '' || trimmed.startsWith('#')) return null;
  return trimmed.replace(/^@/, '');
}

/** A problem with one rule line, or `null` when it is fine. */
export function authorRuleProblem(line: string): string | null {
  const rule = normalizeAuthorRule(line);
  if (rule === null) return null;
  if (/\s/.test(rule)) return `"${rule}" contains whitespace; logins never do.`;
  return null;
}

export function compileAuthorRules(lines: readonly string[]): AuthorRules {
  const rules: { readonly raw: string; readonly regexp: RegExp }[] = [];
  for (const line of lines) {
    const rule = normalizeAuthorRule(line);
    if (rule !== null && authorRuleProblem(rule) === null) rules.push({ raw: rule, regexp: authorPatternToRegExp(rule) });
  }
  if (rules.length === 0) return NEVER;
  const explain = (login: string): string | null => rules.find((rule) => rule.regexp.test(login))?.raw ?? null;
  return { isEmpty: false, explain, hides: (login) => explain(login) !== null };
}
