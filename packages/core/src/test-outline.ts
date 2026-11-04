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
  /** Not on the page: an unchanged line between or outside the diff's hunks, known from the whole file. */
  readonly unseen?: boolean;
}

export type TestFoldStatus = 'added' | 'removed' | 'renamed' | 'modified' | 'unchanged';

/** A test, hook or wholly added or removed suite that folds to one line. */
export interface TestFold {
  /** Stable for the page: the side and line key of its declaration. */
  readonly id: string;
  readonly kind: TestBlockKind;
  readonly title: string;
  /** The old title, for a test whose declaration line changed its title. */
  readonly previousTitle?: string;
  readonly status: TestFoldStatus;
  /** The line its toggle stands on (the new side's declaration, or the old one for a removed test). */
  readonly headKey: string;
  /** The line number it starts on, on its head's side (its first annotation or its declaration), seen on the page or not. */
  readonly start: number;
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
  if (EACH_OPENER.test(line.text)) return eachAt(lines, index);
  return null;
}

/** `it.each([`, `describe.each(\x60` and the like, its cases on the lines after. */
const EACH_OPENER = /^\s*(?:test\.describe|describe|context|suite|it|test|bench)(?:\.[A-Za-z_$][\w$]*)*\.each\s*(?:\((?:\s*[[{(])?|\x60)\s*$/;
/** The line that closes the cases and calls with the title: `])('handles %s', …`, `\x60('…'`, or `])(` with the title below. */
const EACH_CLOSE = new RegExp(String.raw`^\s*(?:[\]})]*\)|\x60)\s*\((?:\s*${QUOTE})?`);
/** Cases read past the opener before giving up on finding the title. */
const EACH_LIMIT = 200;

/** A parameterised declaration whose cases run over several lines: its title follows the line that closes them. */
function eachAt(lines: readonly OutlineLine[], index: number): Declaration | null {
  const opener = lines[index];
  if (opener === undefined) return null;
  const kind: TestBlockKind = OPENER_KIND.test(opener.text) ? 'suite' : 'test';
  const indent = indentOf(opener.text);
  for (let at = index + 1; at < lines.length && at <= index + EACH_LIMIT; at += 1) {
    const line = lines[at];
    const previous = lines[at - 1];
    if (line === undefined || previous === undefined || line.number !== previous.number + 1) return null;
    if (isBlank(line.text) || indentOf(line.text) > indent) continue;
    const close = EACH_CLOSE.exec(line.text);
    if (close === null) return null;
    if (close.groups?.title !== undefined) return { kind, title: titleOf(close), span: at - index + 1 };
    const next = lines[at + 1];
    const title = next !== undefined && next.number === line.number + 1 ? TITLE_LINE.exec(next.text) : null;
    return title === null ? null : { kind, title: titleOf(title), span: at - index + 2 };
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
  /** The number of its first line (an annotation, or the declaration). */
  readonly start: number;
  /** Its first and last line on this side, as indices, so a folded suite holding it can be found. */
  readonly from: number;
  readonly to: number;
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
 * suites added or removed whole (one fold, opening to all of their source).
 * A single added or removed blank line just below a test, or just above one the test before has not taken, folds
 * with it, so a run of folded tests is not broken up by the blank lines between them; two or more blank lines in a
 * row, and the file's unchanged spacing, stay in view.
 */
function foldsOf(lines: readonly OutlineLine[], syntaxes: readonly TestSyntax[]): readonly SideFold[] {
  const blocks = testBlocks(lines, syntaxes);
  // Blocks stand in declaration order and nest, so what holds a block is still open when it is reached: one pass with
  // the open blocks on a stack finds tests that hold tests and hooks inside tests, where comparing every pair of
  // blocks stalled on a whole file of thousands of tests.
  const holdsTests = new Set<Block>();
  const inTest = new Set<Block>();
  const open: Block[] = [];
  for (const block of blocks) {
    while (open.length > 0 && (open[open.length - 1]?.last ?? Number.POSITIVE_INFINITY) < block.head) open.pop();
    for (const outer of open) {
      if (outer.kind === 'test' && block.kind !== 'hook') holdsTests.add(outer);
      if (block.kind === 'hook' && outer.kind !== 'suite') inTest.add(block);
    }
    open.push(block);
  }
  const folds: SideFold[] = [];
  const taken = new Set<number>();
  for (const block of blocks) {
    if (block.last < block.first) continue;
    // A suite folds only when it was added or removed whole: a suite that stays is the structure its tests' titles
    // nest in, and folding it would hide them.
    if (block.kind === 'suite' && !lines.slice(block.start, block.last + 1).every((line) => line.changed)) continue;
    if (holdsTests.has(block)) continue;
    // A hook-shaped line inside a test or hook (a component's `setup() {` in a test) is that test's code, not a hook.
    if (inTest.has(block)) continue;
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
    folds.push({ kind: block.kind, title: block.title, head, start: lines[block.start]?.number ?? head.number, from: block.start, to: block.last, heading: lines.slice(block.start, block.first), body });
  }
  // A folded suite opens to its whole source: the tests and hooks in it are its lines, not folds of their own.
  const suites = folds.filter((fold) => fold.kind === 'suite');
  return suites.length === 0 ? folds : folds.filter((fold) => !suites.some((other) => other !== fold && other.from < fold.from && fold.to <= other.to));
}

const changedIn = (body: readonly OutlineLine[]): number => body.filter((line) => line.changed).length;

const sameText = (shown: string, file: string): boolean => shown.replace(/\s+/g, ' ').trim() === file.replace(/\s+/g, ' ').trim();

/**
 * The new side as the whole file has it: GitHub's own lines where the page
 * shows them, the rest `unseen`. Null when a shown line disagrees with the
 * file (it is not the revision on the page), so nothing is folded by a wrong
 * reading.
 */
function wholeNewSide(shown: readonly OutlineLine[], file: readonly string[]): readonly OutlineLine[] | null {
  const byNumber = new Map(shown.map((line) => [line.number, line]));
  for (const line of shown) if (line.number > file.length || !sameText(line.text, file[line.number - 1] ?? '')) return null;
  return file.map((text, index) => byNumber.get(index + 1) ?? { key: `R${index + 1}`, number: index + 1, text, changed: false, row: Number.NaN, run: Number.NaN, unseen: true });
}

const shownIn = (fold: SideFold): readonly OutlineLine[] => [...fold.heading, ...fold.body].filter((line) => line.unseen !== true);

/**
 * Both sides' folds, paired: a test whose declaration is context folds its
 * old and new bodies together; a declaration rewritten in one run of changes
 * is the same test renamed (or edited, title unchanged); an old declaration
 * with no partner is a removed test, a new one an added test.
 *
 * `file` is the whole new file, when the page leaves some of it out (lines
 * between and around the hunks). Each test's extent is then read from the
 * file, so a test the diff shows only part of (its declaration above the
 * hunk, its end below it) folds whole, declaration and closing line
 * included; its old lines are the unchanged ones on its rows and the removed
 * ones that stand inside it in the new file.
 */
export function outlineTestFolds(sides: { readonly old: readonly OutlineLine[]; readonly new: readonly OutlineLine[] }, syntaxes: readonly TestSyntax[] = BUILT_IN_TEST_SYNTAXES, file: readonly string[] | null = null): readonly TestFold[] {
  const whole = file === null ? null : wholeNewSide(sides.new, file);
  const olds = foldsOf(sides.old, syntaxes);
  const news = foldsOf(whole ?? sides.new, syntaxes).filter((fold) => shownIn(fold).length > 0);
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
  // With the whole file, a test's old lines are also those among its rows that no pairing took: its declaration may
  // be off the page, or its old side cut where a hunk ended.
  const claimed = new Set<string>();
  for (const partner of partners.values()) for (const line of [...partner.heading, ...partner.body]) claimed.add(line.key);
  for (const fold of olds) if (!paired.has(fold)) for (const line of [...fold.heading, ...fold.body]) claimed.add(line.key);
  // Where each removed line stands in the new file: just after the last new line before its run of changes (0 at the
  // top). Before the run, not before the line: split, a run's removals share rows with its additions.
  // Read once per run, at its first removal, which stands on the run's first row (unified or split).
  const after = new Map<string, number>();
  if (whole !== null) {
    const byRow = [...sides.new].sort((a, b) => a.row - b.row);
    const runs = new Map<number, number>();
    let next = 0;
    for (const line of [...sides.old].sort((a, b) => a.row - b.row)) {
      while (next < byRow.length && (byRow[next]?.row ?? Number.POSITIVE_INFINITY) < line.row) next += 1;
      if (!line.changed) continue;
      let place = runs.get(line.run);
      if (place === undefined) {
        let before = next - 1;
        while (before >= 0 && byRow[before]?.run === line.run) before -= 1;
        place = byRow[before]?.number ?? 0;
        runs.set(line.run, place);
      }
      after.set(line.key, place);
    }
  }
  const oldAmong = (fold: SideFold): readonly OutlineLine[] => {
    if (whole === null) return [];
    const rows = new Set(shownIn(fold).map((line) => line.row));
    const end = Math.max(...[...fold.heading, ...fold.body].map((line) => line.number));
    const indent = indentOf(fold.head.text);
    // Its unchanged old lines are those on its rows. A removed line is its own when it stands inside the test in the
    // new file, or right after its last line indented deeper than its declaration (an offside language's test ends at
    // its last indented line, and the file may end there too). A removal just above a test (a helper deleted in the
    // run of changes that added the test, in rows of its own or, split, in the test's rows) is not the test's.
    const own = (line: OutlineLine): boolean => {
      if (!line.changed) return rows.has(line.row);
      const at = after.get(line.key) ?? 0;
      return (at >= fold.start && at < end) || (at === end && indentOf(line.text) > indent);
    };
    const among = sides.old.filter((line) => !claimed.has(line.key) && own(line));
    for (const line of among) claimed.add(line.key);
    return among;
  };
  for (const fold of news) {
    const partner = partners.get(fold);
    const among = oldAmong(fold);
    const additions = changedIn(fold.heading) + changedIn(fold.body);
    const deletions = (partner === undefined ? 0 : changedIn(partner.heading) + changedIn(partner.body)) + changedIn(among);
    const renamed = partner !== undefined && partner.title !== fold.title;
    const status: TestFoldStatus = fold.head.changed && partner === undefined ? 'added' : renamed ? 'renamed' : additions + deletions > 0 ? 'modified' : 'unchanged';
    folds.push({
      id: `new:${fold.head.key}`,
      kind: fold.kind,
      title: fold.title,
      ...(renamed ? { previousTitle: partner.title } : {}),
      status,
      headKey: fold.head.key,
      start: fold.start,
      headingKeys: [...fold.heading.map((line) => line.key), ...(partner?.heading.map((line) => line.key) ?? [])],
      bodyKeys: [...fold.body.map((line) => line.key), ...(partner?.body.map((line) => line.key) ?? []), ...among.map((line) => line.key)],
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
      title: fold.title,
      status: fold.head.changed ? 'removed' : deletions > 0 ? 'modified' : 'unchanged',
      headKey: fold.head.key,
      start: fold.start,
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
