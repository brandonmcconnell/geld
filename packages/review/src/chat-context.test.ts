import { describe, expect, it } from 'vitest';
import { assistantSystemPrompt } from './chat-context';

describe('assistantSystemPrompt', () => {
  it('lays the pull request out under the instructions, open threads first', () => {
    const prompt = assistantSystemPrompt({
      url: 'https://github.com/o/r/pull/7',
      title: 'Debounce the search box',
      author: 'alice',
      description: 'Waits 250 ms.',
      findings: [
        { title: 'Old nit', open: false, authors: ['bob'] },
        { title: 'Retry has no cap', path: 'src/search.ts', line: 12, open: true, authors: ['greptile-apps[bot]'] },
      ],
      files: [{ path: 'src/search.ts', additions: 10, deletions: 2 }, { path: 'src/search.test.ts', additions: 30, deletions: 0, hidden: 'Tests' }],
    });
    expect(prompt).toContain('Pull request: Debounce the search box');
    expect(prompt).toContain('Author: alice');
    expect(prompt).toContain('Review threads (1 open of 2):');
    expect(prompt.indexOf('Retry has no cap')).toBeLessThan(prompt.indexOf('Old nit'));
    expect(prompt).toContain('- [open] Retry has no cap (src/search.ts:12) by greptile-apps[bot]');
    expect(prompt).toContain('- src/search.test.ts +30 −0 (Tests)');
  });

  it('says when there is no description and cuts a long one', () => {
    const base = { url: 'u', title: 't', author: null, findings: [], files: [] };
    expect(assistantSystemPrompt({ ...base, description: '' })).toContain('(none)');
    expect(assistantSystemPrompt({ ...base, description: 'x'.repeat(10_000) }).length).toBeLessThan(7000);
  });
});
