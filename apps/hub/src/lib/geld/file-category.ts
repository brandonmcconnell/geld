import { createMatcher, type PathMatcher } from "@geld/core/matcher";
import { DEFAULT_SETTINGS } from "@geld/core/settings";

let matcher: PathMatcher | null = null;

/**
 * The Geld category a changed file falls in under the default settings, by
 * its path. Null means the file is left to review.
 */
export function defaultFileCategory(path: string): string | null {
  matcher ??= createMatcher(DEFAULT_SETTINGS);
  return matcher.categorize(path)?.title ?? null;
}

export function defaultMatcher(): PathMatcher {
  matcher ??= createMatcher(DEFAULT_SETTINGS);
  return matcher;
}
