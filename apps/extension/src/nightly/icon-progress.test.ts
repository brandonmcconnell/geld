import { progressKey, showIconProgress, SPIRAL, spiralTo } from './icon-progress';

const setIcon = vi.hoisted(() => vi.fn<(details: unknown) => Promise<void>>());
vi.mock('wxt/browser', () => ({ browser: { action: { setIcon }, runtime: { getURL: (path: string) => `chrome-extension://test${path}` } } }));

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('spiralTo', () => {
  it('starts at the top right and ends at the centre', () => {
    expect(spiralTo(0)).toEqual([]);
    expect(spiralTo(1)).toEqual(SPIRAL);
  });

  it('fills the top band first, from the right', () => {
    // The spiral is 62 units long and its first leg, along the top, is 13.
    expect(spiralTo(6.5 / 62)).toEqual([
      [14, 1],
      [7.5, 1],
    ]);
  });

  it('ends partway along the leg it reached', () => {
    const points = spiralTo(0.5);
    expect(points.slice(0, -1)).toEqual(SPIRAL.slice(0, points.length - 1));
    // 31 of 62 units: the top (13) and the left side (12), then 6 along the bottom.
    expect(points.at(-1)).toEqual([7, 13]);
  });

  it('keeps a share past either end on the mark', () => {
    expect(spiralTo(-1)).toEqual([]);
    expect(spiralTo(2)).toEqual(SPIRAL);
  });
});

describe('progressKey', () => {
  it('repaints a download only when its whole percent changes', () => {
    expect(progressKey(0.421)).toBe(progressKey(0.4249));
    expect(progressKey(0.43)).not.toBe(progressKey(0.42));
    expect(progressKey(null)).toBe('none');
  });
});

describe('showIconProgress', () => {
  it('paints a state again when the paint before failed, and only once more', async () => {
    setIcon.mockRejectedValueOnce(new Error('No icon')).mockResolvedValue(undefined);
    showIconProgress(null);
    await settle();
    expect(setIcon).toHaveBeenCalledTimes(1);
    showIconProgress(null);
    await settle();
    expect(setIcon).toHaveBeenCalledTimes(2);
    showIconProgress(null);
    await settle();
    expect(setIcon).toHaveBeenCalledTimes(2);
  });
});
