// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { nodeIdOf } from './edit-times';

describe('nodeIdOf', () => {
  it('builds the node ids GitHub serves edit logs under, from the anchor and the repository id', () => {
    // Read from geld#146's own "edited" menus (Nov 2026).
    expect(nodeIdOf('issuecomment-6559233642', 1357541534)).toBe('IC_kwDOUOpwns8AAAABhvX2ag');
    expect(nodeIdOf('discussion_r4436018770', 1357541534)).toBe('PRRC_kwDOUOpwns8AAAABCGhGUg');
  });

  it('packs small numbers in their shortest form', () => {
    // [0, 300, 42]: 0x93 0x00 0xcd 0x01 0x2c 0x2a.
    expect(nodeIdOf('pullrequestreview-42', 300)).toBe(`PRR_${btoa(String.fromCharCode(0x93, 0x00, 0xcd, 0x01, 0x2c, 0x2a)).replace(/=+$/, '')}`);
  });

  it('has no id for an anchor that is not a comment, or without a repository', () => {
    expect(nodeIdOf('event-123', 1357541534)).toBeNull();
    expect(nodeIdOf('issuecomment-1', Number.NaN)).toBeNull();
  });
});
