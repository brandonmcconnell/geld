/**
 * Test outlines: a test file's diff read down to its test titles. Each test
 * (declaration and body) folds to one line with its title ("persists the
 * token"), suites stay open so titles nest, and a fold says what changed in it.
 *
 * Declarations are recognised by their leading syntax, in every framework the
 * built-ins know (below) plus the reader's own (`parseTestSyntax`). A block's
 * extent is read from indentation, which holds across languages for
 * formatted code: every following line indented deeper than the declaration,
 * then a closing line at its own indent (`})`, `}`, `end`). Python and other
 * offside languages simply have no closing line.
 *
 * Pure: the extension hands in each side of the diff as GitHub rendered it.
 */

export type TestBlockKind = 'suite' | 'test' | 'hook';

export interface TestSyntax {
  readonly kind: TestBlockKind;
  /** Matches a declaration line; the title is the `title` group, else the first group, else the whole match. */
  readonly pattern: RegExp;
}

/** One line of one side of a diff, in line-number order. */
export interface OutlineLine {
  /** GitHub's line key (`L12` old side, `R12` new side). */
  readonly key: string;
  readonly number: number;
  readonly text: string;
  /** A deletion (old side) or an addition (new side); false for context. */
  readonly changed: boolean;
  /** The rendered row it sits in, so the two sides of a context line meet. */
  readonly row: number;
  /** Consecutive changed rows share a run; a context row is a run of its own. */
  readonly run: number;
}

export type TestFoldStatus = 'added' | 'removed' | 'renamed' | 'modified' | 'unchanged';

/** A test, hook or wholly added or removed suite that folds to one line. */
export interface TestFold {
  /** Stable for the page: the side and line key of its declaration. */
  readonly id: string;
  readonly kind: TestBlockKind;
  /** The folded suite it sits in (its `id`): while that suite is folded, so is this. */
  readonly parentId?: string;
  readonly title: string;
  /** The old title, for a test whose declaration line changed its title. */
  readonly previousTitle?: string;
  readonly status: TestFoldStatus;
  /** The line its toggle stands on (the new side's declaration, or the old one for a removed test). */
  readonly headKey: string;
  /** The declaration's own lines on either side (its head, and a title on the line after a bare `it(`). */
  readonly headingKeys: readonly string[];
  /** Every line of its body on either side. */
  readonly bodyKeys: readonly string[];
  readonly additions: number;
  readonly deletions: number;
}

// No two neighbouring quantifiers in these patterns may match the same characters (`\s*\s+`, `[\w ]+?\s*`): they read
// diff text a pull request's author controls, and overlapping runs backtrack quadratically on a line of spaces.
// A backslash only ever starts an escape: were it also a plain character, a line of backslashes with no closing quote
// would backtrack exponentially on diff text a pull request's author controls.
const QUOTE = String.raw`(?<q>['"\x60])(?<title>(?:\\.|(?!\k<q>)[^\\])*)\k<q>`;
/** `name`, `name.only`, `name.each([…])` (arguments nested two deep), `name.each\`…\`` and the like, then `(` or a space, then a quoted title. */
const CHAIN = String.raw`(?:\.[A-Za-z_$][\w$]*(?:\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)|\x60[^\x60]*\x60)?)*`;

function callSyntax(kind: TestBlockKind, names: readonly string[]): TestSyntax {
  const alternatives = names.map((name) => name.replace(/[.$]/g, (char) => `\\${char}`)).join('|');
  return { kind, pattern: new RegExp(String.raw`^\s*(?:${alternatives})${CHAIN}(?:\s*\(\s*|\s+)${QUOTE}`) };
}

/**
 * Built-in leading syntaxes. Order matters only between kinds that share a
 * name (`test.describe` is a suite before `test` is a test).
 */
