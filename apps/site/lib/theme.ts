/**
 * Colour-scheme preference. `system` means "follow the OS", which is also the
 * default and the behaviour without JavaScript; `light`/`dark` force a scheme
 * via `data-theme` on `<html>` (see globals.css) and persist in localStorage.
 */
export type ThemePreference = 'system' | 'light' | 'dark';

export const THEME_STORAGE_KEY = 'geld-theme';
export const THEME_CHANGE_EVENT = 'geld-theme-change';

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

/**
 * Runs before paint (see layout.tsx) so a stored preference applies without a
 * flash. Kept as a string because it is inlined into the document.
 */
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export function readThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}

export function setThemePreference(preference: ThemePreference): void {
  try {
    if (preference === 'system') localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Storage may be unavailable (private mode, blocked); the attribute still applies for this page.
  }
  if (preference === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = preference;
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}
