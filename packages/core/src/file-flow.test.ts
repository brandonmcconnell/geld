import { describe, expect, it } from 'vitest';
import { canReadImports, closestSpaced, flowEdges, importSpecifiers, layoutFlow, resolveImport } from './file-flow';

describe('importSpecifiers', () => {
  it('reads every way a script names a module', () => {
    const text = [
      "import { a, type B } from './a';",
      "import type { C } from '../types';",
      "import Default, * as ns from '@/components/card';",
      "import './side-effect.css';",
      "export * from './barrel';",
      "export { d as e } from './d.js';",
      "const lazy = await import('./lazy');",
      "const old = require('./legacy');",
      'import {',
      '  multi,',
      '  line,',
      "} from './multi';",
    ].join('\n');
    expect(importSpecifiers('src/x.ts', text)).toEqual(['./a', '../types', '@/components/card', './side-effect.css', './multi', './barrel', './d.js', './lazy', './legacy']);
  });

  it('reads styles, Python and Rust', () => {
    expect(importSpecifiers('a.scss', "@use 'sass:math';\n@import 'tokens';\n@forward \"./mixins\";\n@import url(base.css);")).toEqual(['sass:math', 'tokens', './mixins', 'base.css']);
    expect(importSpecifiers('pkg/views.py', 'from .models import User\nfrom ..core.db import session\nimport os, pkg.util as util\n')).toEqual(['.models', '.models.User', '..core.db', '..core.db.session', 'os', 'pkg.util']);
    expect(importSpecifiers('src/lib.rs', 'pub mod flow;\nmod parse;\nuse std::io;')).toEqual(['mod:flow', 'mod:parse']);
  });

  it('reads past comments and strings that only mention an import', () => {
    const text = [
      "// import './commented'",
      "/* import './blocked' */",
      "const example = \"import x from './in-a-string'\";",
      'const template = `require("./in-a-template")`;',
      "import { real } from './real'; // trailing comment",
      "const url = 'https://example.com/import'; import('./lazy')",
    ].join('\n');
    expect(importSpecifiers('src/x.ts', text)).toEqual(['./real', './lazy']);
    expect(importSpecifiers('a.scss', "// @import 'old';\n/* @use 'gone'; */\n@import url(https://fonts.example/x.css);\n@use 'kept';")).toEqual(['https://fonts.example/x.css', 'kept']);
    expect(importSpecifiers('pkg/x.py', '# from .old import a\n"""\nfrom .doc import b\n"""\nfrom .real import c\n')).toEqual(['.real', '.real.c']);
  });

  it('reads the modules a Python relative import lists', () => {
    expect(importSpecifiers('pkg/view.py', 'from . import helper, models as m\nfrom .api import (\n  client,\n  types,\n)\nfrom x import *\n')).toEqual(['.', '.helper', '.models', '.api', '.api.client', '.api.types', 'x']);
    const known = new Set(['pkg/helper.py', 'pkg/api/client.py']);
    expect(resolveImport('pkg/view.py', '.helper', known)).toBe('pkg/helper.py');
    expect(resolveImport('pkg/view.py', '.api.client', known)).toBe('pkg/api/client.py');
  });

  it('knows which files it can read', () => {
    expect(canReadImports('a/b.tsx')).toBe(true);
    expect(canReadImports('README.md')).toBe(false);
    expect(importSpecifiers('pnpm-lock.yaml', "import x from './y'")).toEqual([]);
  });
});

describe('resolveImport', () => {
  const known = new Set(['src/step.ts', 'src/capy.ts', 'src/lib/index.ts', 'src/ui/card.tsx', 'web/ui/card.tsx', 'src/styles/_tokens.scss', 'pkg/models.py', 'pkg/core/db.py', 'pkg/util/__init__.py', 'src/flow.rs', 'src/parse/mod.rs']);

  it('follows relative paths, extensions and index files', () => {
    expect(resolveImport('src/capy.ts', './step', known)).toBe('src/step.ts');
    expect(resolveImport('src/capy.ts', './step.js', known)).toBe('src/step.ts');
    expect(resolveImport('src/ui/card.tsx', '../lib', known)).toBe('src/lib/index.ts');
    expect(resolveImport('src/capy.ts', './missing', known)).toBeNull();
    expect(resolveImport('src/capy.ts', 'react', known)).toBeNull();
  });

  it('matches an alias by its tail only when one file fits', () => {
    expect(resolveImport('src/capy.ts', '@/lib', known)).toBe('src/lib/index.ts');
    expect(resolveImport('src/capy.ts', '@/ui/card', known)).toBeNull();
    expect(resolveImport('src/capy.ts', '@scope/ui/card', known)).toBeNull();
  });

  it('finds Sass partials, Python modules and Rust mods', () => {
    expect(resolveImport('src/styles/main.scss', 'tokens', known)).toBe('src/styles/_tokens.scss');
    expect(resolveImport('pkg/views.py', '.models', known)).toBe('pkg/models.py');
    expect(resolveImport('pkg/api/views.py', '..core.db', known)).toBe('pkg/core/db.py');
    expect(resolveImport('pkg/views.py', 'pkg.util', known)).toBe('pkg/util/__init__.py');
    expect(resolveImport('src/lib.rs', 'mod:flow', known)).toBe('src/flow.rs');
    expect(resolveImport('src/lib.rs', 'mod:parse', known)).toBe('src/parse/mod.rs');
  });
});

