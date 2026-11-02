'use client';
import { useSyncExternalStore } from 'react';
const key = 'geld.preferences.v1';
const eventName = 'geld-preferences';
function snapshot(): string {
  try {
    return localStorage.getItem(key) ?? '[]';
  } catch {
    return '[]';
  }
}
function subscribe(onChange: () => void): () => void {
  window.addEventListener('storage', onChange);
  window.addEventListener(eventName, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(eventName, onChange);
  };
}
export function useStarredPulls(): readonly [readonly string[], (value: readonly string[]) => void] {
  const raw = useSyncExternalStore(subscribe, snapshot, () => '[]');
  let stars: readonly string[] = [];
  try {
    const data: unknown = JSON.parse(raw);
    if (Array.isArray(data)) stars = data.filter((item): item is string => typeof item === 'string').slice(0, 300);
  } catch {
    stars = [];
  }
  return [
    stars,
    (value) => {
      try {
        localStorage.setItem(key, JSON.stringify(value.slice(0, 300)));
        window.dispatchEvent(new Event(eventName));
      } catch {
        return;
      }
    },
  ];
}
