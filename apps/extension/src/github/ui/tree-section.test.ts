import type { DirNode, TreeNode } from './tree-section';
import { buildTree, sortedChildren } from './tree-section';

const file = (path: string) => ({ path, available: true, statusIcon: null });

function outline(dir: DirNode, depth = 0): string[] {
  const lines: string[] = [];
  for (const child of sortedChildren(dir)) {
    lines.push(`${'  '.repeat(depth)}${child.kind === 'dir' ? `${child.name}/` : child.name}`);
    if (child.kind === 'dir') lines.push(...outline(child, depth + 1));
  }
  return lines;
}

describe('buildTree', () => {
  it('nests files under their directories and merges single-child directory chains', () => {
    const tree = buildTree([
      file('packages/wxt/e2e/tests/init.test.ts'),
      file('packages/wxt/e2e/tests/zip.test.ts'),
      file('packages/wxt/e2e/utils.ts'),
      file('packages/wxt/src/core/package-managers/__tests__/npm.test.ts'),
      file('vitest.config.ts'),
    ]);
    expect(outline(tree)).toEqual([
      'packages/wxt/',
      '  e2e/',
      '    tests/',
      '      init.test.ts',
      '      zip.test.ts',
      '    utils.ts',
      '  src/core/package-managers/__tests__/',
      '    npm.test.ts',
      'vitest.config.ts',
    ]);
  });

  it('keeps merged directory paths addressable for collapse state', () => {
    const tree = buildTree([file('a/b/c/d.test.ts')]);
    const merged = sortedChildren(tree)[0] as TreeNode;
    expect(merged.kind).toBe('dir');
    if (merged.kind === 'dir') {
      expect(merged.name).toBe('a/b/c');
      expect(merged.path).toBe('a/b/c');
    }
  });

  it('sorts names naturally and case-insensitively like a file browser', () => {
    const tree = buildTree([file('Zeta.test.ts'), file('alpha.test.ts'), file('file10.test.ts'), file('file2.test.ts')]);
    expect(outline(tree)).toEqual(['alpha.test.ts', 'file2.test.ts', 'file10.test.ts', 'Zeta.test.ts']);
  });
});
