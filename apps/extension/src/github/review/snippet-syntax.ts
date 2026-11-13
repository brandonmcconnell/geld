import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

/**
 * Syntax colour for a snippet Geld draws itself (a triage fix's diff), not GitHub's diff: the text is Geld's, so the
 * tokens are spans of its own rather than ranges over GitHub's nodes (`diff-syntax.ts`). Partial snippets are fine:
 * highlight.js reads what it is given, and each side of a diff is read as one block.
 */

const LANGUAGES = { bash, c, cpp, csharp, css, go, java, javascript, json, kotlin, markdown, python, ruby, rust, typescript, xml, yaml } as const;
type SnippetLanguage = keyof typeof LANGUAGES;

// The core is shared with `diff-syntax.ts`, which registers some of these too.
for (const [name, language] of Object.entries(LANGUAGES)) if (hljs.getLanguage(name) === undefined) hljs.registerLanguage(name, language);

const BY_EXTENSION: Readonly<Record<string, SnippetLanguage>> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  css: 'css', scss: 'css', less: 'css',
  json: 'json', jsonc: 'json',
  yml: 'yaml', yaml: 'yaml',
  md: 'markdown', mdx: 'markdown',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', kts: 'kotlin',
  c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', hpp: 'cpp', cs: 'csharp',
  sh: 'bash', bash: 'bash', zsh: 'bash',
  html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', vue: 'xml',
};

export function snippetLanguage(path: string): SnippetLanguage | null {
  const name = path.split('/').pop() ?? '';
  const extension = name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : '';
  return BY_EXTENSION[extension] ?? null;
}

/** The colours the stylesheet gives, by highlight.js scope (`data-syn` on a span). */
const SCOPES: Readonly<Record<string, string>> = {
  keyword: 'keyword', 'selector-tag': 'keyword', tag: 'keyword',
  built_in: 'entity', title: 'entity', type: 'entity', name: 'entity', section: 'entity', 'selector-class': 'entity', 'selector-id': 'entity',
  literal: 'constant', number: 'constant', attr: 'constant', attribute: 'constant', symbol: 'constant', property: 'constant', bullet: 'constant',
  string: 'string', regexp: 'string', link: 'string',
  comment: 'comment', meta: 'comment', quote: 'comment',
  variable: 'variable', 'template-variable': 'variable', params: 'variable',
};

export interface SyntaxPiece {
  readonly text: string;
  /** The colour's name, or null for plain text. */
  readonly scope: string | null;
}

function scopeOf(node: Node): string | null {
  for (let parent = node.parentElement; parent !== null; parent = parent.parentElement) {
    for (const name of parent.classList) {
      if (!name.startsWith('hljs-')) continue;
      const scope = SCOPES[name.slice(5)];
      if (scope !== undefined) return scope;
    }
  }
  return null;
}

const MAX_SOURCE = 100_000;

/** Each line's pieces, coloured as one block; null when the text is too long to be worth it. */
export function highlightLines(lines: readonly string[], language: SnippetLanguage): readonly (readonly SyntaxPiece[])[] | null {
  const source = lines.join('\n');
  if (source.length > MAX_SOURCE) return null;
  // Only highlight.js's escaped output is parsed, in a detached template.
  const template = document.createElement('template');
  template.innerHTML = hljs.highlight(source, { language, ignoreIllegals: true }).value;
  const out: SyntaxPiece[][] = [[]];
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (!(node instanceof Text)) continue;
    const scope = scopeOf(node);
    node.data.split('\n').forEach((part, index) => {
      if (index > 0) out.push([]);
      if (part !== '') out.at(-1)?.push({ text: part, scope });
    });
  }
  return out;
}
