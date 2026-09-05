import { describe, expect, it } from 'vitest';

import { safeNextPath } from './redirect';

describe('safeNextPath', () => {
  it('keeps same-site relative paths', () => {
    expect(safeNextPath('/settings')).toBe('/settings');
    expect(safeNextPath('/settings#custom-patterns')).toBe('/settings#custom-patterns');
    expect(safeNextPath('/faq?x=1')).toBe('/faq?x=1');
  });

  it('refuses anything that could leave the site', () => {
    for (const bad of [null, undefined, '', 'settings', 'https://evil.example', '//evil.example', '/\\evil.example', '/x://y', '/a b', '/auth', '/auth/start', '/auth?code=1']) {
      expect(safeNextPath(bad)).toBe('/settings');
    }
  });
});
