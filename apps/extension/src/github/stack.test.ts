// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { parsePageStack, stackAnswer, stackRetryDue } from './stack';

const pull = (number: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ number, title: `Step ${number}`, state: 'OPEN', url: `/acme/web/pull/${number}`, headBranch: `step/${number}`, ...extra });

describe('parsePageStack', () => {
  it('reads GitHub’s stack: its number and page, where this pull request stands, every pull request with its state', () => {
    const stack = parsePageStack({ number: 193, position: 2, size: 3, repositoryOwnerLogin: 'acme', repositoryName: 'web', pulls: [pull(8, { isDraft: true }), pull(7), pull(6, { state: 'MERGED' })] }, '/acme/web/pull/7');
    expect(stack).toEqual({
      number: 193,
      path: '/acme/web/stack/193',
      position: 2,
      size: 3,
      pulls: [
        { number: 8, title: 'Step 8', state: 'draft', path: '/acme/web/pull/8', headBranch: 'step/8', current: false },
        { number: 7, title: 'Step 7', state: 'open', path: '/acme/web/pull/7', headBranch: 'step/7', current: true },
        { number: 6, title: 'Step 6', state: 'merged', path: '/acme/web/pull/6', headBranch: 'step/6', current: false },
      ],
    });
  });

  it('reads no stack that does not hold this pull request, or that it cannot read whole', () => {
    expect(parsePageStack({ number: 1, pulls: [pull(8)] }, '/acme/web/pull/7')).toBeNull();
    expect(parsePageStack({ number: 1, pulls: [pull(7), { number: 8 }] }, '/acme/web/pull/7')).toBeNull();
    expect(parsePageStack({ pulls: [pull(7)] }, '/acme/web/pull/7')).toBeNull();
    expect(parsePageStack({ number: 1, pulls: [pull(7)] }, '/acme/web/pull/7')?.path).toBe('/acme/web/stack/1');
  });

  it('asks page_data/stacks again only after a failure, waiting longer each time, and never once it answered', () => {
    const stacked = { stack: { number: 1, pulls: [pull(7)] } };
    expect(stackAnswer(stacked, '/acme/web/pull/7')).toMatchObject({ settled: true, stack: { number: 1 } });
    expect(stackAnswer({ stack: null }, '/acme/web/pull/7')).toEqual({ settled: true, stack: null });
    expect(stackAnswer(null, '/acme/web/pull/7')).toEqual({ settled: false });
    expect(stackAnswer({ stack: { number: 1, pulls: [pull(8)] } }, '/acme/web/pull/7')).toEqual({ settled: false });
    expect(stackRetryDue(0, 0, 1_000_000)).toBe(false);
    expect(stackRetryDue(1, 0, 14_999)).toBe(false);
    expect(stackRetryDue(1, 0, 15_000)).toBe(true);
    expect(stackRetryDue(2, 0, 29_999)).toBe(false);
    expect(stackRetryDue(3, 0, 60_000)).toBe(true);
    expect(stackRetryDue(4, 0, 1_000_000)).toBe(false);
  });
});
