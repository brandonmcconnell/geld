// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { removeStuckStatus, syncStuckStatus } from './stuck-status';

const loadingCard = (): HTMLElement => {
  document.body.innerHTML = `<div class="CondensedForYouContainer__x"><section aria-label="Recommended action"><ul><li class="Container__x" data-testid="for-you-item-row" data-item-id="loading"><div class="Row__x"><div class="Title__x">Checking whether “works on my machine” applies here…</div></div></li></ul></section></div>`;
  const row = document.querySelector<HTMLElement>('[data-item-id="loading"]');
  if (row === null) throw new Error('no loading row');
  return row;
};

const own = { own: true, files: ['packages/review/src/ai-client.test.ts'], pull: null };
const stacked = { own: false, files: [], pull: { number: 705, path: '/brandonmcconnell/geld/pull/705' } };

describe('syncStuckStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    removeStuckStatus();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('leaves GitHub’s loading row alone until it has stood a while', () => {
    loadingCard();
    syncStuckStatus(own);
    expect(document.querySelector('.geld-stuck-status')).toBeNull();
    vi.advanceTimersByTime(3000);
    syncStuckStatus(own);
    expect(document.querySelector('.geld-stuck-status')).toBeNull();
  });

  it('stands in for a stuck loading row with the pull request’s own conflict, as GitHub words it', () => {
    const loading = loadingCard();
    syncStuckStatus(own);
    vi.advanceTimersByTime(5100);
    const row = document.querySelector('.geld-stuck-status');
    expect(row?.textContent).toBe('Merge conflictsResolve the merge conflicts before this can merge.Resolve conflicts');
    expect(row?.nextElementSibling).toBe(loading);
    expect(row?.className).toContain('Container__x');
    expect(loading.hasAttribute('data-geld-stuck-hidden')).toBe(true);
  });

  it('names the pull request down the stack whose conflict blocks this one', () => {
    loadingCard();
    syncStuckStatus(stacked);
    vi.advanceTimersByTime(5100);
    const row = document.querySelector('.geld-stuck-status');
    expect(row?.querySelector('.geld-stuck-status__title')?.textContent).toBe('Merge conflicts in the stack');
    expect(row?.querySelector('.geld-stuck-status__subtext')?.textContent).toBe('Resolve the merge conflicts in #705 before this can merge.');
    expect(row?.querySelector('a')?.getAttribute('href')).toBe('/brandonmcconnell/geld/pull/705');
  });

  it('gives way the moment GitHub answers with a row of its own', () => {
    const loading = loadingCard();
    syncStuckStatus(own);
    vi.advanceTimersByTime(5100);
    expect(document.querySelector('.geld-stuck-status')).not.toBeNull();
    const answer = document.createElement('li');
    answer.setAttribute('data-testid', 'for-you-item-row');
    answer.setAttribute('data-item-id', 'merge-conflicts');
    loading.replaceWith(answer);
    syncStuckStatus(own);
    expect(document.querySelector('.geld-stuck-status')).toBeNull();
  });

  it('draws nothing while the merge box states no conflict', () => {
    const loading = loadingCard();
    syncStuckStatus(null);
    vi.advanceTimersByTime(6000);
    syncStuckStatus(null);
    expect(document.querySelector('.geld-stuck-status')).toBeNull();
    expect(loading.hasAttribute('data-geld-stuck-hidden')).toBe(false);
  });
});
