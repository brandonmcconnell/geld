import { BAND_LENGTH, bandPosition, DOWNLOAD_MARK, iconKey, renderUpdateIcon, showUpdateIcon } from './update-icon';

const setIcon = vi.hoisted(() => vi.fn<(details: unknown) => Promise<void>>());
vi.mock('wxt/browser', () => ({ browser: { action: { setIcon }, runtime: { getURL: (path: string) => `chrome-extension://test${path}` } } }));

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Even-odd test against the mark, independent of the code under test's own. */
function inMark(x: number, y: number): boolean {
  let inside = false;
  for (let at = 0, before = DOWNLOAD_MARK.length - 1; at < DOWNLOAD_MARK.length; before = at++) {
    const [ax, ay] = DOWNLOAD_MARK[at] ?? [0, 0];
    const [bx, by] = DOWNLOAD_MARK[before] ?? [0, 0];
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

describe('bandPosition', () => {
  it('places every point of the mark on the band', () => {
    for (let x = 0.05; x < 14; x += 0.1) {
      for (let y = 0.05; y < 14; y += 0.1) {
        if (inMark(x, y)) expect(bandPosition(x, y), `${x.toFixed(2)}, ${y.toFixed(2)}`).not.toBeNull();
        else expect(bandPosition(x, y)).toBeNull();
      }
    }
  });

  it('runs from the outer end at the top right to the arrow tip', () => {
    const along = [
      [13.9, 1],
      [7, 1],
      [1, 7],
      [7, 13],
      [13, 9],
      [10, 5],
      [7, 7],
      [7, 10.8],
    ].map(([x, y]) => bandPosition(x ?? 0, y ?? 0) ?? -1);
    expect(along[0]).toBeLessThan(0.5);
    for (let at = 1; at < along.length; at++) expect(along[at]).toBeGreaterThan(along[at - 1] ?? 0);
    expect(along.at(-1)).toBeGreaterThan(BAND_LENGTH - 0.5);
  });

  it('has filled the corners the 45° cuts widen once the front is three units past the turn', () => {
    // The top-left turn is 13 units in, its inner cut running from (4, 2) to (2, 4); the bottom right's is 37 in.
    for (const [x, y] of [
      [2.95, 2.9],
      [2.9, 2.95],
      [3.5, 2.4],
      [2.4, 3.5],
    ] as const)
      expect(bandPosition(x, y)).toBeLessThan(13 + 3);
    for (const [x, y] of [
      [11.1, 11.05],
      [11.05, 11.1],
    ] as const)
      expect(bandPosition(x, y)).toBeLessThan(37 + 3);
  });

  it('ends the arrow in a point', () => {
    expect(bandPosition(7, 10.8)).not.toBeNull();
    expect(bandPosition(6.5, 10.8)).toBeNull();
    expect(bandPosition(7.5, 10.8)).toBeNull();
  });

  it('gives the arrow head to the last leg, not the bands beside it', () => {
    expect(bandPosition(4.2, 8.1)).toBeGreaterThan(BAND_LENGTH - 3);
    expect(bandPosition(9.9, 8.05)).toBeGreaterThan(BAND_LENGTH - 3);
  });
});

/** How much black a pixel holds, read back from the green and white it would be made of. */
function blackShare(pixels: Uint8ClampedArray, at: number): number {
  const red = pixels[at] ?? 0;
  const green = pixels[at + 1] ?? 0;
  // On the line from green (26, 127) to white (255, 255), red and green move together.
  return Math.abs((red - 26) / (255 - 26) - (green - 127) / (255 - 127));
}

describe('renderUpdateIcon', () => {
  for (const size of [16, 32, 48]) {
    it(`leaves no black at all once done, at ${size}px`, () => {
      const pixels = renderUpdateIcon(size, 1);
      for (let at = 0; at < pixels.length; at += 4) if ((pixels[at + 3] ?? 0) > 0) expect(blackShare(pixels, at)).toBeLessThan(0.02);
    });

    it(`has no green before it starts, at ${size}px`, () => {
      const pixels = renderUpdateIcon(size, 0);
      for (let at = 0; at < pixels.length; at += 4) {
        expect(pixels[at]).toBe(pixels[at + 1]);
        expect(pixels[at + 1]).toBe(pixels[at + 2]);
      }
    });
  }

  it('is part green and part black halfway', () => {
    const pixels = renderUpdateIcon(32, 0.5);
    let green = 0;
    let black = 0;
    for (let at = 0; at < pixels.length; at += 4) {
      if ((pixels[at + 3] ?? 0) < 255) continue;
      if (pixels[at] === 26 && pixels[at + 1] === 127) green++;
      if (pixels[at] === 0 && pixels[at + 1] === 0) black++;
    }
    expect(green).toBeGreaterThan(50);
    expect(black).toBeGreaterThan(50);
  });
});

describe('iconKey', () => {
  it('repaints a download only when its whole percent changes', () => {
    expect(iconKey({ kind: 'progress', share: 0.421 })).toBe(iconKey({ kind: 'progress', share: 0.4249 }));
    expect(iconKey({ kind: 'progress', share: 0.43 })).not.toBe(iconKey({ kind: 'progress', share: 0.42 }));
  });
});

describe('showUpdateIcon', () => {
  it('paints a state again when the paint before failed, and only once more', async () => {
    setIcon.mockRejectedValueOnce(new Error('No icon')).mockResolvedValue(undefined);
    showUpdateIcon({ kind: 'plain' });
    await settle();
    expect(setIcon).toHaveBeenCalledTimes(1);
    showUpdateIcon({ kind: 'plain' });
    await settle();
    expect(setIcon).toHaveBeenCalledTimes(2);
    showUpdateIcon({ kind: 'plain' });
    await settle();
    expect(setIcon).toHaveBeenCalledTimes(2);
  });
});
