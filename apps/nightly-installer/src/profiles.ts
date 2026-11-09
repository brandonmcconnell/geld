import type { BrowserId } from './browsers';

/** A browser profile as Chrome lists it in its `Local State` file (`profile.info_cache`). */
export interface Profile {
  readonly browser: BrowserId;
  /** The profile's folder below the user data folder, what `--profile-directory` takes: `Default`, `Profile 1`. */
  readonly directory: string;
  readonly name: string;
  readonly email: string | null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** The profiles in `Local State`, in the order the browser's profile menu shows them, or none when it lists none. */
export function parseLocalState(contents: string, browser: BrowserId): Profile[] {
  let state: unknown;
  try {
    state = JSON.parse(contents);
  } catch {
    return [];
  }
  const profile = isRecord(state) ? state['profile'] : undefined;
  const cache = isRecord(profile) ? profile['info_cache'] : undefined;
  if (!isRecord(cache)) return [];
  const profiles = Object.entries(cache).map(([directory, info]): Profile => {
    const entry = isRecord(info) ? info : {};
    return { browser, directory, name: text(entry['name']) ?? text(entry['gaia_name']) ?? directory, email: text(entry['user_name']) };
  });
  const listed: unknown = isRecord(profile) ? profile['profiles_order'] : undefined;
  const order: readonly unknown[] = Array.isArray(listed) ? listed : [];
  const rank = (directory: string): number => {
    const at = order.indexOf(directory);
    return at === -1 ? order.length + (directory === 'Default' ? -0.5 : 0) : at;
  };
  return profiles.sort((a, b) => rank(a.directory) - rank(b.directory) || a.directory.localeCompare(b.directory, 'en', { numeric: true }));
}

/** Where the profile saves downloads: its own setting (`download.default_directory`), else the system's Downloads folder. */
export function downloadDirectory(preferences: string | null, fallback: string): string {
  if (preferences === null) return fallback;
  try {
    const parsed: unknown = JSON.parse(preferences);
    const download = isRecord(parsed) ? parsed['download'] : undefined;
    return (isRecord(download) ? text(download['default_directory']) : null) ?? fallback;
  } catch {
    return fallback;
  }
}
