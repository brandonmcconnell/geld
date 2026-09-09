/**
 * Which changed lines of a diff only touch comments. Used for the
 * "comment-only edits" change kind (every changed line of a file is a
 * comment) and for hiding individual comment lines inside files that stay
 * visible. Language is inferred from the file name; unknown languages are
 * never classified, so prose and data files are left alone.
 *
 * The scanner is deliberately small: it knows line-comment tokens and block
 * delimiters per language and asks one question of each line — is there any
 * code outside a comment? A `//` inside a string literal cannot fool it,
 * because the code before the string already answered "yes". Multi-line
 * strings that happen to start with a comment token are the accepted
 * imprecision.
 */

export interface CommentSyntax {
  /** Tokens that comment out the rest of a line. */
  readonly line: readonly string[];
  /** `[open, close]` pairs for block comments. */
  readonly block: readonly (readonly [string, string])[];
}

const C_LIKE: CommentSyntax = { line: ['//'], block: [['/*', '*/']] };
const HASH: CommentSyntax = { line: ['#'], block: [] };
const HASH_AND_C: CommentSyntax = { line: ['#', '//'], block: [['/*', '*/']] };
const PYTHON: CommentSyntax = { line: ['#'], block: [['"""', '"""'], ["'''", "'''"]] };
const RUBY: CommentSyntax = { line: ['#'], block: [['=begin', '=end']] };
const MARKUP: CommentSyntax = { line: [], block: [['<!--', '-->']] };
const CSS: CommentSyntax = { line: [], block: [['/*', '*/']] };
const SQL: CommentSyntax = { line: ['--'], block: [['/*', '*/']] };
const LUA: CommentSyntax = { line: ['--'], block: [['--[[', ']]']] };
const HASKELL: CommentSyntax = { line: ['--'], block: [['{-', '-}']] };
const LISP: CommentSyntax = { line: [';'], block: [] };
const INI: CommentSyntax = { line: [';', '#'], block: [] };
const POWERSHELL: CommentSyntax = { line: ['#'], block: [['<#', '#>']] };
const OCAML: CommentSyntax = { line: [], block: [['(*', '*)']] };
const ERLANG: CommentSyntax = { line: ['%'], block: [] };
const VB: CommentSyntax = { line: ["'"], block: [] };
const JULIA: CommentSyntax = { line: ['#'], block: [['#=', '=#']] };

const BY_EXTENSION: Readonly<Record<string, CommentSyntax>> = {
  js: C_LIKE, jsx: C_LIKE, mjs: C_LIKE, cjs: C_LIKE, ts: C_LIKE, tsx: C_LIKE, mts: C_LIKE, cts: C_LIKE,
  java: C_LIKE, kt: C_LIKE, kts: C_LIKE, scala: C_LIKE, groovy: C_LIKE, gradle: C_LIKE,
  c: C_LIKE, h: C_LIKE, cpp: C_LIKE, cc: C_LIKE, cxx: C_LIKE, hpp: C_LIKE, hh: C_LIKE, hxx: C_LIKE, m: C_LIKE, mm: C_LIKE,
  cs: C_LIKE, go: C_LIKE, rs: C_LIKE, swift: C_LIKE, dart: C_LIKE, zig: C_LIKE, v: C_LIKE, sol: C_LIKE,
  php: HASH_AND_C, less: C_LIKE, scss: C_LIKE, sass: C_LIKE, styl: C_LIKE, proto: C_LIKE, glsl: C_LIKE, hlsl: C_LIKE, wgsl: C_LIKE,
  json5: C_LIKE, jsonc: C_LIKE,
  css: CSS,
  py: PYTHON, pyi: PYTHON, pyx: PYTHON,
  rb: RUBY, rake: RUBY, gemspec: RUBY,
  sh: HASH, bash: HASH, zsh: HASH, fish: HASH, yml: HASH, yaml: HASH, toml: HASH, pl: HASH, pm: HASH, r: HASH, tf: HASH_AND_C, hcl: HASH_AND_C,
  ex: HASH, exs: HASH, nim: HASH, cr: HASH, dockerfile: HASH, makefile: HASH, mk: HASH, cmake: HASH, nix: HASH, conf: HASH, properties: HASH, env: HASH,
  ps1: POWERSHELL, psm1: POWERSHELL,
  html: MARKUP, htm: MARKUP, xml: MARKUP, svg: MARKUP, xhtml: MARKUP, vue: MARKUP, svelte: MARKUP, astro: MARKUP, xsl: MARKUP, plist: MARKUP, csproj: MARKUP,
  sql: SQL, lua: LUA, hs: HASKELL, elm: HASKELL, purs: HASKELL,
  clj: LISP, cljs: LISP, cljc: LISP, edn: LISP, lisp: LISP, el: LISP, scm: LISP, rkt: LISP,
  ini: INI, cfg: INI, gitconfig: INI, editorconfig: INI,
  ml: OCAML, mli: OCAML, fs: OCAML, fsx: OCAML,
  erl: ERLANG, hrl: ERLANG, tex: ERLANG,
  vb: VB, vbs: VB, bas: VB,
  jl: JULIA,
};

const BY_BASENAME: Readonly<Record<string, CommentSyntax>> = {
  dockerfile: HASH,
  makefile: HASH,
  gemfile: RUBY,
  rakefile: RUBY,
  podfile: RUBY,
  brewfile: RUBY,
  justfile: HASH,
  procfile: HASH,
  '.gitignore': HASH,
  '.gitattributes': HASH,
  '.dockerignore': HASH,
  '.npmrc': HASH,
  '.editorconfig': INI,
};

/** The comment syntax of a file, or `null` when Geld does not know the language (prose, data, unknown). */
export function commentSyntaxFor(path: string): CommentSyntax | null {
  const base = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  const byName = BY_BASENAME[base];
  if (byName !== undefined) return byName;
  const dot = base.lastIndexOf('.');
  if (dot === -1) return null;
  return BY_EXTENSION[base.slice(dot + 1)] ?? null;
}

/** Carries block-comment state from one line to the next of the same file side. */
export interface CommentScanState {
  /** The block delimiter pair we are inside, or `null`. */
  block: readonly [string, string] | null;
}

export function newCommentScanState(): CommentScanState {
  return { block: null };
}

/**
 * Whether `text` holds no code outside comments (blank lines count as
 * comment-only: they are part of the same edit). Updates `state` for the next
 * line of the same side.
 */
export function isCommentOnlyLine(text: string, syntax: CommentSyntax, state: CommentScanState): boolean {
  let index = 0;
  const length = text.length;
  while (index < length) {
    if (state.block !== null) {
      const close = state.block[1];
      const end = text.indexOf(close, index);
      if (end === -1) return true;
      index = end + close.length;
      state.block = null;
      continue;
    }
    const char = text.charAt(index);
    if (char === ' ' || char === '\t' || char === '\r') {
      index += 1;
      continue;
    }
    if (syntax.line.some((token) => text.startsWith(token, index))) return true;
    const open = syntax.block.find((pair) => text.startsWith(pair[0], index));
    if (open !== undefined) {
      state.block = open;
      index += open[0].length;
      continue;
    }
    return false;
  }
  return true;
}

/** Comment-only changed lines of one file, by the line numbers GitHub shows (new file for additions, old file for deletions). */
export interface CommentLines {
  readonly added: readonly number[];
  readonly removed: readonly number[];
}
