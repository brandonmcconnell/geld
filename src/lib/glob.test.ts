import { compileGlobs, expandBraces, globToRegExp } from './glob';

describe('expandBraces', () => {
  it('returns the pattern untouched when there are no braces', () => {
    expect(expandBraces('*.snap')).toEqual(['*.snap']);
  });

  it('expands a single group', () => {
    expect(expandBraces('*.{js,ts}')).toEqual(['*.js', '*.ts']);
  });

  it('expands nested and multiple groups', () => {
    expect(expandBraces('{a,b}.{x,{y,z}}')).toEqual(['a.x', 'a.y', 'a.z', 'b.x', 'b.y', 'b.z']);
  });
});

describe('globToRegExp', () => {
  const matches = (pattern: string, path: string): boolean => globToRegExp(pattern).test(path);

  it('matches basenames at any depth', () => {
    expect(matches('*.snap', 'a.snap')).toBe(true);
    expect(matches('*.snap', 'deep/nested/__snapshots__/a.snap')).toBe(true);
    expect(matches('*.snap', 'a.snapshot')).toBe(false);
  });

  it('does not let * cross path separators', () => {
    expect(matches('src/*.ts', 'src/a.ts')).toBe(true);
    expect(matches('src/*.ts', 'src/sub/a.ts')).toBe(false);
  });

  it('supports ** for any number of segments', () => {
    expect(matches('src/**/*.ts', 'src/a.ts')).toBe(true);
    expect(matches('src/**/*.ts', 'src/x/y/a.ts')).toBe(true);
    expect(matches('src/**/*.ts', 'lib/a.ts')).toBe(false);
    expect(matches('docs/**', 'docs/guide/index.md')).toBe(true);
  });

  it('treats trailing slash as "directory anywhere, with everything inside"', () => {
    expect(matches('tests/', 'tests/a.ts')).toBe(true);
    expect(matches('tests/', 'packages/x/tests/deep/a.ts')).toBe(true);
    expect(matches('tests/', 'tests')).toBe(true);
    expect(matches('tests/', 'my-tests/a.ts')).toBe(false);
    expect(matches('tests/', 'src/testsuite/a.ts')).toBe(false);
  });

  it('supports wildcards in directory patterns', () => {
    expect(matches('*.Tests/', 'src/App.Tests/UnitTest1.cs')).toBe(true);
    expect(matches('*-snapshots/', 'e2e/home.spec.ts-snapshots/home-1-chromium.png')).toBe(true);
  });

  it('supports ? and character classes', () => {
    expect(matches('file?.ts', 'file1.ts')).toBe(true);
    expect(matches('file?.ts', 'file12.ts')).toBe(false);
    expect(matches('file[0-9].ts', 'file7.ts')).toBe(true);
    expect(matches('file[!0-9].ts', 'file7.ts')).toBe(false);
  });

  it('escapes regular expression metacharacters', () => {
    expect(matches('a.b', 'a.b')).toBe(true);
    expect(matches('a.b', 'aXb')).toBe(false);
    expect(matches('(x)+y', 'src/(x)+y')).toBe(true);
  });

  it('is case sensitive by default and can be made insensitive', () => {
    expect(matches('*Test.java', 'latest.java')).toBe(false);
    expect(matches('*Test.java', 'FooTest.java')).toBe(true);
    expect(globToRegExp('README', { caseSensitive: false }).test('docs/readme')).toBe(true);
  });
});

describe('compileGlobs', () => {
  it('supports negated patterns that veto matches', () => {
    const globs = compileGlobs(['*.spec.*', '!*.spec.yaml']);
    expect(globs.test('api.spec.ts')).toBe(true);
    expect(globs.test('openapi.spec.yaml')).toBe(false);
  });

  it('ignores blank lines and comments', () => {
    const globs = compileGlobs(['', '# comment', '  *.snap  ']);
    expect(globs.test('a.snap')).toBe(true);
    expect(globs.test('# comment')).toBe(false);
  });

  it('normalizes leading ./ and backslashes', () => {
    const globs = compileGlobs(['tests/']);
    expect(globs.test('./tests/a.ts')).toBe(true);
    expect(globs.test('tests\\a.ts')).toBe(true);
  });

  it('reports the first matching include pattern', () => {
    const globs = compileGlobs(['*.snap', 'tests/']);
    expect(globs.firstMatch('tests/a.snap')).toBe('*.snap');
    expect(globs.firstMatch('tests/a.ts')).toBe('tests/');
    expect(globs.firstMatch('src/a.ts')).toBeNull();
  });
});
