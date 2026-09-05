import { useSyncExternalStore } from 'react';

import type { ThemePreference } from './theme';
import { readThemePreference, THEME_CHANGE_EVENT } from './theme';

function subscribe(onChange: () => void): () => void {
  window.addEventListener(THEME_CHANGE_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

const getServerPreference = (): ThemePreference => 'system';

/** The stored preference; `system` during server rendering and hydration. Client components only. */
export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribe, readThemePreference, getServerPreference);
}
