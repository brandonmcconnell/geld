import type { CategoryIconName } from '@geld/core';
import type { ReviewProvider } from './types';
import { BITBUCKET_CATEGORY_GLYPHS, BITBUCKET_TREE_GLYPHS, GITLAB_CATEGORY_GLYPHS, GITLAB_TREE_GLYPHS } from './tree-icons-data';
import type { NativeTreeGlyph } from './tree-icons-data';

export type NativeTreeIcon = CategoryIconName | 'essential' | 'folder-open' | 'folder-closed';

/** Provider-owned glyph geometry, never a Primer fallback or an external sprite fetch. */
export function nativeTreeIcon(provider: ReviewProvider, icon: NativeTreeIcon): SVGSVGElement {
  const special = icon === 'essential' || icon === 'folder-open' || icon === 'folder-closed';
  let glyph: NativeTreeGlyph;
  let fallback = false;
  if (provider === 'gitlab') {
    const name = special ? icon === 'essential' ? 'doc-changes' : icon === 'folder-open' ? 'folder-open' : 'folder' : GITLAB_CATEGORY_GLYPHS[icon];
    glyph = name === undefined ? GITLAB_TREE_GLYPHS.document : GITLAB_TREE_GLYPHS[name];
    fallback = name === undefined;
  } else {
    // The observed Bitbucket directory is a chevron, not a folder silhouette.
    const name = special ? icon === 'essential' ? 'changes' : icon === 'folder-open' ? 'chevron-down' : 'chevron-right' : BITBUCKET_CATEGORY_GLYPHS[icon];
    glyph = name === undefined ? BITBUCKET_TREE_GLYPHS.file : BITBUCKET_TREE_GLYPHS[name];
    fallback = name === undefined;
  }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', glyph.viewBox);
  svg.setAttribute('width', '16'); svg.setAttribute('height', '16');
  svg.setAttribute('fill', 'currentColor'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
  svg.classList.add('geld-provider-category-icon');
  svg.dataset.geldCategoryIcon = icon;
  svg.dataset.geldNativeIcon = glyph.name;
  svg.dataset.geldNativeIconProvider = provider;
  if (fallback) svg.dataset.geldNativeIconFallback = '';
  for (const shape of glyph.paths) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', shape.d);
    if (shape.fillRule !== undefined) path.setAttribute('fill-rule', shape.fillRule);
    if (shape.clipRule !== undefined) path.setAttribute('clip-rule', shape.clipRule);
    svg.append(path);
  }
  return svg;
}