export const BUILT_IN_TEST_SYNTAXES: readonly TestSyntax[] = [
  // Jest, Vitest, Mocha, Jasmine, Bun, node:test, Playwright, Cypress, AVA, tap, Pest, RSpec, Elixir, Dart, Lua busted, hspec, Scala.
  callSyntax('suite', ['test.describe', 'it.describe', 'describe', 'context', 'suite', 'fdescribe', 'xdescribe', 'xcontext', 'group', 'feature', 'experiment', 'describe_each']),
  callSyntax('test', ['it', 'test', 'specify', 'fit', 'xit', 'xtest', 'xspecify', 'bench', 'scenario', 'xscenario', 'testWidgets', 'test_that', 'Deno.test', 't.test', 'should', 'example', 'property', 'testProperty', 'prop']),
  // Hooks fold too: their name is their title.
  { kind: 'hook', pattern: /^\s*(?<title>beforeEach|afterEach|beforeAll|afterAll|before|after|around|setup|setUp|teardown|tearDown|setUpAll|tearDownAll|prepend_before|append_after)\b\s*(?:[({]|do\b|\(:each\)|\(:all\))/ },
  // Gherkin.
  { kind: 'suite', pattern: /^\s*(?:Feature|Rule|Background):\s*(?<title>.*)$/ },
  { kind: 'test', pattern: /^\s*(?:Scenario(?: Outline| Template)?|Example):\s*(?<title>.*)$/ },
  // Python (pytest, unittest), Ruby minitest, PHP, XCTest, Kotlin/Java by name.
  { kind: 'suite', pattern: /^\s*class\s+(?<title>Test\w*|\w+Tests?)\b/ },
  { kind: 'hook', pattern: /^\s*(?:async\s+)?def\s+(?<title>setUp|tearDown|setUpClass|tearDownClass|setup_method|teardown_method|setup_class|teardown_class|setup|teardown)\s*\(/ },
  { kind: 'test', pattern: /^\s*(?:async\s+)?def\s+(?<title>test\w*)\s*[(:]/ },
  { kind: 'test', pattern: /^\s*(?:(?:public|protected|private|final|static|override|open|internal|suspend)\s+)*(?:function|func|fun|void)\s+(?<title>test\w*)\s*\(/ },
  // Go: TestXxx, BenchmarkXxx, FuzzXxx and subtests.
  { kind: 'test', pattern: /^func\s+(?:\([^)]*\)\s*)?(?<title>(?:Test|Benchmark|Fuzz)\w*)\s*\(/ },
  { kind: 'test', pattern: /^\s*(?:t|b|s|f|suite)\.Run\(\s*"(?<title>(?:\\.|[^"\\])*)"/ },
  // A raw string: Go reads its backslashes literally.
  { kind: 'test', pattern: /^\s*(?:t|b|s|f|suite)\.Run\(\s*`(?<title>[^`]*)`/ },
  // Clojure, Kotest/ScalaTest strings.
  { kind: 'test', pattern: /^\s*\(deftest\s+(?<title>[^\s()]+)/ },
  { kind: 'suite', pattern: /^\s*"(?<title>[^"]+)"\s+(?:should|must|can|when|-)\s*[{-]/ },
  { kind: 'test', pattern: /^\s*"(?<title>[^"]+)"\s+(?:in(?:\s*\{)?|\{)\s*$/ },
];

/**
 * Annotations that make the next function a test (JUnit, TestNG, Kotlin, Swift
 * Testing, xUnit, NUnit, MSTest, Rust): the title is the annotation's string
 * when it has one (`@Test("adds")`, `@DisplayName("adds")`), else the function name.
 */
const TEST_ANNOTATION =
  /^\s*(?:@(?:Test|ParameterizedTest|RepeatedTest|TestFactory|TestTemplate|Property|Theory|DisplayName|Disabled|Tag)\b(?:\(\s*"(?<title>[^"]*)"[^)]*\))?|\[(?:Fact|Theory|Test|TestMethod|DataTestMethod|TestCase|TestCaseSource|InlineData)\b[^\]]*\]|#\[(?:[\w:]+::)?(?:test|rstest|test_case|quickcheck)\b[^\]]*\])/;
/** A function declaration after test annotations, in the languages that use them. */
const ANNOTATED_FUNCTION = /^\s*(?:(?:public|protected|private|internal|static|final|async|override|open|suspend|unsafe|pub(?:\([^)]*\))?)\s+)*(?:fun|func|fn|void|def|Task|async\s+Task|[\w<>[\],.?]+)\s+(?:`(?<title>[^`]+)`|(?<name>\w+))\s*[(<]/;
/** `it(` alone on its line, its title on the next: the declaration opens a line early. */
const BARE_OPENER = new RegExp(String.raw`^\s*(?:test\.describe|describe|context|suite|it|test|specify|bench|scenario|group|testWidgets)${CHAIN}\s*\(\s*$`);
const OPENER_KIND = /^\s*(?:test\.describe|describe|context|suite|group)\b/;
const TITLE_LINE = /^\s*(?<q>['"\x60])(?<title>(?:\\.|(?!\k<q>)[^\\])*)\k<q>/;
/** A line that closes a block at the declaration's own indent. */
const CLOSER = /^\s*(?:[}\])][\s\w.,;:)\]}'"\x60=>()-]*|end\b.*|```.*)$/;

function titleOf(match: RegExpExecArray): string {
  return (match.groups?.title ?? match[1] ?? match[0]).trim();
}

/** An annotated function's title: its backtick name, else its identifier. */
function functionName(match: RegExpExecArray): string {
  return (match.groups?.title ?? match.groups?.name ?? match[0]).trim();
}

function indentOf(text: string): number {
  let width = 0;
  for (const char of text) {
    if (char === ' ') width += 1;
    else if (char === '\t') width += 4;
    else break;
  }
  return width;
}

const isBlank = (text: string): boolean => text.trim() === '';

interface Declaration {
  readonly kind: TestBlockKind;
  readonly title: string;
  /** Lines of the declaration before its body (2 when the title sits on the line after `it(`). */
  readonly span: number;
}

function declarationAt(lines: readonly OutlineLine[], index: number, syntaxes: readonly TestSyntax[]): Declaration | null {
  const line = lines[index];
  if (line === undefined || isBlank(line.text)) return null;
  for (const syntax of syntaxes) {
    const match = syntax.pattern.exec(line.text);
    if (match !== null) return { kind: syntax.kind, title: titleOf(match), span: 1 };
  }
  if (BARE_OPENER.test(line.text)) {
    const next = lines[index + 1];
    const title = next !== undefined && next.number === line.number + 1 ? TITLE_LINE.exec(next.text) : null;
    if (title !== null) return { kind: OPENER_KIND.test(line.text) ? 'suite' : 'test', title: titleOf(title), span: 2 };
  }
  return null;
}

/** A function under test annotations, looked for a few lines past them (other annotations, doc comments). */
function annotatedAt(lines: readonly OutlineLine[], index: number): { readonly head: number; readonly title: string } | null {
  let title: string | null = null;
  let at = index;
  for (let seen = 0; seen < 8; seen += 1, at += 1) {
    const line = lines[at];
    if (line === undefined || (at > index && line.number !== (lines[at - 1]?.number ?? 0) + 1)) return null;
    const annotation = TEST_ANNOTATION.exec(line.text);
    if (annotation !== null) {
      title ??= annotation.groups?.title ?? null;
      // Swift Testing and Kotlin often keep the function on the annotation's line.
      const inline = ANNOTATED_FUNCTION.exec(line.text.slice(annotation[0].length));
      if (inline !== null) return { head: at, title: title ?? functionName(inline) };
      continue;
    }
    if (/^\s*(?:@\w|\[\w|#\[|\/\/\/|\/\*\*?|\*)/.test(line.text) || isBlank(line.text)) continue;
    const fn = ANNOTATED_FUNCTION.exec(line.text);
    return fn === null ? null : { head: at, title: title ?? functionName(fn) };
  }
  return null;
}

/** A line that opens with a call: a name, maybe dotted, then its brackets (`it(`, `test.each([`, `it.each\x60`). */
const OPENS_WITH_CALL = /^\s*[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*[([\x60]/;

/**
 * A call that opens and closes on its own line (`…);`), so nothing after it belongs to it. One forward scan over
 * the line (it is diff text a pull request's author controls): strings skipped, a comment ends the code, brackets
 * counted, and the last code must be the call's `)`, optionally with `;` or `,` after it.
 */
function completeOnItsLine(text: string): boolean {
  // A function declared with its brace on the next line (Allman, PSR-12) ends in `)` as well, and is not a call.
  if (/^\s*(?:(?:public|protected|private|internal|static|final|async|override|open|suspend)\s+)*(?:function|func|fun|void|def|fn)\b/.test(text)) return false;
  if (!OPENS_WITH_CALL.test(text)) return false;
  let depth = 0;
  let quote = '';
  let last = '';
  let beforeLast = '';
  for (let at = 0; at < text.length; at += 1) {
    const char = text.charAt(at);
    if (quote !== '') {
      if (char === '\\') at += 1;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === "'" || char === '"' || char === '\x60') {
      quote = char;
      beforeLast = last;
      last = char;
      continue;
    }
    if (char === '/' && text.charAt(at + 1) === '/') break;
    if (char === '/' && text.charAt(at + 1) === '*') {
      const end = text.indexOf('*/', at + 2);
      if (end === -1) break;
      at = end + 1;
      continue;
    }
    if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === ')' || char === ']' || char === '}') depth -= 1;
    if (char.trim() !== '') {
      beforeLast = last;
      last = char;
    }
  }
  if (quote !== '' || depth > 0) return false;
  return last === ')' || ((last === ';' || last === ',') && beforeLast === ')');
}

interface Block {
  readonly kind: TestBlockKind;
  readonly title: string;
  /** Its first line: the declaration, or the first of the annotations that make it a test (`@Test`, `#[test]`). */
  readonly start: number;
  readonly head: number;
  /** First and last body line (inclusive); empty when last < first. */
  readonly first: number;
  readonly last: number;
}

/** Every declaration on one side with its extent. Lines across a gap in the numbering never join a block. */
export function testBlocks(lines: readonly OutlineLine[], syntaxes: readonly TestSyntax[] = BUILT_IN_TEST_SYNTAXES): readonly Block[] {
  const blocks: Block[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const start = index;
    let head = index;
    let declaration = TEST_ANNOTATION.test(lines[index]?.text ?? '') ? null : declarationAt(lines, index, syntaxes);
    if (declaration === null && TEST_ANNOTATION.test(lines[index]?.text ?? '')) {
      const annotated = annotatedAt(lines, index);
      if (annotated === null) continue;
      head = annotated.head;
      declaration = { kind: 'test', title: annotated.title, span: 1 };
      index = annotated.head;
    }
    if (declaration === null) continue;
    const headLine = lines[head];
    if (headLine === undefined) continue;
    const indent = indentOf(headLine.text);
    const first = head + declaration.span;
    let last = first - 1;
    // `it('adds', () => expect(add(1, 1)).toBe(2));` is whole on its line: a deeper line after it is not its body.
    if (declaration.span === 1 && head === start && completeOnItsLine(headLine.text)) {
      blocks.push({ kind: declaration.kind, title: declaration.title, start, head, first, last });
      continue;
    }
    let previous = lines[first - 1]?.number ?? headLine.number;
    for (let at = first; at < lines.length; at += 1) {
      const line = lines[at];
      if (line === undefined || line.number !== previous + 1) break;
      previous = line.number;
      // Allman braces: the block's `{` on a line of its own at the declaration's indent.
      if (isBlank(line.text) || indentOf(line.text) > indent || (at === first && /^\s*\{\s*$/.test(line.text))) {
        last = at;
        continue;
      }
      if (indentOf(line.text) === indent && CLOSER.test(line.text)) last = at;
      break;
    }
    while (last >= first && isBlank(lines[last]?.text ?? '')) last -= 1;
    blocks.push({ kind: declaration.kind, title: declaration.title, start, head, first, last });
  }
  return blocks;
}

interface SideFold {
  readonly kind: TestBlockKind;
  readonly title: string;
  readonly head: OutlineLine;
  /** Its first and last line on this side, as indices, so the suites holding it can be found. */
  readonly from: number;
  readonly to: number;
  /** The innermost folded suite holding it. */
  parent: SideFold | null;
  /** The declaration's own lines: the head, and the title's line under a bare `it(`. They stay in view. */
  readonly heading: readonly OutlineLine[];
  readonly body: readonly OutlineLine[];
}

/** Whether the line at `index` is blank and follows (or precedes) its neighbour with no gap in the numbering. */
function blankBeside(lines: readonly OutlineLine[], index: number, neighbour: number): boolean {
  const line = lines[index];
  const other = lines[neighbour];
  return line !== undefined && other !== undefined && isBlank(line.text) && Math.abs(line.number - other.number) === 1;
}

/** A blank line beside a test that folds with it: one this change added or removed (an unchanged one is the file's own spacing). */
const blankToFold = (lines: readonly OutlineLine[], index: number, neighbour: number): boolean => blankBeside(lines, index, neighbour) && lines[index]?.changed === true;

/**
 * The blocks that fold: tests with no test or suite inside them (a Go test with subtests stays open), hooks, and
 * suites added or removed whole (their tests fold inside them, each a fold of its own once the suite is open).
 * A single added or removed blank line just below a test, or just above one the test before has not taken, folds
 * with it, so a run of folded tests is not broken up by the blank lines between them; two or more blank lines in a
 * row, and the file's unchanged spacing, stay in view.
 */
function foldsOf(lines: readonly OutlineLine[], syntaxes: readonly TestSyntax[]): readonly SideFold[] {
  const blocks = testBlocks(lines, syntaxes);
  const folds: SideFold[] = [];
  const taken = new Set<number>();
  for (const block of blocks) {
    if (block.last < block.first) continue;
    // A suite folds only when it was added or removed whole: a suite that stays is the structure its tests' titles
    // nest in, and folding it would hide them.
    if (block.kind === 'suite' && !lines.slice(block.start, block.last + 1).every((line) => line.changed)) continue;
    const container = block.kind === 'test' && blocks.some((other) => other !== block && other.kind !== 'hook' && other.head > block.head && other.head <= block.last);
    if (container) continue;
    // A hook-shaped line inside a test or hook (a component's `setup() {` in a test) is that test's code, not a hook.
    if (block.kind === 'hook' && blocks.some((other) => other !== block && other.kind !== 'suite' && other.head < block.head && block.head <= other.last)) continue;
    const head = lines[block.head];
    if (head === undefined) continue;
    const body = lines.slice(block.first, block.last + 1);
    const above = block.start - 1;
    if (blankToFold(lines, above, block.start) && !blankBeside(lines, above - 1, above) && !taken.has(above)) {
      const line = lines[above];
      if (line !== undefined) body.unshift(line);
      taken.add(above);
    }
    const below = block.last + 1;
    if (blankToFold(lines, below, block.last) && !blankBeside(lines, below + 1, below)) {
      const line = lines[below];
      if (line !== undefined) body.push(line);
      taken.add(below);
    }
    folds.push({ kind: block.kind, title: block.title, head, from: block.start, to: block.last, parent: null, heading: lines.slice(block.start, block.first), body });
  }
  for (const fold of folds) {
    const holders = folds.filter((other) => other !== fold && other.kind === 'suite' && other.from < fold.from && fold.to <= other.to);
    fold.parent = holders.reduce<SideFold | null>((inner, other) => (inner === null || other.from > inner.from ? other : inner), null);
  }
  return folds;
}

const changedIn = (body: readonly OutlineLine[]): number => body.filter((line) => line.changed).length;

/**
 * Both sides' folds, paired: a test whose declaration is context folds its
 * old and new bodies together; a declaration rewritten in one run of changes
 * is the same test renamed (or edited, title unchanged); an old declaration
 * with no partner is a removed test, a new one an added test.
 */
export function outlineTestFolds(sides: { readonly old: readonly OutlineLine[]; readonly new: readonly OutlineLine[] }, syntaxes: readonly TestSyntax[] = BUILT_IN_TEST_SYNTAXES): readonly TestFold[] {
  const olds = foldsOf(sides.old, syntaxes);
  const news = foldsOf(sides.new, syntaxes);
  const paired = new Set<SideFold>();
  const folds: TestFold[] = [];
  const sameRun = (old: SideFold, fold: SideFold): boolean =>
    !paired.has(old) && old.kind === fold.kind && (fold.head.changed ? old.head.changed && old.head.run === fold.head.run : !old.head.changed && old.head.row === fold.head.row);
  // Titles first: a test inserted just before an edited one in the same run must not take the edited one's old body.
  const partners = new Map<SideFold, SideFold>();
  for (const fold of news) {
    const partner = olds.find((old) => sameRun(old, fold) && old.title === fold.title);
    if (partner === undefined) continue;
    partners.set(fold, partner);
    paired.add(partner);
  }
  for (const fold of news) {
    if (partners.has(fold)) continue;
    const partner = olds.find((old) => sameRun(old, fold));
    if (partner === undefined) continue;
    partners.set(fold, partner);
    paired.add(partner);
  }
  // A suite rewritten in place keeps the new side's id, so an old child's parent is found under that id.
  const partnerOf = new Map<SideFold, SideFold>([...partners].map(([fold, old]) => [old, fold]));
  const idOf = (fold: SideFold, side: 'new' | 'old'): string => {
    const standing = side === 'old' ? partnerOf.get(fold) : undefined;
    return standing === undefined ? `${side}:${fold.head.key}` : `new:${standing.head.key}`;
  };
  const parentOf = (fold: SideFold, side: 'new' | 'old', partner?: SideFold): { readonly parentId?: string } => {
    if (fold.parent === null) return {};
    const parentId = idOf(fold.parent, side);
    // A test paired across sides is inside a folded suite only when both its sides are: a test moved into an added
    // suite keeps its old lines outside that suite, and they must keep a button of their own.
    if (partner !== undefined && (partner.parent === null || idOf(partner.parent, 'old') !== parentId)) return {};
    return { parentId };
  };
  for (const fold of news) {
    const partner = partners.get(fold);
    const additions = changedIn(fold.heading) + changedIn(fold.body);
    const deletions = partner === undefined ? 0 : changedIn(partner.heading) + changedIn(partner.body);
    const renamed = partner !== undefined && partner.title !== fold.title;
    const status: TestFoldStatus = fold.head.changed && partner === undefined ? 'added' : renamed ? 'renamed' : additions + deletions > 0 ? 'modified' : 'unchanged';
    folds.push({
      id: `new:${fold.head.key}`,
      kind: fold.kind,
      ...parentOf(fold, 'new', partner),
      title: fold.title,
      ...(renamed ? { previousTitle: partner.title } : {}),
      status,
      headKey: fold.head.key,
      headingKeys: [...fold.heading.map((line) => line.key), ...(partner?.heading.map((line) => line.key) ?? [])],
      bodyKeys: [...fold.body.map((line) => line.key), ...(partner?.body.map((line) => line.key) ?? [])],
      additions,
      deletions,
    });
  }
  for (const fold of olds) {
    if (paired.has(fold)) continue;
    const deletions = changedIn(fold.heading) + changedIn(fold.body);
    folds.push({
      id: `old:${fold.head.key}`,
      kind: fold.kind,
      ...parentOf(fold, 'old'),
      title: fold.title,
      status: fold.head.changed ? 'removed' : deletions > 0 ? 'modified' : 'unchanged',
      headKey: fold.head.key,
      headingKeys: fold.heading.map((line) => line.key),
      bodyKeys: fold.body.map((line) => line.key),
      additions: 0,
      deletions,
    });
  }
  return folds;
}

/**
 * One custom syntax line from the settings, or the problem with it:
 * - a name (`scenario`, `t.test`): a call or keyword followed by a quoted title, a test;
 * - `suite: name` or `hook: name` for the other kinds (`test: name` says the default);
 * - `/regex/flags`, with the title in a `(?<title>…)` group or the first group, optionally after a kind.
 */
export function parseTestSyntax(line: string): { readonly syntax: TestSyntax } | { readonly problem: string } {
  const text = line.trim();
  const prefixed = /^(suite|test|hook)\s*:\s*(.+)$/i.exec(text);
  const kind: TestBlockKind = prefixed === null ? 'test' : prefixed[1]?.toLowerCase() === 'suite' ? 'suite' : prefixed[1]?.toLowerCase() === 'hook' ? 'hook' : 'test';
  const body = (prefixed?.[2] ?? text).trim();
  const regex = /^\/(.+)\/([a-z]*)$/.exec(body);
  if (regex !== null) {
    const flags = (regex[2] ?? '').replace(/[gy]/g, '');
    try {
      return { syntax: { kind, pattern: new RegExp(regex[1] ?? '', flags) } };
    } catch (error) {
      return { problem: `"${line}" is not a valid regular expression: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
  if (kind === 'hook' && /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(body)) {
    return { syntax: { kind, pattern: new RegExp(String.raw`^\s*(?<title>${body.replace(/[.$]/g, (char) => `\\${char}`)})\b\s*(?:[({]|do\b)`) } };
  }
  if (!/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(body)) {
    return { problem: `"${line}": expected a name such as \`scenario\` or \`t.test\`, \`suite: name\`, or a /regex/.` };
  }
  return { syntax: callSyntax(kind, [body]) };
}

/** The reader's syntaxes first (they win over a built-in reading of the same line), then the built-ins; invalid lines are skipped. */
export function testSyntaxesFrom(lines: readonly string[]): readonly TestSyntax[] {
  const custom = lines.flatMap((line) => {
    const parsed = parseTestSyntax(line);
    return 'syntax' in parsed ? [parsed.syntax] : [];
  });
  return [...custom, ...BUILT_IN_TEST_SYNTAXES];
}
