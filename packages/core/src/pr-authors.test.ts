import { describe, expect, it } from 'vitest';
import { authorRuleProblem, compileAuthorRules } from './pr-authors';

describe('compileAuthorRules', () => {
  it('matches logins literally and with * wildcards, ignoring case and a leading @', () => {
    const rules = compileAuthorRules(['# bots', '*[bot]', '@Octocat', 'renovate*']);
    expect(rules.hides('dependabot[bot]')).toBe(true);
    expect(rules.hides('github-actions[bot]')).toBe(true);
    expect(rules.hides('octocat')).toBe(true);
    expect(rules.hides('renovate-approve')).toBe(true);
    expect(rules.hides('brandonmcconnell')).toBe(false);
    expect(rules.explain('dependabot[bot]')).toBe('*[bot]');
  });

  it('treats brackets and dots literally', () => {
    expect(compileAuthorRules(['[bot]']).hides('b')).toBe(false);
    expect(compileAuthorRules(['a.b']).hides('axb')).toBe(false);
  });

  it('is empty without usable lines and reports whitespace', () => {
    expect(compileAuthorRules(['', '# nothing']).isEmpty).toBe(true);
    expect(authorRuleProblem('two words')).not.toBeNull();
    expect(authorRuleProblem('dependabot[bot]')).toBeNull();
  });
});
