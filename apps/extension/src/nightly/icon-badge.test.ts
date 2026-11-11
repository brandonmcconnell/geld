import { badgeGeometry, badgeKey, showIconBadge } from './icon-badge';

const setIcon = vi.hoisted(() => vi.fn<(details: unknown) => Promise<void>>());
vi.mock('wxt/browser', () => ({ browser: { action: { setIcon }, runtime: { getURL: (path: string) => `chrome-extension://test${path}` } } }));

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('showIconBadge', () => {
  it('paints a state again when the paint before failed, and only once more', async () => {
    setIcon.mockRejectedValueOnce(new Error('No icon')).mockResolvedValue(undefined);
    showIconBadge({ kind: 'none' });
    await settle();
    expect(setIcon).toHaveBeenCalledTimes(1);
    showIconBadge({ kind: 'none' });
    await settle();
    expect(setIcon).toHaveBeenCalledTimes(2);
    showIconBadge({ kind: 'none' });
    await settle();
    expect(setIcon).toHaveBeenCalledTimes(2);
  });
});

describe('badgeKey', () => {
  it('repaints a download only when its whole percent changes', () => {
    expect(badgeKey({ kind: 'progress', share: 0.421 })).toBe(badgeKey({ kind: 'progress', share: 0.4249 }));
    expect(badgeKey({ kind: 'progress', share: 0.43 })).not.toBe(badgeKey({ kind: 'progress', share: 0.42 }));
  });

  it('keeps a share past either end on the ring', () => {
    expect(badgeKey({ kind: 'progress', share: 1.3 })).toBe('progress:100');
    expect(badgeKey({ kind: 'progress', share: -0.2 })).toBe('progress:0');
  });
});

describe('badgeGeometry', () => {
  for (const size of [16, 32]) {
    it(`sits in the top right of a ${size}px icon, clear of the count Chrome draws at the bottom right`, () => {
      const { cx, cy, ring, ringWidth } = badgeGeometry(size, true);
      expect(cx + ring + ringWidth / 2).toBeCloseTo(size);
      expect(cy - ring - ringWidth / 2).toBeCloseTo(0);
      expect(cy).toBeLessThan(size / 2);
    });

    it(`keeps a gap between the disc and the ring at ${size}px`, () => {
      const { disc, ring, ringWidth } = badgeGeometry(size, true);
      expect(ring - ringWidth / 2 - disc).toBeGreaterThan(0);
    });
  }

  it('cuts the mark wider only while the ring shows', () => {
    const plain = badgeGeometry(16, false);
    const ringed = badgeGeometry(16, true);
    expect(plain.disc).toBe(ringed.disc);
    expect(ringed.cut).toBeGreaterThan(plain.cut);
    expect(plain.cut).toBeGreaterThan(plain.disc);
  });
});
