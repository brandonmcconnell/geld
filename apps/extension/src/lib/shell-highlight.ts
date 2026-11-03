import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';

hljs.registerLanguage('bash', bash);

export const SHELL_SCOPES = ['plain', 'keyword', 'built_in', 'literal', 'number', 'string', 'comment', 'variable', 'subst', 'title', 'meta', 'attr'] as const;
export type ShellScope = (typeof SHELL_SCOPES)[number];
export type ShellRanges = Map<ShellScope, StaticRange[]>;
export interface SourceText { readonly node: Text; readonly text: string; readonly offset?: number }
export interface ShellLine { readonly number: number; readonly nodes: readonly SourceText[]; readonly text: string }

export function textNodes(root: Node): SourceText[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: SourceText[] = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node instanceof Text) nodes.push({ node, text: node.data });
  }
  return nodes;
}

export function sameLines(before: readonly ShellLine[], after: readonly ShellLine[]): boolean {
  return before.length === after.length && before.every((line, i) => {
    const next = after[i];
    return next !== undefined && line.number === next.number && line.nodes.length === next.nodes.length &&
      line.nodes.every((part, j) => part.node === next.nodes[j]?.node && part.text === next.nodes[j]?.text && (part.offset ?? 0) === (next.nodes[j]?.offset ?? 0));
  });
}

function scopeOf(node: Node): ShellScope {
  for (let parent = node.parentElement; parent !== null; parent = parent.parentElement) {
    for (const scope of SHELL_SCOPES) if (parent.classList.contains(`hljs-${scope}`)) return scope;
  }
  return 'plain';
}

export function paintBlock(lines: readonly ShellLine[], ranges: ShellRanges, skipNodes: ReadonlySet<Text>): void {
  const source = lines.map((line) => line.text).join('\n');
  if (source.length > 100_000) return;
  // Only highlight.js's escaped output is parsed in a detached template. Native source nodes stay untouched.
  const template = document.createElement('template');
  template.innerHTML = hljs.highlight(source, { language: 'bash', ignoreIllegals: true }).value;
  const sourceNodes: { readonly node: Text; readonly start: number; readonly end: number; readonly offset: number }[] = [];
  let offset = 0;
  for (const line of lines) {
    for (const part of line.nodes) {
      sourceNodes.push({ node: part.node, start: offset, end: offset + part.text.length, offset: part.offset ?? 0 });
      offset += part.text.length;
    }
    offset += 1;
  }
  let index = 0;
  offset = 0;
  for (const part of textNodes(template.content)) {
    const end = offset + part.text.length;
    const scope = scopeOf(part.node);
    while (index < sourceNodes.length) {
      const original = sourceNodes[index];
      if (original === undefined || original.start >= end) break;
      const start = Math.max(offset, original.start);
      const stop = Math.min(end, original.end);
      if (start < stop && !skipNodes.has(original.node)) {
        const range = new StaticRange({
          startContainer: original.node, startOffset: original.offset + start - original.start,
          endContainer: original.node, endOffset: original.offset + stop - original.start,
        });
        const group = ranges.get(scope) ?? [];
        group.push(range);
        ranges.set(scope, group);
      }
      if (original.end > end) break;
      index += 1;
    }
    offset = end;
  }
}