describe('flowEdges', () => {
  it('links changed files and marks links only the base had', () => {
    const paths = ['src/a.ts', 'src/b.ts', 'src/gone.ts'];
    const after = new Map([
      ['src/a.ts', "import { b } from './b';"],
      ['src/b.ts', "import x from 'lodash';"],
    ]);
    const before = new Map([
      ['src/a.ts', "import { b } from './b';\nimport { g } from './gone';"],
      ['src/gone.ts', "import { b } from './b';"],
    ]);
    expect(flowEdges(paths, after, before, new Set(['src/gone.ts']))).toEqual([
      { from: 'src/a.ts', to: 'src/b.ts' },
      { from: 'src/a.ts', to: 'src/gone.ts', removed: true },
      { from: 'src/gone.ts', to: 'src/b.ts', removed: true },
    ]);
  });
});

describe('closestSpaced', () => {
  it('keeps the wanted positions when they are far enough apart', () => {
    expect(closestSpaced([0, 2, 5], [1, 1])).toEqual([0, 2, 5]);
  });

  it('spreads a crowd around where it wanted to be, not to one side', () => {
    expect(closestSpaced([3, 3, 3], [1, 1])).toEqual([2, 3, 4]);
  });
});

describe('flowEdges with unread files', () => {
  it('does not call the imports of a file it could not read removed', () => {
    const paths = ['src/a.ts', 'src/b.ts', 'src/gone.ts'];
    const before = new Map([['src/a.ts', "import { b } from './b';"]]);
    expect(flowEdges(paths, new Map(), before, new Set(['src/gone.ts']))).toEqual([]);
  });
});

describe('layoutFlow', () => {
  it('puts importers above imports and keeps loose files apart', () => {
    const layout = layoutFlow(['a', 'b', 'c', 'lonely'], [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'a', to: 'c' },
    ]);
    expect(layout.loose).toEqual(['lonely']);
    expect(layout.components).toHaveLength(1);
    const [component] = layout.components;
    const rowOf = (path: string): number => component?.rows.findIndex((row) => row.some((slot) => slot.kind === 'file' && slot.path === path)) ?? -1;
    expect([rowOf('a'), rowOf('b'), rowOf('c')]).toEqual([0, 1, 2]);
    expect(component?.routes.map((route) => `${route.edge.from}>${route.edge.to}`)).toEqual(['a>b', 'b>c']);
    expect(component?.implied).toBe(1);
  });

  it('routes a link that skips rows through bend points', () => {
    const [component] = layoutFlow(['a', 'b', 'c', 'd'], [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'a', to: 'd' },
      { from: 'd', to: 'c' },
      { from: 'a', to: 'c', removed: true },
    ]).components;
    const skip = component?.routes.find((route) => route.edge.from === 'a' && route.edge.to === 'c');
    expect(skip?.points.map((point) => point.row)).toEqual([0, 1, 2]);
    expect(component?.rows[1]?.some((slot) => slot.kind === 'bend')).toBe(true);
  });

  it('never overlaps files in a row', () => {
    const edges = ['b', 'c', 'd', 'e'].map((to) => ({ from: 'a', to }));
    const [component] = layoutFlow(['a', 'b', 'c', 'd', 'e'], edges).components;
    const row = component?.rows[1] ?? [];
    for (let index = 1; index < row.length; index++) {
      const previous = row[index - 1];
      const slot = row[index];
      if (previous !== undefined && slot !== undefined) expect(slot.x - previous.x).toBeGreaterThanOrEqual(1);
    }
  });

  it('draws a cycle without looping forever', () => {
    const layout = layoutFlow(['a', 'b'], [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'a' },
    ]);
    expect(layout.components[0]?.routes).toHaveLength(2);
    const back = layout.components[0]?.routes.find((route) => route.edge.from === 'b');
    expect(back?.points.map((point) => point.row)).toEqual([1, 0]);
  });

  it('pulls a file down beside what it imports', () => {
    const [component] = layoutFlow(['top', 'mid', 'leaf', 'late'], [
      { from: 'top', to: 'mid' },
      { from: 'mid', to: 'leaf' },
      { from: 'late', to: 'leaf' },
    ]).components;
    const rowOf = (path: string): number => component?.rows.findIndex((row) => row.some((slot) => slot.kind === 'file' && slot.path === path)) ?? -1;
    expect(rowOf('late')).toBe(rowOf('leaf') - 1);
  });

  it('keeps a wide fan of long links narrow', () => {
    const paths = ['root', 'deep', ...Array.from({ length: 30 }, (_, index) => `mid${index}`)];
    const edges = [
      ...Array.from({ length: 30 }, (_, index) => ({ from: 'root', to: `mid${index}` })),
      ...Array.from({ length: 30 }, (_, index) => ({ from: `mid${index}`, to: 'deep' })),
      { from: 'root', to: 'deep' },
    ];
    const [component] = layoutFlow(paths, edges).components;
    expect(component?.width).toBeLessThan(30 * 1.3);
  });

  it('lays out separate groups on their own, largest first', () => {
    const layout = layoutFlow(['x', 'y', 'p', 'q', 'r'], [
      { from: 'x', to: 'y' },
      { from: 'p', to: 'q' },
      { from: 'q', to: 'r' },
    ]);
    expect(layout.components.map((component) => component.rows.flat().filter((slot) => slot.kind === 'file').length)).toEqual([3, 2]);
  });
});
