import { describe, expect, it } from 'vitest';
import { ALTERNATES, STYLISTIC_SETS } from './alternates';
import { CODE_GROUPS } from './code-ligatures';
import { specimenPage } from './specimen';

describe('specimen', () => {
  const page = specimenPage('1.0.0', [0x41, 0x61, 0x301, 0x2192]);

  it('offers every stylistic set and character variant, on and off', () => {
    for (const tag of [...Object.keys(STYLISTIC_SETS), ...ALTERNATES.map((alt) => alt.cv)]) {
      expect(page).toContain(`<code>${tag}</code>`);
      expect(page).toContain(`font-feature-settings: '${tag}'`);
    }
  });

  it('shows every code ligature group', () => {
    for (const group of Object.values(CODE_GROUPS)) if (group.label) expect(page).toContain(group.label);
  });

  it('lays out the character set by block, marks on a dotted circle', () => {
    expect(page).toContain('Basic Latin <small>2</small>');
    expect(page).toContain('\u25cc\u0301');
    expect(page).toContain('4 characters');
  });

  it('loads the package CSS it ships with', () => {
    for (const css of ['geld-sans.css', 'geld-dark-sans.css', 'geld-features.css']) expect(page).toContain(`href="web/${css}"`);
  });
});
