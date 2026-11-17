import { describe, expect, it } from 'vitest';
import type { TriageSuggestionView } from './panel';
import { fixWords } from './panel';

const row = (over: Partial<TriageSuggestionView>): TriageSuggestionView => ({
  key: 'discussion_r1',
  title: 'Counts missing values as zero',
  path: 'src/total.ts',
  start: 3,
  end: 3,
  summary: '',
  kind: 'agent',
  diff: [],
  reporters: ['Greptile'],
  threads: 1,
  state: 'open',
  current: true,
  behind: null,
  busy: null,
  error: null,
  from: null,
  routed: false,
  ...over,
});

describe('an opened triage row’s words', () => {
  it('says only why the check sent a finding to an agent, which read its lines, when the decision model wrote no sentence', () => {
    const words = fixWords(row({ routed: true }), true);
    expect(words.summary).toBe('');
    expect(words.notes).toEqual(['Geld’s check found that a proper fix likely changes more than the lines this thread is on, such as other code, other files or tests. So no suggestion was drafted. Hand it to an agent.']);
  });

  it('keeps the unread-lines sentence for a thread no fix was drafted for because its lines could not be read', () => {
    expect(fixWords(row({}), true).summary).toBe('Geld could not read the lines this thread is on, so it proposed no fix here.');
    expect(fixWords(row({ routed: true, summary: 'Also change `summarize`.' }), true).summary).toBe('Also change `summarize`.');
  });
});
