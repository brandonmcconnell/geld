import { readFileSync } from 'node:fs';
import { banner, MARK_PATH, mark, wordmark, WORDMARK_PATHS } from './logo';

const brand = (name: string): string[] =>
  [...readFileSync(new URL(`../../../assets/brand/${name}`, import.meta.url), 'utf8').matchAll(/\sd="([^"]+)"/g)].map((match) => match[1] ?? '');

describe('logo', () => {
  it('draws from the brand files themselves', () => {
    expect(brand('geld-logomark-grid.svg')).toEqual([MARK_PATH]);
    expect(brand('geld-logo.svg').slice(1)).toEqual(WORDMARK_PATHS);
  });

  it('draws the grid mark on whole cells, 45° cuts included', () => {
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

  it('draws the wordmark at the mark height, holes open', () => {
    const lines = wordmark();
    expect(lines).toHaveLength(7);
    expect(lines[0]).toBe('▄█████████▄       ███████████      ██              ██████████▄ ');
    expect(lines[3]).toBe('██   ▄▄▄▄▄▄▄      ██████████       ██              ██        ██');
  });

  it('puts the word beside the mark when there is room, and only the mark with its caption when not', () => {
    expect(banner(80, 'Geld Nightly')).toHaveLength(9);
    expect(banner(80, 'Geld Nightly')[0]).toBe(` ▄████████████   ${wordmark()[0] ?? ''}`);
    const narrow = banner(40, 'Geld Nightly');
    expect(narrow).toHaveLength(7);
    expect(narrow[3]).toBe('██  ██      ██   Geld Nightly');
  });
});
