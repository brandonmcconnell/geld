import { describe, expect, it } from 'vitest';
import { likelyFirst } from './panel';

const entry = (id: string, likely: boolean): { readonly id: string; readonly likely: boolean } => ({ id, likely });

describe('likelyFirst', () => {
  it('keeps the rest folded when the only likely entry is the row’s own button', () => {
    const groups = likelyFirst([entry('codex', true), entry('cursor', false), entry('devin', false)]);
    expect(groups.first.map((each) => each.id)).toEqual(['codex']);
    expect(groups.folded.map((each) => each.id)).toEqual(['cursor', 'devin']);
  });

  it('lists everything when nothing is likely', () => {
    const groups = likelyFirst([entry('cursor', false), entry('devin', false)]);
    expect(groups.first.map((each) => each.id)).toEqual(['cursor', 'devin']);
    expect(groups.folded).toEqual([]);
  });
});
