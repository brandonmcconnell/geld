import { describe, expect, it } from 'vitest';
import { checkGroupOf, checkGroups, checkListSignature, checkLookOf, checkRowLabel, checkWords, checkWordsItalic, expandedStorageKey, headingsShown, parseExpanded, parseGrouping } from './check-list-model';
import type { CrawledCheckRun } from './crawler';

const run = (name: string, status: string, conclusion: string | null, extra: Partial<CrawledCheckRun> = {}): CrawledCheckRun => ({ name, status, conclusion, sha: 'abc', ...extra });

describe('checkGroupOf', () => {
  it('sorts each state into the group GitHub lists it under', () => {
    expect(checkGroupOf({ status: 'completed', conclusion: 'success' })).toBe('success');
    expect(checkGroupOf({ status: 'completed', conclusion: 'skipped' })).toBe('skipped');
    expect(checkGroupOf({ status: 'completed', conclusion: 'neutral' })).toBe('neutral');
    expect(checkGroupOf({ status: 'completed', conclusion: 'failure' })).toBe('failure');
    expect(checkGroupOf({ status: 'completed', conclusion: 'cancelled' })).toBe('failure');
    expect(checkGroupOf({ status: 'completed', conclusion: 'timed_out' })).toBe('failure');
    expect(checkGroupOf({ status: 'completed', conclusion: 'stale' })).toBe('failure');
    expect(checkGroupOf({ status: 'completed', conclusion: 'action_required' })).toBe('pending');
    expect(checkGroupOf({ status: 'queued', conclusion: null })).toBe('pending');
    expect(checkGroupOf({ status: 'waiting', conclusion: null })).toBe('pending');
    expect(checkGroupOf({ status: 'in_progress', conclusion: null })).toBe('in_progress');
  });
});

describe('checkLookOf', () => {
  it('draws each state with the glyph and colour of the merge box', () => {
    expect(checkLookOf({ status: 'completed', conclusion: 'success' })).toEqual({ glyph: 'check', tone: 'success' });
    expect(checkLookOf({ status: 'completed', conclusion: 'failure' })).toEqual({ glyph: 'x', tone: 'danger' });
    expect(checkLookOf({ status: 'completed', conclusion: 'cancelled' })).toEqual({ glyph: 'stop', tone: 'muted' });
    expect(checkLookOf({ status: 'completed', conclusion: 'action_required' })).toEqual({ glyph: 'alert', tone: 'attention' });
    expect(checkLookOf({ status: 'queued', conclusion: null })).toEqual({ glyph: 'dot', tone: 'attention' });
    expect(checkLookOf({ status: 'in_progress', conclusion: null })).toEqual({ glyph: 'running', tone: 'attention' });
    expect(checkLookOf({ status: 'completed', conclusion: 'neutral' })).toEqual({ glyph: 'square', tone: 'muted' });
    expect(checkLookOf({ status: 'completed', conclusion: 'skipped' })).toEqual({ glyph: 'skip', tone: 'muted' });
  });
});

describe('checkGroups', () => {
  const runs = [
    run('build (10)', 'completed', 'success'),
    run('Build (2)', 'completed', 'success'),
    run('lint', 'completed', 'failure'),
    run('deploy', 'in_progress', null),
    run('docs', 'completed', 'skipped'),
  ];

  it('lists the groups in GitHub’s order, each sorted by name with numbers in order', () => {
    const groups = checkGroups(runs, 'grouped');
    expect(groups.map((group) => group.id)).toEqual(['failure', 'in_progress', 'skipped', 'success']);
    expect(groups.map((group) => group.heading)).toEqual(['1 failing check', '1 in progress check', '1 skipped check', '2 successful checks']);
    expect(groups[3]?.runs.map((entry) => entry.name)).toEqual(['Build (2)', 'build (10)']);
  });

  it('is one group of everything with no grouping', () => {
    const groups = checkGroups(runs, 'ungrouped');
    expect(groups).toHaveLength(1);
    expect(groups[0]?.id).toBe('all');
    expect(groups[0]?.heading).toBe('5 checks');
    expect(groups[0]?.runs.map((entry) => entry.name)).toEqual(['Build (2)', 'build (10)', 'deploy', 'docs', 'lint']);
  });

  it('has no group for no checks', () => {
    expect(checkGroups([], 'grouped')).toEqual([]);
    expect(checkGroups([], 'ungrouped')).toEqual([]);
  });

  it('keeps each group’s open state under the merge box’s own key', () => {
    expect(expandedStorageKey('in_progress')).toBe('mergebox:checksGroup:IN_PROGRESSExpanded');
    expect(expandedStorageKey('all')).toBe('mergebox:checksGroup:ALLExpanded');
    expect(checkGroups(runs, 'grouped')[0]?.storageKey).toBe('mergebox:checksGroup:FAILUREExpanded');
  });
});

