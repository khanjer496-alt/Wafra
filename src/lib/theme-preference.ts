import { useSyncExternalStore } from 'react';

/** `system` follows the OS; the other two pin it. */
export type ThemePreference = 'system' | 'light' | 'dark';

/**
 * Which palette the app paints in.
 *
 * Module-level rather than a React context because the root layout reads the
 * scheme *outside* `StoreProvider` — it needs a palette before the store has
 * hydrated, to build the navigation theme. Same shape as `setMonthStartDay` in
 * `format.ts`: the store pushes the persisted value in on hydrate, and
 * everything that renders a colour subscribes here.
 */
let preference: ThemePreference = 'system';
const listeners = new Set<() => void>();

export function getThemePreference(): ThemePreference {
  return preference;
}

export function setThemePreference(next: string | undefined): void {
  const value: ThemePreference =
    next === 'light' || next === 'dark' || next === 'system' ? next : 'system';
  if (value === preference) return;
  preference = value;
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribe, getThemePreference, getThemePreference);
}
