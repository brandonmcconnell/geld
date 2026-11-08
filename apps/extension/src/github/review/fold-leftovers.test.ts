// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { groupLeftovers } from './fold';

const row = (): HTMLElement => document.createElement('div');

describe('groupLeftovers', () => {
  it('makes a mentions row for what the description mentions when nothing mentions this pull request', () => {
    expect(groupLeftovers([], ['/o/r/issues/1 One', '/o/r/pull/2 Two']).map((group) => [group.key, group.label, group.nodes.length, group.refs])).toEqual([['mentions', '2 mentions', 0, ['/o/r/issues/1 One', '/o/r/pull/2 Two']]]);
    expect(groupLeftovers([]).find((group) => group.key === 'mentions')).toBeUndefined();
  });

  it('counts both ways in one row: the timeline’s references to this pull request and the description’s', () => {
    const incoming = [row(), row()];
    const groups = groupLeftovers(incoming.map((root) => ({ kind: 'mention', root })), ['/o/r/issues/1 One']);
    expect(groups.map((group) => [group.key, group.label, group.nodes])).toEqual([['mentions', '3 mentions', incoming]]);
    expect(groupLeftovers(incoming.map((root) => ({ kind: 'mention', root }))).find((group) => group.key === 'mentions')?.refs).toBeUndefined();
  });
});
