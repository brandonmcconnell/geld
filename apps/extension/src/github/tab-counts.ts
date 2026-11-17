/**
 * On `<html>` while Geld stands the new pull request page's line counts in the tab row: the stylesheet hides GitHub's
 * own beside the branch names and holds their place in the tab row from GitHub's first frame. Settings load
 * asynchronously, so the last decision per repository is kept in the page's storage and applied before the content
 * script's first await (`applyTabCountsHint`); the controller corrects it once the settings are known.
 */
const ATTR_TAB_COUNTS = 'data-geld-tab-counts';
const HINT_KEY = 'geld:tab-counts';
const HINT_CAP = 200;
const PULL_PATH = /^\/([^/]+\/[^/]+)\/pull\/\d+(?:\/|$)/;

export function tabCountsOn(): boolean {
  return document.documentElement.hasAttribute(ATTR_TAB_COUNTS);
}

/** True when it changed: which of the header's counts are GitHub's to rewrite changes with it. */
export function setTabCounts(on: boolean): boolean {
  const html = document.documentElement;
  if (html.hasAttribute(ATTR_TAB_COUNTS) === on) return false;
  html.toggleAttribute(ATTR_TAB_COUNTS, on);
  return true;
}

function readHints(): Record<string, boolean> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(HINT_KEY) ?? '{}');
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'));
  } catch {
    return {};
  }
}

const written = new Map<string, boolean>();

/** Written only when it changes (it is called before paint on every batch); the cap drops the repository seen longest ago. */
export function rememberTabCounts(name: string | null, on: boolean): void {
  if (name === null) return;
  // GitHub's repository names ignore case: `/Acme/Widgets` and `/acme/widgets` are one repository.
  const repo = name.toLowerCase();
  if (written.get(repo) === on) return;
  written.set(repo, on);
  const hints = readHints();
  if (hints[repo] === on) return;
  delete hints[repo];
  hints[repo] = on;
  const entries = Object.entries(hints);
  try {
    window.localStorage.setItem(HINT_KEY, JSON.stringify(Object.fromEntries(entries.slice(Math.max(0, entries.length - HINT_CAP)))));
  } catch {
    // Storage blocked: the next load moves the counts once the settings arrive, a little later.
  }
}

export function applyTabCountsHint(path: string = window.location.pathname): void {
  const repo = PULL_PATH.exec(path)?.[1]?.toLowerCase() ?? null;
  if (repo !== null && readHints()[repo] === true) setTabCounts(true);
}

/** Startup stood down with nobody left to decide (the extension reloaded): GitHub's counts back beside the branch names. */
export function withdrawTabCountsHint(): void {
  document.documentElement.removeAttribute(ATTR_TAB_COUNTS);
}
