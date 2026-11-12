import { describe, expect, it } from 'vitest';
import type { TriageAgent } from './panel';
import { agentMenuGroups } from './panel';

const agent = (id: string, likely: boolean): TriageAgent => ({ id, name: id, command: `@${id}`, iconSrc: null, note: null, openLabel: null, used: false, likely });

describe('agentMenuGroups', () => {
  it('keeps the rest folded when the only likely agent is the row’s own button', () => {
    const groups = agentMenuGroups([agent('codex', true), agent('cursor', false), agent('devin', false)]);
    expect(groups.first.map((each) => each.id)).toEqual(['codex']);
    expect(groups.folded.map((each) => each.id)).toEqual(['cursor', 'devin']);
  });

  it('lists every agent when none is likely', () => {
    const groups = agentMenuGroups([agent('cursor', false), agent('devin', false)]);
    expect(groups.first.map((each) => each.id)).toEqual(['cursor', 'devin']);
    expect(groups.folded).toEqual([]);
  });
});
