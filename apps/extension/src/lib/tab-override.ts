import type { GeldSettings } from '@geld/core';

// Temporary, for demos: the page's sessionStorage belongs to this tab alone and outlives a reload in it.
const KEY = 'geld:tab-disabled';

export function isTabDisabled(): boolean {
  try {
    return window.sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function setTabDisabled(disabled: boolean): void {
  try {
    if (disabled) window.sessionStorage.setItem(KEY, '1');
    else window.sessionStorage.removeItem(KEY);
  } catch {
    // Storage blocked: the switch then lasts only until the next reload.
  }
}

export function withTabOverride(settings: GeldSettings, disabled: boolean): GeldSettings {
  return disabled ? { ...settings, enabled: false } : settings;
}