describe('headingsShown', () => {
  const green = [run('a', 'completed', 'success'), run('b', 'completed', 'success')];
  const mixed = [...green, run('c', 'completed', 'failure')];

  it('heads groups only when there is more than one, or one of mixed states', () => {
    expect(headingsShown(checkGroups(green, 'grouped'), 'grouped')).toBe(false);
    expect(headingsShown(checkGroups(mixed, 'grouped'), 'grouped')).toBe(true);
    expect(headingsShown(checkGroups(green, 'ungrouped'), 'ungrouped')).toBe(false);
    expect(headingsShown(checkGroups(mixed, 'ungrouped'), 'ungrouped')).toBe(true);
  });
});

describe('a row’s words', () => {
  it('drops the dash the status partial leads a status’s words with', () => {
    expect(checkWords(run('a', 'completed', 'neutral', { description: '— Canceled by Ignored Build Step' }))).toBe('Canceled by Ignored Build Step');
    expect(checkWords(run('a', 'completed', 'success', { description: 'Successful in 4m — No issues found' }))).toBe('Successful in 4m — No issues found');
  });

  it('says a queued check is queued and nothing for one with no words', () => {
    expect(checkWords(run('a', 'queued', null))).toBe('Queued');
    expect(checkWords(run('a', 'in_progress', null))).toBe('');
    expect(checkWords(run('a', 'completed', 'success'))).toBe('');
  });

  it('is in italics while the check has not finished', () => {
    expect(checkWordsItalic({ status: 'in_progress', conclusion: null })).toBe(true);
    expect(checkWordsItalic({ status: 'queued', conclusion: null })).toBe(true);
    expect(checkWordsItalic({ status: 'completed', conclusion: 'success' })).toBe(false);
  });

  it('names the row by the check and its words', () => {
    expect(checkRowLabel('lint', 'Failing after 42s')).toBe('lint failing after 42s');
    expect(checkRowLabel('lint', '')).toBe('lint');
  });
});

describe('checkListSignature', () => {
  const first = run('a', 'completed', 'success', { detailsUrl: 'https://github.com/o/r/runs/1' });
  const base = [first];

  it('changes with anything the list draws', () => {
    const signature = checkListSignature(base, 'grouped');
    expect(checkListSignature([run('a', 'completed', 'success', { detailsUrl: 'https://github.com/o/r/runs/1' })], 'grouped')).toBe(signature);
    expect(checkListSignature(base, 'ungrouped')).not.toBe(signature);
    expect(checkListSignature([run('a', 'completed', 'failure', { detailsUrl: 'https://github.com/o/r/runs/1' })], 'grouped')).not.toBe(signature);
    expect(checkListSignature([{ ...first, required: true }], 'grouped')).not.toBe(signature);
    expect(checkListSignature([{ ...first, description: 'Successful in 2s' }], 'grouped')).not.toBe(signature);
  });
});

describe('stored choices', () => {
  it('groups by status unless told otherwise', () => {
    expect(parseGrouping(null)).toBe('grouped');
    expect(parseGrouping('grouped')).toBe('grouped');
    expect(parseGrouping('ungrouped')).toBe('ungrouped');
    expect(parseGrouping('nonsense')).toBe('grouped');
  });

  it('opens a group GitHub has no word on', () => {
    expect(parseExpanded(null)).toBe(true);
    expect(parseExpanded('true')).toBe(true);
    expect(parseExpanded('false')).toBe(false);
  });
});
