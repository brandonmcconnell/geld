import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

/** Stylesheet blocks that components depend on by name; a rewrite that drops one breaks a feature silently. */
describe('globals.css', () => {
  it.each([
    ['subnav-label', /@utility subnav-label\b/],
    ['subnav keyframes', /@keyframes subnav-in-down\b[\s\S]*@keyframes subnav-out-up\b/],
    ['header-brand', /@utility header-brand\b/],
    ['geld-corners', /@utility geld-corners\b/],
    ['route transition', /::view-transition-old\(root\)[\s\S]*::view-transition-new\(root\)/],
    ['route-in fallback', /\[data-route-entering\] main/],
  ])('still defines %s', (_name, pattern) => {
    expect(css).toMatch(pattern);
  });
});
