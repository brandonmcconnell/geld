import { describe, expect, it } from 'vitest';
import type { OutlineLine, TestFold } from './test-outline';
import { outlineTestFolds, parseTestSyntax, testBlocks, testSyntaxesFrom } from './test-outline';

/** Both sides of a unified diff written as ` `, `+`, `-` lines, numbered from 1, a row per line as GitHub's unified view has it. */
function sides(diff: string): { readonly old: OutlineLine[]; readonly new: OutlineLine[] } {
  const old: OutlineLine[] = [];
  const next: OutlineLine[] = [];
  let oldNumber = 0;
  let newNumber = 0;
  let run = 0;
  let inChange = false;
  diff.split('\n').forEach((raw, row) => {
    const marker = raw.charAt(0);
    const text = raw.slice(1);
    const changed = marker === '+' || marker === '-';
    if (!changed || !inChange) run += 1;
    inChange = changed;
    if (marker !== '+') {
      oldNumber += 1;
      old.push({ key: `L${oldNumber}`, number: oldNumber, text, changed: marker === '-', row, run });
    }
    if (marker !== '-') {
      newNumber += 1;
      next.push({ key: `R${newNumber}`, number: newNumber, text, changed: marker === '+', row, run });
    }
  });
  return { old, new: next };
}

/** One hunk of a unified diff (` `, `+`, `-` lines) starting at the given old and new line numbers, as the page shows it. */
function hunk(diff: string, oldStart: number, newStart: number): { readonly old: OutlineLine[]; readonly new: OutlineLine[] } {
  const old: OutlineLine[] = [];
  const next: OutlineLine[] = [];
  let oldNumber = oldStart - 1;
  let newNumber = newStart - 1;
  let run = 0;
  let inChange = false;
  diff.split('\n').forEach((raw, row) => {
    const marker = raw.charAt(0);
    const text = raw.slice(1);
    const changed = marker === '+' || marker === '-';
    if (!changed || !inChange) run += 1;
    inChange = changed;
    if (marker !== '+') {
      oldNumber += 1;
      old.push({ key: `L${oldNumber}`, number: oldNumber, text, changed: marker === '-', row, run });
    }
    if (marker !== '-') {
      newNumber += 1;
      next.push({ key: `R${newNumber}`, number: newNumber, text, changed: marker === '+', row, run });
    }
  });
  return { old, new: next };
}

const brief = (folds: readonly TestFold[]): readonly string[] =>
  folds.map((fold) => `${fold.status} ${fold.kind} "${fold.title}"${fold.previousTitle === undefined ? '' : ` from "${fold.previousTitle}"`} ${fold.headKey} body=${fold.bodyKeys.length} +${fold.additions} -${fold.deletions}`);

