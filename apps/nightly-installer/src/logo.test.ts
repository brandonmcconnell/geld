import { readFileSync } from 'node:fs';
import { banner, MARK_PATH, mark, word } from './logo';

const brand = (name: string): string[] =>
  [...readFileSync(new URL(`../../../assets/brand/${name}`, import.meta.url), 'utf8').matchAll(/\sd="([^"]+)"/g)].map((match) => match[1] ?? '');

describe('logo', () => {
  it('draws the brand grid mark itself', () => {
    expect(brand('geld-logomark-grid.svg')).toEqual([MARK_PATH]);
  });

  it('draws the mark in half blocks, every 45° cut an even step of square pixels', () => {
    expect(mark()).toEqual([
      ' ▄████████████',
      '██▀           ',
      '██  ██████████',
      '██  ██      ██',
      '██  █████▀  ██',
      '██        ▄██▀',
      '███████████▀  ',
    ]);
  });

  it('sets the word in three lines of one-pixel strokes', () => {
    expect(word()).toEqual([
      '▄▀▀▀▄   █▀▀▀▀   █      █▀▀▀▄',
      '█ ▄▄▄   █▄▄▄    █      █   █',
      '▀▄▄▄▀   █▄▄▄▄   █▄▄▄   █▄▄▄▀',
    ]);
  });

  it('uses only glyphs every terminal fits to the cell', () => {
    expect(banner(80, '').join('')).toMatch(/^[ █▀▄]*$/);
  });

  it('centres the word on the mark when it fits, and shows the mark alone when not', () => {
    const wide = banner(80, 'Geld Nightly');
    expect(wide).toHaveLength(9);
    expect(wide[3]).toBe('██  ██      ██    █ ▄▄▄   █▄▄▄    █      █   █');
    expect(wide[8]).toBe('Geld Nightly');
    expect(banner(30, 'Geld Nightly').join('')).not.toContain('▄▀▀▀▄');
  });
});
