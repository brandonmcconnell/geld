import type { CodeHighlighterPlugin, HighlightResult, HighlightToken, ThemeInput } from 'streamdown';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

/**
 * Code in chat replies highlighted with highlight.js, which the diff highlighter already bundles, in place of
 * Streamdown's Shiki plugin: a content script cannot load Shiki's grammars on demand. Each token is coloured with
 * GitHub's own syntax tokens (`--color-prettylights-syntax-*`), so code reads as it does in GitHub's diffs, in every
 * theme GitHub offers, colour-blind and high-contrast ones included.
 */
const engine = hljs.newInstance();
const LANGUAGES = { bash, css, diff, go, java, javascript, json, markdown, python, ruby, rust, sql, typescript, xml, yaml };
for (const [name, language] of Object.entries(LANGUAGES)) engine.registerLanguage(name, language);
engine.registerAliases(['sh', 'shell', 'zsh', 'console'], { languageName: 'bash' });
engine.registerAliases(['js', 'jsx', 'mjs', 'cjs'], { languageName: 'javascript' });
engine.registerAliases(['ts', 'tsx', 'mts', 'cts'], { languageName: 'typescript' });
engine.registerAliases(['html', 'svg', 'vue'], { languageName: 'xml' });
engine.registerAliases(['yml'], { languageName: 'yaml' });
engine.registerAliases(['md'], { languageName: 'markdown' });
engine.registerAliases(['py'], { languageName: 'python' });
engine.registerAliases(['rb'], { languageName: 'ruby' });
engine.registerAliases(['rs'], { languageName: 'rust' });
engine.registerAliases(['patch'], { languageName: 'diff' });

/** highlight.js scopes to GitHub's syntax tokens; mirrors the diff highlighter's mapping in `github.content/style.css`. */
const SCOPE_COLORS: ReadonlyArray<readonly [string, string]> = [
  ['keyword', 'keyword'],
  ['built_in', 'entity'],
  ['title', 'entity'],
  ['type', 'entity'],
  ['literal', 'constant'],
  ['number', 'constant'],
  ['attr', 'constant'],
  ['attribute', 'constant'],
  ['symbol', 'constant'],
  ['string', 'string'],
  ['regexp', 'string'],
  ['comment', 'comment'],
  ['meta', 'comment'],
  ['variable', 'variable'],
  ['name', 'entity-tag'],
  ['tag', 'entity-tag'],
  ['section', 'markup-heading'],
  ['addition', 'markup-inserted-text'],
  ['deletion', 'markup-deleted-text'],
];

function colorOf(node: Node): string | undefined {
  for (let parent = node.parentElement; parent !== null; parent = parent.parentElement) {
    for (const [scope, token] of SCOPE_COLORS) if (parent.classList.contains(`hljs-${scope}`)) return `var(--color-prettylights-syntax-${token})`;
  }
  return undefined;
}

/** Tokens per line from highlight.js's escaped HTML, read in an inert template so nothing in it runs or loads. */
export function tokensOf(code: string, language: string): HighlightToken[][] {
  const template = document.createElement('template');
  template.innerHTML = engine.highlight(code, { language, ignoreIllegals: true }).value;
  const lines: HighlightToken[][] = [[]];
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const color = colorOf(node);
    const parts = (node.textContent ?? '').split('\n');
    parts.forEach((content, index) => {
      if (index > 0) lines.push([]);
      if (content !== '') lines[lines.length - 1]?.push(color === undefined ? { content } : { content, color });
    });
  }
  return lines;
}

const THEMES: [ThemeInput, ThemeInput] = ['github-light', 'github-dark'];

export const codeHighlighter: CodeHighlighterPlugin = {
  name: 'shiki',
  type: 'code-highlighter',
  getSupportedLanguages: () => engine.listLanguages(),
  getThemes: () => THEMES,
  supportsLanguage: (language) => engine.getLanguage(language) !== undefined,
  highlight: ({ code, language }): HighlightResult | null => {
    if (engine.getLanguage(language) === undefined) return null;
    return { tokens: tokensOf(code, language) };
  },
};
