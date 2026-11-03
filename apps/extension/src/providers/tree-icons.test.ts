// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { CATEGORY_ICON_NAMES } from '@geld/core';
import { nativeTreeIcon } from './tree-icons';

describe('native category icon geometry', () => {
  it.each(['gitlab', 'bitbucket'] as const)('keeps every configured icon safely renderable with %s glyphs and a neutral explicit fallback', (provider) => {
    for (const icon of CATEGORY_ICON_NAMES) {
      const svg = nativeTreeIcon(provider, icon);
      expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
      expect(svg.getAttribute('viewBox')).toBe('0 0 16 16');
      expect(svg.getAttribute('data-geld-category-icon')).toBe(icon);
      expect(svg.getAttribute('data-geld-native-icon-provider')).toBe(provider);
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      expect(svg.getAttribute('focusable')).toBe('false');
      expect(svg.children.length).toBeGreaterThan(0);
      expect([...svg.children].every((node) => node.localName === 'path' && node.getAttribute('d') !== '')).toBe(true);
      expect(svg.querySelector('[id],use,script,title,[onclick],[href]')).toBeNull();
      expect(svg.outerHTML).not.toMatch(/octicon|primer|https?:\/\//);
    }
    const unsupported = nativeTreeIcon(provider, 'ruby');
    expect(unsupported.hasAttribute('data-geld-native-icon-fallback')).toBe(true);
    expect(unsupported.getAttribute('data-geld-native-icon')).toBe(provider === 'gitlab' ? 'document' : 'file');
  });

  it('matches the actually observed Bitbucket Directory chevron instead of inventing a folder silhouette', () => {
    // Captured native public PR27 #file-tree button[aria-expanded=true], installed run41324062794.
    const observed = 'm14.53 6.03-6 6a.75.75 0 0 1-1.004.052l-.056-.052-6-6 1.06-1.06L8 10.44l5.47-5.47z';
    expect(nativeTreeIcon('bitbucket', 'folder-open').querySelector('path')?.getAttribute('d')).toBe(observed);
    expect(nativeTreeIcon('bitbucket', 'folder-closed').querySelector('path')?.getAttribute('d')).not.toBe(observed);
  });
});
