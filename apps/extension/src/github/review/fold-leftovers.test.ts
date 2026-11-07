// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { groupLeftovers } from './fold';

const row = (): HTMLElement => document.createElement('div');

describe('groupLeftovers', () => {
  it('makes a mentions row for what the description mentions when nothing mentions this pull request', () => {
    expect(groupLeftovers([], 2).map((group) => [group.key, group.label, group.nodes.length])).toEqual([['mentions', '2 mentions', 0]]);
    expect(groupLeftovers([]).find((group) => group.key === 'mentions')).toBeUndefined();
  });

  it('counts both ways in one row: the timeline’s references to this pull request and the description’s', () => {
    const incoming = [row(), row()];
    const groups = groupLeftovers(incoming.map((root) => ({ kind: 'mention', root })), 1);
    expect(groups.map((group) => [group.key, group.label, group.nodes])).toEqual([['mentions', '3 mentions', incoming]]);
  });
});
