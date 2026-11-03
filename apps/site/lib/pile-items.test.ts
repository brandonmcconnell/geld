import { describe, expect, it } from 'vitest';

import { digestOf, PILE_ITEMS, rowOf, setAsideAs } from './pile-items';

describe('the pile and its digest', () => {
  it('sets aside the files the matcher calls noise and keeps the rest to review', () => {
    expect(setAsideAs('pnpm-lock.yaml')?.id).toBe('generated');
    expect(setAsideAs('src/Button.test.tsx')?.id).toBe('tests');
    expect(setAsideAs('docs/button.mdx')?.id).toBe('docs');
    expect(setAsideAs('.github/workflows/ci.yml')?.id).toBe('tooling');
    expect(setAsideAs('src/Button.tsx')).toBeNull();
  });

  it('adds everything up into one calm view', () => {
    const digest = digestOf(PILE_ITEMS);
    expect(digest.files.map((file) => file.path)).toEqual(['src/Button.tsx', 'src/hooks/useToggle.ts', 'src/index.ts']);
    expect(digest.setAside).toBe(6);
    expect(digest.reviews).toEqual({ approved: ['mona'], changes: ['hubot'] });
    expect(digest.comments).toBe(4);
    expect(digest.commenters).toEqual(['mona', 'octocat', 'hubot', 'nadia']);
    expect(digest.needsYou).toBe(2);
    expect(digest.botComments).toBe(3);
    expect(digest.agent).toEqual({ score: 3, findings: 4 });
    expect(digest.checks).toEqual({ passed: 2, failed: 1, running: 1 });
    expect(digest.previews).toBe(1);
    expect(digest.security).toEqual([
      { text: '2 vulnerable deps', short: '2 deps' },
      { text: 'Coverage 84.2% (-1.3%)', short: 'Coverage 84.2%' },
    ]);
  });

  it('tallies only what has been gathered so far', () => {
    const digest = digestOf(PILE_ITEMS.slice(0, 4));
    expect(digest.files).toHaveLength(1);
    expect(digest.setAside).toBe(1);
    expect(digest.comments).toBe(1);
    expect(digest.checks.failed).toBe(1);
    expect(digest.agent).toBeNull();
  });

  it('gathers every item into a row of the card', () => {
    for (const item of PILE_ITEMS) expect(rowOf(item)).toBeTruthy();
  });
});
