import { useSyncExternalStore } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

/**
 * The platform's stronger-colour preference, read once for the whole app.
 *
 * This used to be a `useState` + `useEffect` per component. `useTheme` calls
 * it, and `ThemedText` calls `useTheme`, so a 50-row list mounted several
 * hundred native `AccessibilityInfo` queries and several hundred event
 * listeners, all resolving on the JS thread exactly when the user started to
 * scroll. The preference is global, so one query and one listener is the
 * right number; every component subscribes to that single value here, the
 * same way `theme-preference.ts` does for the palette.
 */
let enabled = false;
let started = false;
const listeners = new Set<() => void>();

function set(next: boolean): void {
  if (next === enabled) return;
  enabled = next;
  for (const listener of listeners) listener();
}

function start(): void {
  if (started) return;
  started = true;
  if (Platform.OS === 'web') {
    const query = globalThis.matchMedia?.('(prefers-contrast: more)');
    if (!query) return;
    set(query.matches);
    // Never removed: the preference outlives every component, and the
    // listener is one per app rather than one per text node.
    query.addEventListener?.('change', (event: MediaQueryListEvent) => set(event.matches));
    return;
  }
  const ios = Platform.OS === 'ios';
  const read = ios
    ? AccessibilityInfo.isDarkerSystemColorsEnabled
    : AccessibilityInfo.isHighTextContrastEnabled;
  const event = ios ? 'darkerSystemColorsChanged' : 'highTextContrastChanged';
  void read().then(set).catch(() => {});
  AccessibilityInfo.addEventListener(event, set);
}

function subscribe(listener: () => void): () => void {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = (): boolean => enabled;
/** Static web render has no OS preference to consult. */
const getServerSnapshot = (): boolean => false;

/** Follow the platform's stronger-colour preference without adding app state. */
export function useIncreasedContrast(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
