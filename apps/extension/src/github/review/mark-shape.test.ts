import { describe, expect, it } from 'vitest';
import { readMark } from './mark-shape';

const SIZE = 40;

type Pixel = readonly [number, number, number, number];

function pictureOf(size: number, paint: (x: number, y: number) => Pixel): Uint8ClampedArray {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) data.set(paint(x, y), (y * size + x) * 4);
  }
  return data;
}

function picture(paint: (x: number, y: number) => Pixel): Uint8ClampedArray {
  return pictureOf(SIZE, paint);
}

const CLEAR: Pixel = [0, 0, 0, 0];
const ORANGE: Pixel = [217, 119, 87, 255];
const BLACK: Pixel = [0, 0, 0, 255];
const WHITE: Pixel = [255, 255, 255, 255];
const PURPLE: Pixel = [120, 80, 220, 255];
const PINK: Pixel = [236, 72, 153, 255];

const inDisc = (x: number, y: number): boolean => (x + 0.5 - SIZE / 2) ** 2 + (y + 0.5 - SIZE / 2) ** 2 <= (SIZE / 2) ** 2;
const inGlyph = (x: number, y: number): boolean => x >= 10 && x < 30 && y >= 10 && y < 30;
const inBar = (x: number): boolean => x >= 18 && x < 22;
const inRing = (x: number, y: number): boolean => {
  const distance = (x + 0.5 - SIZE / 2) ** 2 + (y + 0.5 - SIZE / 2) ** 2;
  return distance <= (SIZE / 2) ** 2 && distance >= (SIZE / 2 - 4) ** 2 && !(x < 4 || x >= SIZE - 4);
};
const inDiscOf = (size: number) => (x: number, y: number): boolean => (x + 0.5 - size / 2) ** 2 + (y + 0.5 - size / 2) ** 2 <= (size / 2) ** 2;
const inRoundedTileOf = (size: number) => (x: number, y: number): boolean => {
  const radius = size * 0.22;
  const dx = Math.max(radius - (x + 0.5), x + 0.5 - (size - radius), 0);
  const dy = Math.max(radius - (y + 0.5), y + 0.5 - (size - radius), 0);
  return dx ** 2 + dy ** 2 <= radius ** 2;
};
const inEarOf = (size: number) => (x: number, y: number): boolean => x >= size * 0.7 && x < size * 0.925 && y >= size * 0.075 && y < size * 0.3;
const inOblong = (x: number, y: number): boolean => ((x + 0.5 - SIZE / 2) / 17) ** 2 + ((y + 0.5 - SIZE / 2) / 20) ** 2 <= 1;

describe('readMark', () => {
  it('reads a full-bleed picture as a tile', () => {
    expect(readMark(picture(() => ORANGE), SIZE, SIZE)).toEqual({ shape: 'square', ink: null, ground: null, inset: 0 });
  });

  it('reads a tile with transparent rounded corners as a tile, not a cutout', () => {
    const rounded = picture((x, y) => ((x < 2 || x >= SIZE - 2) && (y < 2 || y >= SIZE - 2) ? CLEAR : ORANGE));
    expect(readMark(rounded, SIZE, SIZE).shape).toBe('square');
  });

  it('reads a disc on transparent corners as round', () => {
    expect(readMark(picture((x, y) => (inDisc(x, y) ? PURPLE : CLEAR)), SIZE, SIZE)).toEqual({ shape: 'round', ink: null, ground: null, inset: 0 });
  });

  it('reads a shape that touches every edge with free corners as a cutout, not a disc or a tile', () => {
    const inEar = (x: number, y: number): boolean => x >= 28 && x < 37 && y >= 3 && y < 12;
    expect(readMark(picture((x, y) => (inDisc(x, y) || inEar(x, y) ? PURPLE : CLEAR)), SIZE, SIZE).shape).toBe('cutout');
  });

  // GitHub serves an App's avatar at several sizes, and a reading that changes with the size changes the frame.
  it.each([20, 32, 64, 80])('reads discs, rounded tiles and free-edged shapes the same at %dpx', (size) => {
    const disc = inDiscOf(size);
    const ear = inEarOf(size);
    expect(readMark(pictureOf(size, (x, y) => (disc(x, y) ? PURPLE : CLEAR)), size, size).shape).toBe('round');
    expect(readMark(pictureOf(size, (x, y) => (inRoundedTileOf(size)(x, y) ? ORANGE : CLEAR)), size, size).shape).toBe('square');
    expect(readMark(pictureOf(size, (x, y) => (disc(x, y) || ear(x, y) ? PURPLE : CLEAR)), size, size).shape).toBe('cutout');
  });

  it('reads a glyph that never reaches the edges as a cutout that needs no padding', () => {
    expect(readMark(picture((x, y) => (inGlyph(x, y) ? PURPLE : CLEAR)), SIZE, SIZE)).toEqual({ shape: 'cutout', ink: null, ground: null, inset: 0 });
  });

  it('pads a glyph whose strokes reach the edges in to a tenth of the tile', () => {
    expect(readMark(picture((x) => (inBar(x) ? BLACK : CLEAR)), SIZE, SIZE)).toEqual({ shape: 'cutout', ink: 'dark', ground: null, inset: 0.1 });
  });

  it('pads only what a glyph near the edge lacks', () => {
    const near = picture((x, y) => (x >= 2 && x < 38 && y >= 2 && y < 38 && (x < 6 || y < 6) ? PURPLE : CLEAR));
    const reading = readMark(near, SIZE, SIZE);
    expect(reading.ground).toBeNull();
    expect(reading.inset).toBeCloseTo((0.1 - 0.05) / 0.9, 3);
  });

  it('gives a solid blob that falls short of a tile its own edge colour as ground', () => {
    expect(readMark(picture((x, y) => (inOblong(x, y) ? PINK : CLEAR)), SIZE, SIZE)).toEqual({ shape: 'cutout', ink: null, ground: 'rgb(236 72 153)', inset: 0 });
  });

  it('gives no ground to a blob whose edge is several colours', () => {
    const split = picture((x, y) => (inOblong(x, y) ? (y < SIZE / 2 ? PINK : PURPLE) : CLEAR));
    expect(readMark(split, SIZE, SIZE)).toMatchObject({ shape: 'cutout', ground: null, inset: 0.1 });
  });

  it('gives no ground to an outline, however much of the tile it spans', () => {
    expect(readMark(picture((x, y) => (inRing(x, y) ? PINK : CLEAR)), SIZE, SIZE)).toMatchObject({ shape: 'cutout', ground: null });
  });

  it('notes near-black and near-white ink on a cutout', () => {
    expect(readMark(picture((x, y) => (inGlyph(x, y) ? BLACK : CLEAR)), SIZE, SIZE).ink).toBe('dark');
    expect(readMark(picture((x, y) => (inGlyph(x, y) ? WHITE : CLEAR)), SIZE, SIZE).ink).toBe('light');
  });

  it('falls back to a tile for pictures too small to read', () => {
    expect(readMark(new Uint8ClampedArray(4 * 4 * 4), 4, 4).shape).toBe('square');
  });
});
