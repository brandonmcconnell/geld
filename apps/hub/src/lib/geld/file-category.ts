import { createMatcher, type PathMatcher } from "@geld/core/matcher";
import { DEFAULT_SETTINGS, type GeldSettings } from "@geld/core/settings";

let settings: GeldSettings = DEFAULT_SETTINGS;
let matcher: PathMatcher | null = null;
const listeners = new Set<() => void>();

/** Puts the reader's own settings behind every category the hub shows in the browser. */
export function setReaderSettings(next: GeldSettings) {
  if (next === settings) return;
  settings = next;
  matcher = null;
  for (const listener of listeners) listener();
}

export function subscribeReaderSettings(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function readerSettings(): GeldSettings {
  return settings;
}

export function readerMatcher(): PathMatcher {
  matcher ??= createMatcher(settings);
  return matcher;
}

/**
 * The Geld category a changed file falls in under the reader's settings, by
 * its path. Null means the file is left to review.
 */
export function fileCategory(path: string): string | null {
  return readerMatcher().categorize(path)?.title ?? null;
}
