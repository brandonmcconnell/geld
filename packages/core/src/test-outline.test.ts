import { describe, expect, it } from 'vitest';
import type { OutlineLine, TestFold } from './test-outline';
import { outlineTestFolds, parseTestSyntax, testSyntaxesFrom } from './test-outline';

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
      'removed test "continues provisioning after keyring save failure" L2 body=4 +0 -5',
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
    expect(brief(outlineTestFolds(sides(diff)))).toEqual(['added test "handles a very long title that wrapped" R1 body=4 +6 -0']);
  });

  it('reads Python, Go subtests, Rust and JUnit annotations, xUnit, RSpec, Elixir and Gherkin', () => {
    const cases: readonly (readonly [string, readonly string[]])[] = [
      [['+class TestDeploy:', '+    def setUp(self):', '+        self.x = 1', '+', '+    def test_saves_token(self):', '+        assert save()', '+'].join('\n'), ['added hook "setUp" R2 body=1 +2 -0', 'added test "test_saves_token" R5 body=1 +2 -0']],
      [
        ['+func TestParse(t *testing.T) {', '+\tt.Run("empty input", func(t *testing.T) {', '+\t\tif Parse("") != nil {', '+\t\t\tt.Fatal()', '+\t\t}', '+\t})', '+}'].join('\n'),
        ['added test "empty input" R2 body=4 +5 -0'],
      ],
      [['+#[test]', '+fn adds_two() {', '+    assert_eq!(add(1, 1), 2);', '+}'].join('\n'), ['added test "adds_two" R2 body=2 +3 -0']],
      [['+    @Test', '+    @DisplayName("adds two numbers")', '+    void adds() {', '+        assertEquals(2, add(1, 1));', '+    }'].join('\n'), ['added test "adds two numbers" R3 body=2 +3 -0']],
      [['+    [Fact]', '+    public async Task SavesToken()', '+    {', '+        await Save();', '+    }'].join('\n'), ['added test "SavesToken" R2 body=3 +4 -0']],
      [['+  @Test("adds two numbers") func adds() {', '+    #expect(add(1, 1) == 2)', '+  }'].join('\n'), ['added test "adds two numbers" R1 body=2 +3 -0']],
      [['+  it "persists the token" do', '+    expect(token).to be_present', '+  end'].join('\n'), ['added test "persists the token" R1 body=2 +3 -0']],
      [['+  test "saves the token", %{conn: conn} do', '+    assert save(conn)', '+  end'].join('\n'), ['added test "saves the token" R1 body=2 +3 -0']],
      [['+Feature: Deploy', '+  Scenario: Saving the token', '+    Given a token', '+    Then it is saved'].join('\n'), ['added test "Saving the token" R2 body=2 +3 -0']],
      [['+    fun `adds two numbers`() {', '+        assertEquals(2, add(1, 1))', '+    }'].join('\n'), []],
      [['+    @Test', '+    fun `adds two numbers`() {', '+        assertEquals(2, add(1, 1))', '+    }'].join('\n'), ['added test "adds two numbers" R2 body=2 +3 -0']],
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

  it('folds a dotted hook the reader declared', () => {
    const diff = ['+t.beforeEach(() => {', '+  reset();', '+});'].join('\n');
    expect(brief(outlineTestFolds(sides(diff), testSyntaxesFrom(['hook: t.beforeEach'])))).toEqual(['added hook "t.beforeEach" R1 body=2 +3 -0']);
  });

  it('never joins lines across a gap in the numbering', () => {
    const { new: lines } = sides(["+it('a', () => {", '+  one();'].join('\n'));
    const after: OutlineLine = { key: 'R10', number: 10, text: '  far();', changed: false, row: 9, run: 9 };
    expect(brief(outlineTestFolds({ old: [], new: [...lines, after] }))).toEqual(['added test "a" R1 body=1 +2 -0']);
  });

  it('uses the reader’s syntaxes before the built-ins', () => {
    const diff = ["+scenario('checks out', () => {", '+  pay();', '+});', "+feature('cart', () => {", "+  check('has items', () => {", '+    expect(cart).not.toBeEmpty();', '+  });', '+});'].join('\n');
    expect(brief(outlineTestFolds(sides(diff), testSyntaxesFrom(['check', 'suite: feature'])))).toEqual([
      'added test "checks out" R1 body=2 +3 -0',
      'added test "has items" R5 body=2 +3 -0',
    ]);
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
