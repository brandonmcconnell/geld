import { describe, expect, it } from 'vitest';
import { readMark } from './mark-shape';

const SIZE = 40;

type Pixel = readonly [number, number, number, number];

function picture(paint: (x: number, y: number) => Pixel): Uint8ClampedArray {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) data.set(paint(x, y), (y * SIZE + x) * 4);
  }
  return data;
}

const CLEAR: Pixel = [0, 0, 0, 0];
const ORANGE: Pixel = [217, 119, 87, 255];
const BLACK: Pixel = [0, 0, 0, 255];
const WHITE: Pixel = [255, 255, 255, 255];
const PURPLE: Pixel = [120, 80, 220, 255];

const inDisc = (x: number, y: number): boolean => (x + 0.5 - SIZE / 2) ** 2 + (y + 0.5 - SIZE / 2) ** 2 <= (SIZE / 2) ** 2;
const inGlyph = (x: number, y: number): boolean => x >= 10 && x < 30 && y >= 10 && y < 30;

describe('readMark', () => {
  it('reads a full-bleed picture as a tile', () => {
    expect(readMark(picture(() => ORANGE), SIZE, SIZE)).toEqual({ shape: 'square', ink: null });
  });

  it('reads a tile with transparent rounded corners as a tile, not a cutout', () => {
    const rounded = picture((x, y) => ((x < 2 || x >= SIZE - 2) && (y < 2 || y >= SIZE - 2) ? CLEAR : ORANGE));
    expect(readMark(rounded, SIZE, SIZE).shape).toBe('square');
  });

  it('reads a disc on transparent corners as round', () => {
    expect(readMark(picture((x, y) => (inDisc(x, y) ? PURPLE : CLEAR)), SIZE, SIZE)).toEqual({ shape: 'round', ink: null });
  });

  it('reads a glyph that never reaches the edges as a cutout', () => {
    expect(readMark(picture((x, y) => (inGlyph(x, y) ? PURPLE : CLEAR)), SIZE, SIZE)).toEqual({ shape: 'cutout', ink: null });
  });

  it('notes near-black and near-white ink on a cutout', () => {
    expect(readMark(picture((x, y) => (inGlyph(x, y) ? BLACK : CLEAR)), SIZE, SIZE).ink).toBe('dark');
    expect(readMark(picture((x, y) => (inGlyph(x, y) ? WHITE : CLEAR)), SIZE, SIZE).ink).toBe('light');
  });

  it('falls back to a tile for pictures too small to read', () => {
    expect(readMark(new Uint8ClampedArray(4 * 4 * 4), 4, 4).shape).toBe('square');
  });
});
