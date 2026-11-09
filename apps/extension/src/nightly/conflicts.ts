/**
 * Which other Geld keeps this nightly build from running. Two copies of Geld in one profile would both run
 * on every GitHub page and fight over it, so the nightly build, which can see the profile's extensions, steps
 * aside. Geld Stable is never asked to do anything: it does not know the nightly build exists.
 */

/** The store listings' ids (apps/site/lib/downloads.ts links them). */
export const STABLE_IDS: readonly string[] = ['nfbkhldmnfgeeldfafojajnfanikbhia', 'bdakebdlgaomkblemgabkoofoiellhmi'];
/** Mirrors `homepage_url` in wxt.config.ts: how an unpacked store build (`pnpm build`) is told apart from another extension named Geld. */
export const GELD_HOMEPAGE = 'https://github.com/brandonmcconnell/geld';

export interface ExtensionLike {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly type?: string | undefined;
  readonly homepageUrl?: string | undefined;
}

export type Conflict =
  | { readonly kind: 'stable'; readonly id: string }
  | { readonly kind: 'nightly'; readonly id: string };

function isOurs(extension: ExtensionLike): boolean {
  return extension.homepageUrl?.replace(/\/+$/, '') === GELD_HOMEPAGE;
}

/** Two nightly copies would each see the other, so only the one with the greater id steps aside. */
export function conflictFor(selfId: string, extensions: readonly ExtensionLike[]): Conflict | null {
  const others = extensions.filter((extension) => extension.id !== selfId && extension.enabled && (extension.type === undefined || extension.type === 'extension'));
  const stable = others.find((extension) => STABLE_IDS.includes(extension.id) || (extension.name === 'Geld' && isOurs(extension)));
  if (stable !== undefined) return { kind: 'stable', id: stable.id };
  const nightly = others.find((extension) => extension.name === 'Geld Nightly' && isOurs(extension) && extension.id < selfId);
  return nightly === undefined ? null : { kind: 'nightly', id: nightly.id };
}

export function sameConflict(a: Conflict | null, b: Conflict | null): boolean {
  return a === null || b === null ? a === b : a.kind === b.kind && a.id === b.id;
}

/** The content scripts the store manifest declares, as the nightly build registers them itself (wxt.config.ts moves them out of its manifest). */
export const CONTENT_SCRIPTS_FILE = 'nightly-content-scripts.json';

export interface DeclaredScript {
  readonly matches: readonly string[];
  readonly js: readonly string[];
  readonly css: readonly string[];
  readonly runAt: 'document_start' | 'document_end' | 'document_idle';
  readonly world: 'ISOLATED' | 'MAIN';
  readonly allFrames: boolean;
}

function strings(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const list: readonly unknown[] = value;
  const result = list.filter((item): item is string => typeof item === 'string');
  return result.length === list.length ? result : null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const RUN_AT = ['document_start', 'document_end', 'document_idle'] as const;

/** Reads the manifest's `content_scripts` array, or null when any entry is not one Geld could register. */
export function parseDeclaredScripts(value: unknown): DeclaredScript[] | null {
  if (!Array.isArray(value)) return null;
  const entries: readonly unknown[] = value;
  const scripts: DeclaredScript[] = [];
  for (const entry of entries) {
    if (!isRecord(entry)) return null;
    const matches = strings(entry['matches']);
    const js = strings(entry['js']);
    const css = strings(entry['css']);
    const runAt = RUN_AT.find((value) => value === (entry['run_at'] ?? 'document_idle'));
    const world = entry['world'] === undefined || entry['world'] === 'ISOLATED' ? 'ISOLATED' : entry['world'] === 'MAIN' ? 'MAIN' : null;
    if (matches === null || matches.length === 0 || js === null || css === null || runAt === undefined || world === null) return null;
    scripts.push({ matches, js, css, runAt, world, allFrames: entry['all_frames'] === true });
  }
  return scripts;
}

/** The extensions page, opened on the Geld that is in the way. */
export function manageUrl(id: string): string {
  return `chrome://extensions/?id=${id}`;
}
