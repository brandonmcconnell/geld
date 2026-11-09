import { readFileSync } from 'node:fs';
import { banner, CELL_MARK_PATH, MARK_PATH, mark, outlines, word } from './logo';

const brand = (name: string): string[] =>
  [...readFileSync(new URL(`../../../assets/brand/${name}`, import.meta.url), 'utf8').matchAll(/\sd="([^"]+)"/g)].map((match) => match[1] ?? '');

describe('logo', () => {
  it('starts from the brand grid mark', () => {
    expect(brand('geld-logomark-grid.svg')).toEqual([MARK_PATH]);
  });

  it('moves only the cuts: the same corners in the same order, each within a unit or two of the brand', () => {
    const [brandShape = []] = outlines(MARK_PATH);
    const [cellShape = []] = outlines(CELL_MARK_PATH);
    expect(cellShape).toHaveLength(brandShape.length - 1);
    for (const [x, y] of cellShape) {
      expect(brandShape.some(([bx, by]) => Math.abs(bx - x) <= 1 && Math.abs(by - y) <= 1)).toBe(true);
    }
  });

  it('draws every cut as one straight diagonal, parallel to the others', () => {
    expect(mark()).toEqual([
      ' ◢████████████',
      '◢█◤           ',
      '██  ◢█████████',
      '██  ██      ██',
      '██  █████◤  ██',
      '██         ◢█◤',
      '████████████◤ ',
    ]);
  });

  it('draws the same cuts with the Powerline triangles, which terminals fit to the cell', () => {
    expect(mark('powerline').slice(0, 2)).toEqual([' \u{E0BA}████████████', '\u{E0BA}█\u{E0BC}           ']);
    expect(mark('powerline')[5]).toBe('██         \u{E0BA}█\u{E0BC}');
    expect(mark('powerline').join('')).not.toMatch(/[◢◣◤◥]/);
  });

  it('keeps the stepped mark where the terminal draws no triangle itself', () => {
    expect(mark(null).join('')).not.toMatch(/[◢◣◤◥\u{E0B8}-\u{E0BF}]/u);
    expect(mark(null)).toHaveLength(7);
  });

  it('sets the word in three lines of one-pixel strokes', () => {
    expect(word()).toEqual([
      '▄▀▀▀▄   █▀▀▀▀   █      █▀▀▀▄',
      '█ ▄▄▄   █▄▄▄    █      █   █',
      '▀▄▄▄▀   █▄▄▄▄   █▄▄▄   █▄▄▄▀',
    ]);
  });

  it('centres the word on the mark when it fits, and shows the mark alone when not', () => {
    const wide = banner(80, 'Geld Nightly');
    expect(wide).toHaveLength(9);
    expect(wide[3]).toBe('██  ██      ██    █ ▄▄▄   █▄▄▄    █      █   █');
    expect(wide[8]).toBe('Geld Nightly');
    expect(banner(30, 'Geld Nightly').join('')).not.toContain('▄▀▀▀▄');
  });
});