describe('outlineTestFolds', () => {
  it('reads the mint deploy example from the issue: one test removed, one kept, describe left open', () => {
    const diff = [
      " describe('mint deploy', () => {",
      "-  it('continues provisioning after keyring save failure', async () => {",
      '-    vi.mocked(save).mockRejectedValue(new Error());',
      '-    await deploy();',
      '-    expect(provision).toHaveBeenCalled();',
      '-  });',
      '-',
      "   it('persists the exchanged access token for later commands', async () => {",
      '     await deploy();',
      '-    expect(save).toHaveBeenCalled();',
      "+    expect(save).toHaveBeenCalledWith('token');",
      '   });',
      ' });',
    ].join('\n');
    expect(brief(outlineTestFolds(sides(diff)))).toEqual([
      'modified test "persists the exchanged access token for later commands" R2 body=6 +1 -1',
      'removed test "continues provisioning after keyring save failure" L2 body=5 +0 -6',
    ]);
  });

  it('tells an added test, a renamed one and nested suites apart, and folds hooks', () => {
    const diff = [
      " describe('auth', () => {",
      '   beforeEach(() => {',
      '     reset();',
      '   });',
      "   describe('login', () => {",
      "-    it('logs in', () => {",
      "+    it('logs in with a password', () => {",
      '       expect(login()).toBe(true);',
      '     });',
      "+    it.each([1, 2])('retries %i times', (count) => {",
      '+      expect(retry(count)).toBe(count);',
      '+    });',
      '   });',
      ' });',
    ].join('\n');
    expect(brief(outlineTestFolds(sides(diff)))).toEqual([
      'unchanged hook "beforeEach" R2 body=4 +0 -0',
      'renamed test "logs in with a password" from "logs in" R6 body=4 +1 -1',
      'added test "retries %i times" R9 body=2 +3 -0',
    ]);
  });

  it('opens a declaration whose title sits on the next line, and leaves a one-line test alone', () => {
    const diff = ['+test(', "+  'handles a very long title that wrapped',", '+  async () => {', '+    await run();', '+  },', '+);', "+it('is short', () => expect(1).toBe(1));"].join('\n');
    const folds = outlineTestFolds(sides(diff));
    expect(brief(folds)).toEqual(['added test "handles a very long title that wrapped" R1 body=4 +6 -0']);
    expect(folds[0]?.headingKeys).toEqual(['R1', 'R2']);
  });

  it('reads Python, Go subtests, Rust and JUnit annotations, xUnit, RSpec, Elixir and Gherkin', () => {
    const cases: readonly (readonly [string, readonly string[]])[] = [
      [[' class TestDeploy:', '+    def setUp(self):', '+        self.x = 1', '+', '+    def test_saves_token(self):', '+        assert save()', '+'].join('\n'), ['added hook "setUp" R2 body=2 +3 -0', 'added test "test_saves_token" R5 body=2 +3 -0']],
      [
        ['+func TestParse(t *testing.T) {', '+\tt.Run("empty input", func(t *testing.T) {', '+\t\tif Parse("") != nil {', '+\t\t\tt.Fatal()', '+\t\t}', '+\t})', '+}'].join('\n'),
        ['added test "empty input" R2 body=4 +5 -0'],
      ],
      [['+#[test]', '+fn adds_two() {', '+    assert_eq!(add(1, 1), 2);', '+}'].join('\n'), ['added test "adds_two" R2 body=2 +4 -0']],
      [['+    @Test', '+    @DisplayName("adds two numbers")', '+    void adds() {', '+        assertEquals(2, add(1, 1));', '+    }'].join('\n'), ['added test "adds two numbers" R3 body=2 +5 -0']],
      [['+    [Fact]', '+    public async Task SavesToken()', '+    {', '+        await Save();', '+    }'].join('\n'), ['added test "SavesToken" R2 body=3 +5 -0']],
      [['+  @Test("adds two numbers") func adds() {', '+    #expect(add(1, 1) == 2)', '+  }'].join('\n'), ['added test "adds two numbers" R1 body=2 +3 -0']],
      [['+  it "persists the token" do', '+    expect(token).to be_present', '+  end'].join('\n'), ['added test "persists the token" R1 body=2 +3 -0']],
      [['+  test "saves the token", %{conn: conn} do', '+    assert save(conn)', '+  end'].join('\n'), ['added test "saves the token" R1 body=2 +3 -0']],
      [[' Feature: Deploy', '+  Scenario: Saving the token', '+    Given a token', '+    Then it is saved'].join('\n'), ['added test "Saving the token" R2 body=2 +3 -0']],
      [['+    fun `adds two numbers`() {', '+        assertEquals(2, add(1, 1))', '+    }'].join('\n'), []],
      [['+    @Test', '+    fun `adds two numbers`() {', '+        assertEquals(2, add(1, 1))', '+    }'].join('\n'), ['added test "adds two numbers" R2 body=2 +4 -0']],
    ];
    for (const [diff, expected] of cases) expect(brief(outlineTestFolds(sides(diff)))).toEqual(expected);
  });

  it('opens `test.each([…])(` with its title on the next line', () => {
    const diff = ["+test.each(['automock', 'autospy'] as const)(", "+  '%s mocks prototype methods',", '+  (type) => {', '+    expect(mock(type)).toBeDefined()', '+  },', '+)'].join('\n');
    expect(brief(outlineTestFolds(sides(diff)))).toEqual(['added test "%s mocks prototype methods" R1 body=4 +6 -0']);
  });

  it('pairs an edited test by its title when a new one is inserted just before it in the same run', () => {
    const diff = ["-  it('keeps the token', async () => {", "+  it('saves the token', () => {", '+    save();', '+  });', "+  it('keeps the token', () => {", '     expect(token).toBeDefined();', '   });'].join('\n');
    expect(brief(outlineTestFolds(sides(diff)))).toEqual(['added test "saves the token" R1 body=2 +3 -0', 'modified test "keeps the token" R4 body=4 +1 -1']);
  });

  it('reads `.each` arguments with calls inside them, on the line and before a wrapped title', () => {
    const diff = ["+it.each(cases.map((c) => make(c)))('handles %s', (c) => {", '+  run(c);', '+});', '+test.each(cases.map(makeCase))(', "+  'wraps %s',", '+  (c) => {', '+    run(c);', '+  },', '+);'].join('\n');
    expect(brief(outlineTestFolds(sides(diff)))).toEqual(['added test "handles %s" R1 body=2 +3 -0', 'added test "wraps %s" R4 body=4 +6 -0']);
  });

  it('folds a dotted hook the reader declared', () => {
    const diff = ['+t.beforeEach(() => {', '+  reset();', '+});'].join('\n');
    expect(brief(outlineTestFolds(sides(diff), testSyntaxesFrom(['hook: t.beforeEach'])))).toEqual(['added hook "t.beforeEach" R1 body=2 +3 -0']);
  });

  it('reads a Go raw-string subtest title that ends in a backslash', () => {
    const diff = ['+func TestPaths(t *testing.T) {', '+\tt.Run(`C:\\`, func(t *testing.T) {', '+\t\tcheck(t)', '+\t})', '+}'].join('\n');
    expect(brief(outlineTestFolds(sides(diff)))).toEqual(['added test "C:\\" R2 body=2 +3 -0']);
  });

  it('reads a line of spaces after a test name, or after an annotated function’s type, in linear time', () => {
    const spaces = ' '.repeat(50_000);
    const lines = [`it${spaces}x`, `"title"${spaces}x`, `it.each(${spaces}cases`, '@Test', `void${spaces}x`].map((text, row) => ({ key: `R${row + 1}`, number: row + 1, text, changed: true, row, run: 1 }));
    const started = performance.now();
    expect(outlineTestFolds({ old: [], new: lines })).toEqual([]);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('reads a ScalaTest `in{` with no space, and a custom regex’s first group whatever other groups it names', () => {
    const scala = ['+  "handles input" in{', '+    assert(run())', '+  }'].join('\n');
    expect(brief(outlineTestFolds(sides(scala)))).toEqual(['added test "handles input" R1 body=2 +3 -0']);
    const custom = ['+check "the cart" for (?<x>items) {', '+  pay()', '+}'].join('\n');
    expect(brief(outlineTestFolds(sides(custom), testSyntaxesFrom(['/^check "(.*?)" for \\(\\?<x>(?<name>\\w+)\\)/'])))).toEqual(['added test "the cart" R1 body=2 +3 -0']);
  });

  it('leaves a hook-shaped line inside a test as the test’s own code', () => {
    const diff = ["+it('mounts', () => {", '+  const Comp = {', '+    setup() {', '+      return {}', '+    },', '+  }', '+  mount(Comp)', '+})'].join('\n');
    expect(brief(outlineTestFolds(sides(diff)))).toEqual(['added test "mounts" R1 body=7 +8 -0']);
  });

  it('reads a line of backslashes with no closing quote in linear time', () => {
    const lines = ['it(', 'test.Run(', 't.Run('].map((opener, row) => ({ key: `R${row + 1}`, number: row + 1, text: `${opener}'${'\\'.repeat(20_000)}`, changed: true, row, run: 1 }));
    const started = performance.now();
    expect(outlineTestFolds({ old: [], new: lines })).toEqual([]);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('folds one blank line beside a test into it, the test above first, and leaves a run of blank lines in view', () => {
    const diff = ["+it('a', () => {", '+  one();', '+});', '+', "+it('b', () => {", '+  two();', '+});', '+', '+', "+it('c', () => {", '+  three();', '+});'].join('\n');
    expect(brief(outlineTestFolds(sides(diff)))).toEqual(['added test "a" R1 body=3 +4 -0', 'added test "b" R5 body=2 +3 -0', 'added test "c" R10 body=2 +3 -0']);
  });

  it('leaves an unchanged blank line beside an added test in view', () => {
    const diff = [' })', ' ', "+it('a', () => {", '+  one();', '+});', '+'].join('\n');
    expect(brief(outlineTestFolds(sides(diff)))).toEqual(['added test "a" R3 body=3 +4 -0']);
  });

  it('folds a suite removed whole into one line that opens to all of its source, and leaves a suite that stays open', () => {
    const diff = [
      " describe('LinearRouter', () => {",
      "-  describe('Trailing slash', () => {",
      '-    const router = new LinearRouter()',
      '-',
      '-    beforeEach(() => {',
      "-      router.add('GET', '/book')",
      '-    })',
      '-',
      "-    it('GET /book/', () => {",
      "-      expect(router.match('GET', '/book/')).toHaveLength(1)",
      '-    })',
      '-  })',
      '-',
      ' })',
    ].join('\n');
    expect(brief(outlineTestFolds(sides(diff)))).toEqual(['removed suite "Trailing slash" L2 body=11 +0 -12']);
  });

  it('reads a PHPUnit method with its brace on the next line as a test with a body', () => {
    const diff = ['+    public function testSavesToken()', '+    {', '+        $this->assertTrue(save());', '+    }'].join('\n');
    expect(brief(outlineTestFolds(sides(diff)))).toEqual(['added test "testSavesToken" R1 body=3 +4 -0']);
  });

  it('reads the body of a Gherkin scenario ending in parentheses, and of a call whose comment holds brackets', () => {
    const gherkin = [' Feature: Deploy', '+  Scenario: Saving the token (expired)', '+    Given a token', '+    Then it is refreshed'].join('\n');
    expect(brief(outlineTestFolds(sides(gherkin)))).toEqual(['added test "Saving the token (expired)" R2 body=2 +3 -0']);
    const commented = ["+it('handles', () => { // })", '+  run();', '+});'].join('\n');
    expect(brief(outlineTestFolds(sides(commented)))).toEqual(['added test "handles" R1 body=2 +3 -0']);
  });

  it('checks a line of escaped quotes for a one-line call in linear time', () => {
    const lines = [`it('t', () => run()) // ${'\\"'.repeat(40_000)}`].map((text, row) => ({ key: `R${row + 1}`, number: row + 1, text, changed: true, row, run: 1 }));
    const started = performance.now();
    outlineTestFolds({ old: [], new: lines });
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('keeps a whole one-line test from taking the deeper line after it', () => {
    const diff = ["+  it('adds', () => expect(add(1, 1)).toBe(2));", '+    unrelated();', "+  it('subtracts', () => {", '+    expect(sub(2, 1)).toBe(1);', '+  });'].join('\n');
    expect(brief(outlineTestFolds(sides(diff)))).toEqual(['added test "subtracts" R3 body=2 +3 -0']);
  });

  it('folds the annotations that make a function a test into its declaration', () => {
    const folds = outlineTestFolds(sides(['+    @Test', '+    void adds() {', '+        check();', '+    }'].join('\n')));
    expect(folds[0]?.headingKeys).toEqual(['R1', 'R2']);
  });

  it('reads a parameterised test whose cases run over several lines, its title after them', () => {
    const diff = [
      '+      it.each([',
      "+        '/api/:id{[0-9]?}',",
      "+        '/user/:id{[0-9]*}',",
      "+      ])('%s', (path) => {",
      '+        const router = new RegExpRouter()',
      "+        expect(() => router.add('GET', path, 'ok')).toThrow()",
      '+      })',
      '+      describe.each([',
      '+        [1, 2],',
      '+      ])(',
      "+        'adds %i and %i',",
      '+        (a, b) => {',
      '+          check(a, b)',
      '+        },',
      '+      )',
    ].join('\n');
    expect(brief(outlineTestFolds(sides(diff)))).toEqual(['added test "%s" R1 body=3 +7 -0', 'added suite "adds %i and %i" R8 body=4 +8 -0']);
  });

  it('never joins lines across a gap in the numbering', () => {
    const { new: lines } = sides(["+it('a', () => {", '+  one();'].join('\n'));
    const after: OutlineLine = { key: 'R10', number: 10, text: '  far();', changed: false, row: 9, run: 9 };
    expect(brief(outlineTestFolds({ old: [], new: [...lines, after] }))).toEqual(['added test "a" R1 body=1 +2 -0']);
  });

  it('uses the reader’s syntaxes before the built-ins', () => {
    const diff = ["+scenario('checks out', () => {", '+  pay();', '+});',  " feature('cart', () => {", "+  check('has items', () => {", '+    expect(cart).not.toBeEmpty();', '+  });', ' });'].join('\n');
    expect(brief(outlineTestFolds(sides(diff), testSyntaxesFrom(['check', 'suite: feature'])))).toEqual([
      'added test "checks out" R1 body=2 +3 -0',
      'added test "has items" R5 body=2 +3 -0',
    ]);
    expect(testBlocks(sides(diff).new, testSyntaxesFrom(['check', 'suite: feature'])).map((block) => `${block.kind} ${block.title}`)).toContain('suite cart');
  });
});

describe('parseTestSyntax', () => {
  it('takes names, kinds and regular expressions, and says what is wrong with anything else', () => {
    expect('syntax' in parseTestSyntax('scenario')).toBe(true);
    expect('syntax' in parseTestSyntax('suite: feature')).toBe(true);
    expect('syntax' in parseTestSyntax('hook: givenEach')).toBe(true);
    const regex = parseTestSyntax('test: /^\\s*verify "(?<title>[^"]+)"/');
    expect('syntax' in regex && regex.syntax.kind === 'test' && regex.syntax.pattern.exec('  verify "it works"')?.groups?.title).toBe('it works');
    expect(parseTestSyntax('/(unclosed/')).toMatchObject({ problem: expect.stringMatching(/not a valid regular expression/) });
    expect(parseTestSyntax('two words')).toMatchObject({ problem: expect.stringMatching(/expected a name/) });
  });
});

describe('outlineTestFolds with the whole file', () => {
  const file = [
    "describe('array', () => {",
    "  it('spies', () => {",
    '    const spy = vi.fn()',
    '    spy()',
    '    expect(spy).toHaveBeenCalled()',
    '  })',
    '',
    "  it('adds', () => {",
    '    expect(1).toBe(1)',
    '  })',
    '})',
  ];
  // The hunk starts inside the first test: its declaration is three lines above what the page shows.
  const diff = hunk(['     expect(spy).toHaveBeenCalled()', '   })', ' ', "+  it('adds', () => {", '+    expect(1).toBe(1)', '+  })', ' })'].join('\n'), 5, 5);

  it('folds a test the hunk shows only the end of, closing line and all, from where it starts', () => {
    const folds = outlineTestFolds(diff, undefined, file);
    expect(folds.map((fold) => `${fold.status} "${fold.title}" ${fold.headKey} start=${fold.start}`)).toEqual(['unchanged "spies" R2 start=2', 'added "adds" R8 start=8']);
    const spies = folds[0];
    // Its shown lines on both sides (the closing `})` among them) and the lines above the hunk, which the page does not show.
    expect(spies?.bodyKeys).toEqual(expect.arrayContaining(['R3', 'R4', 'R5', 'R6', 'L5', 'L6']));
    expect(spies?.headingKeys).toEqual(['R2']);
  });

  it('leaves such a test open without the file, and with a file that is not the one on the page', () => {
    const titles = (folds: readonly TestFold[]): readonly string[] => folds.map((fold) => fold.title);
    expect(titles(outlineTestFolds(diff))).toEqual(['adds']);
    expect(titles(outlineTestFolds(diff, undefined, file.map((line) => line.replace('toHaveBeenCalled()', 'toHaveBeenCalledOnce()'))))).toEqual(['adds']);
  });

  it('reads a test whose end lies below the hunk, and keeps its old lines and counts', () => {
    const longer = ["it('reads', () => {", '  const value = read()', '  expect(value).toBe(2)', '  expect(other).toBe(3)', '  expect(more).toBe(4)', '})'];
    const cut = hunk([" it('reads', () => {", '-  const value = read(1)', '+  const value = read()', '   expect(value).toBe(2)'].join('\n'), 1, 1);
    const [fold] = outlineTestFolds(cut, undefined, longer);
    expect(fold).toMatchObject({ status: 'modified', title: 'reads', start: 1, additions: 1, deletions: 1 });
    // The closing line and the lines before it are the test's, off the page; the old line it replaced is in too.
    expect(fold?.bodyKeys).toEqual(expect.arrayContaining(['R2', 'R3', 'R4', 'R5', 'R6', 'L2', 'L3']));
  });

  it('leaves a helper removed beside an added test in view, unified or split', () => {
    const file = ["describe('a', () => {", "  it('new', () => {", '    expect(2).toBe(2)', '  })', "  it('old', () => {", '    expect(1).toBe(1)', '  })', '})'];
    const unified = hunk([" describe('a', () => {", '-  function helper() {', '-    return 1', '-  }', "+  it('new', () => {", '+    expect(2).toBe(2)', '+  })', "   it('old', () => {"].join('\n'), 1, 1);
    const removed = ['L2', 'L3', 'L4'];
    const keysOf = (folds: readonly TestFold[]): readonly string[] => folds.flatMap((fold) => [...fold.headingKeys, ...fold.bodyKeys]);
    const unifiedFolds = outlineTestFolds(unified, undefined, file);
    expect(unifiedFolds.map((fold) => `${fold.status} "${fold.title}"`)).toEqual(['added "new"', 'unchanged "old"']);
    expect(keysOf(unifiedFolds).filter((key) => removed.includes(key))).toEqual([]);
    // Split: each removed helper line shares a row with an added line of the test.
    const line = (key: string, number: number, text: string, changed: boolean, row: number, run: number): OutlineLine => ({ key, number, text, changed, row, run });
    const split = {
      old: [line('L1', 1, file[0] ?? '', false, 0, 1), line('L2', 2, '  function helper() {', true, 1, 2), line('L3', 3, '    return 1', true, 2, 2), line('L4', 4, '  }', true, 3, 2), line('L5', 5, file[4] ?? '', false, 4, 3)],
      new: [line('R1', 1, file[0] ?? '', false, 0, 1), line('R2', 2, file[1] ?? '', true, 1, 2), line('R3', 3, file[2] ?? '', true, 2, 2), line('R4', 4, file[3] ?? '', true, 3, 2), line('R5', 5, file[4] ?? '', false, 4, 3)],
    };
    expect(keysOf(outlineTestFolds(split, undefined, file)).filter((key) => removed.includes(key))).toEqual([]);
  });

  it('reads a file of thousands of tests in one pass', () => {
    const file = Array.from({ length: 4000 }, (_, index) => [`it('case ${index}', () => {`, `  expect(${index}).toBe(${index})`, '})']).flat();
    const shown = hunk([` it('case 2000', () => {`, '-  expect(0).toBe(0)', '+  expect(2000).toBe(2000)', ' })'].join('\n'), 6001, 6001);
    const started = performance.now();
    const folds = outlineTestFolds(shown, undefined, file);
    expect(performance.now() - started).toBeLessThan(500);
    expect(folds.map((fold) => fold.title)).toEqual(['case 2000']);
  });

  it('keeps a removed last line in a test that runs to the end of the file', () => {
    const file = ['import pytest', '', 'def test_reads():', '    value = read()', '    other = read()', '    assert value == 2'];
    // Replaced, and removed outright: the declaration is above the hunk either way, and Python has no closing line.
    const replaced = hunk(['     value = read()', '     other = read()', '-    assert value == 1', '+    assert value == 2'].join('\n'), 4, 4);
    expect(outlineTestFolds(replaced, undefined, file)[0]).toMatchObject({ title: 'test_reads', additions: 1, deletions: 1 });
    expect(outlineTestFolds(replaced, undefined, file)[0]?.bodyKeys).toContain('L6');
    const removed = hunk(['     value = read()', '     other = read()', '-    assert value == 1'].join('\n'), 4, 4);
    const shorter = file.slice(0, 5);
    expect(outlineTestFolds(removed, undefined, shorter)[0]).toMatchObject({ title: 'test_reads', deletions: 1 });
  });

  it('places a long split replacement\'s removals in one pass', () => {
    const size = 20000;
    const file = ["it('rewrites', () => {", ...Array.from({ length: size }, (_, index) => `  expect(${index}).toBe(${index})`), '})'];
    const line = (key: string, number: number, text: string, changed: boolean, row: number, run: number): OutlineLine => ({ key, number, text, changed, row, run });
    const old = [line('L1', 1, file[0] ?? '', false, 0, 1), ...Array.from({ length: size }, (_, index) => line(`L${index + 2}`, index + 2, `  expect(${index}).toBe(0)`, true, index + 1, 2)), line(`L${size + 2}`, size + 2, '})', false, size + 1, 3)];
    const next = [line('R1', 1, file[0] ?? '', false, 0, 1), ...Array.from({ length: size }, (_, index) => line(`R${index + 2}`, index + 2, file[index + 1] ?? '', true, index + 1, 2)), line(`R${size + 2}`, size + 2, '})', false, size + 1, 3)];
    const started = performance.now();
    const [fold] = outlineTestFolds({ old, new: next }, undefined, file);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(fold).toMatchObject({ title: 'rewrites', additions: size, deletions: size });
  });
});
