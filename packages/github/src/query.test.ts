import { describe, expect, it } from 'vitest';
import { parseQuery, parseRepositoryInput, serializeQuery, setQualifier, withRepos } from './query';
describe('search query editing', () => {
  it('preserves quoted labels and free text while changing qualifiers', () => {
    const query = 'is:pr is:open label:"needs review" parser';
    expect(serializeQuery(parseQuery(query))).toBe(query);
    expect(setQualifier(query, 'label', 'ready')).toBe('is:pr is:open parser label:ready');
    expect(withRepos('repo:o/old is:open', ['o/new', 'o/new', 'o/other'])).toBe('is:open repo:o/new repo:o/other');
  });
  it('splits repository URLs without accepting foreign hosts or path tails', () => {
    expect(parseRepositoryInput('https://github.com/wxt-dev/wxt')).toEqual({ owner: 'wxt-dev', repo: 'wxt' });
    expect(parseRepositoryInput('owner')).toEqual({ owner: 'owner', repo: null });
    expect(parseRepositoryInput('https://foreign.example/o/r')).toBeNull();
    expect(parseRepositoryInput('o/r/pull/1')).toBeNull();
  });
});
