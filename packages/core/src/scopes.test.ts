import { describe, expect, it } from 'vitest';
import { enclosingScopes } from './scopes';

const TS = `import { x } from './x';

export const foldOutlineTail = (
  tail: readonly Event[],
): OutlineItem[] => {
  const items: OutlineItem[] = [];

  for (const event of tail) {
    if (event.kind === "message") {
      continue;
    }
    items.push(
      new OutlineItem({
        id: event.id,
        actor: event.payload.actor,
      }),
    );
  }
  return items;
};

function alone() {
  return 1;
}
`;

const PY = `class Reader:
    def read(self, path):
        with open(path) as handle:
            # a comment
            return handle.read()

    def other(self):
        pass
`;

const MD = `# Geld

Intro.

## Conventions

- one

\`\`\`
# not a heading
\`\`\`

### Website

Deep line.

## Verifying
`;

function at(text: string, needle: string): number {
  const index = text.split('\n').findIndex((line) => line.includes(needle));
  if (index === -1) throw new Error(`no line holds ${needle}`);
  return index + 1;
}

describe('enclosingScopes', () => {
  it('walks up by indentation and names a multi-line signature by its first line', () => {
    // Four levels deep; over the cap the function stays and the middle goes.
    const chain = enclosingScopes(TS, at(TS, 'actor: event.payload.actor'), 'a.ts');
    expect(chain.map((scope) => scope.text)).toEqual(['export const foldOutlineTail = (', 'items.push(', 'new OutlineItem({']);
    expect(chain[0]?.line).toBe(3);
    expect(enclosingScopes(TS, at(TS, 'actor: event.payload.actor'), 'a.ts', 10).map((scope) => scope.text)).toEqual(['export const foldOutlineTail = (', 'for (const event of tail) {', 'items.push(', 'new OutlineItem({']);
    // Two levels in: the arrow function (through its `): OutlineItem[] => {` line) and the loop.
    expect(enclosingScopes(TS, at(TS, 'continue;'), 'a.ts').map((scope) => scope.text)).toEqual(['export const foldOutlineTail = (', 'for (const event of tail) {', 'if (event.kind === "message") {']);
    expect(enclosingScopes(TS, at(TS, 'return items;'), 'a.ts').map((scope) => scope.text)).toEqual(['export const foldOutlineTail = (']);
    expect(enclosingScopes(TS, at(TS, 'return 1;'), 'a.ts').map((scope) => scope.text)).toEqual(['function alone() {']);
  });

  it('leaves out a bare brace: a JSON document, an Allman-style body', () => {
    const json = '{\n  "name": "x",\n  "dependencies": {\n    "tinyexec": "1.0.0"\n  }\n}\n';
    expect(enclosingScopes(json, 4, 'package.json').map((scope) => scope.text)).toEqual(['"dependencies": {']);
    const allman = 'void Foo()\n{\n    Bar();\n}\n';
    expect(enclosingScopes(allman, 3, 'a.cs').map((scope) => scope.text)).toEqual(['void Foo()']);
  });

  it('encloses nothing at the top level or off the file', () => {
    expect(enclosingScopes(TS, at(TS, 'function alone'), 'a.ts')).toEqual([]);
    expect(enclosingScopes(TS, 1, 'a.ts')).toEqual([]);
    expect(enclosingScopes(TS, 0, 'a.ts')).toEqual([]);
    expect(enclosingScopes(TS, 10_000, 'a.ts')).toEqual([]);
  });

  it('reads Python by indentation and skips comments', () => {
    expect(enclosingScopes(PY, at(PY, 'return handle.read()'), 'r.py').map((scope) => scope.text)).toEqual(['class Reader:', 'def read(self, path):', 'with open(path) as handle:']);
    expect(enclosingScopes(PY, at(PY, 'pass'), 'r.py').map((scope) => scope.text)).toEqual(['class Reader:', 'def other(self):']);
  });

  it('keeps the outermost chain of a blank target line and caps the depth', () => {
    const blank = at(TS, 'const items: OutlineItem[] = [];') + 1;
    expect(enclosingScopes(TS, blank, 'a.ts').map((scope) => scope.text)).toEqual(['export const foldOutlineTail = (']);
    expect(enclosingScopes(TS, at(TS, 'actor: event.payload.actor'), 'a.ts', 2).map((scope) => scope.text)).toEqual(['export const foldOutlineTail = (', 'new OutlineItem({']);
  });

  it('reads Markdown by heading level, ignoring fenced code', () => {
    expect(enclosingScopes(MD, at(MD, 'Deep line.'), 'AGENTS.md').map((scope) => scope.text)).toEqual(['# Geld', '## Conventions', '### Website']);
    expect(enclosingScopes(MD, at(MD, '# not a heading'), 'AGENTS.md').map((scope) => scope.text)).toEqual(['# Geld', '## Conventions']);
    // A heading's own chain is what is above it.
    expect(enclosingScopes(MD, at(MD, '## Verifying'), 'AGENTS.md').map((scope) => scope.text)).toEqual(['# Geld']);
    expect(enclosingScopes(MD, at(MD, 'Intro.'), 'AGENTS.md').map((scope) => scope.text)).toEqual(['# Geld']);
  });
});
