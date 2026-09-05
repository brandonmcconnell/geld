import { compileGlobs } from './glob';
import type { GeldSettings } from './settings';
import { allBuiltInTestPatterns } from './test-patterns';

/**
 * A category of files that Geld can hide. Only "tests" exists today, but the
 * content script is written against this interface so adding categories such
 * as "generated" or "lockfiles" is a data change rather than a rewrite.
 */
export interface HiddenCategory {
  readonly id: 'tests';
  /** Singular noun used in UI copy, e.g. "test file". */
  readonly noun: string;
  /** Plural noun used in UI copy, e.g. "test files". */
  readonly nounPlural: string;
  /** Compact nouns for the "N tests" count label next to line counts. */
  readonly shortNoun: string;
  readonly shortNounPlural: string;
  /** Short title used for the pseudo-section in the file tree. */
  readonly title: string;
}

export const TESTS_CATEGORY: HiddenCategory = {
  id: 'tests',
  noun: 'test file',
  nounPlural: 'test files',
  shortNoun: 'test',
  shortNounPlural: 'tests',
  title: 'Tests',
};

export interface PathMatcher {
  /** Returns the category a path belongs to, or `null` if it should stay visible. */
  categorize(path: string): HiddenCategory | null;
}

const NEVER_MATCH: PathMatcher = {
  categorize: () => null,
};

/** Build the matcher that decides which files are hidden for the given settings. */
export function createMatcher(settings: GeldSettings): PathMatcher {
  if (!settings.enabled) return NEVER_MATCH;

  const patterns: string[] = [];
  if (settings.hideTests) patterns.push(...allBuiltInTestPatterns());
  patterns.push(...settings.customPatterns);
  if (patterns.length === 0) return NEVER_MATCH;

  const globs = compileGlobs(patterns);
  const cache = new Map<string, boolean>();

  return {
    categorize(path: string): HiddenCategory | null {
      let matched = cache.get(path);
      if (matched === undefined) {
        matched = globs.test(path);
        cache.set(path, matched);
      }
      return matched ? TESTS_CATEGORY : null;
    },
  };
}
