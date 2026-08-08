import { useSyncExternalStore } from 'react';

import { useThemePreference } from '@/lib/theme-preference';

/**
 * The OS palette on web, subscribed to directly.
 *
 * This used to be `useColorScheme()` from react-native-web plus a `hasHydrated`
 * flag. It read the right value on load and then never changed: switching the
 * system theme with the app open left every colour React computes on the old
 * palette until a full reload. Measured, rather than assumed — computed styles
 * at four checkpoints, dark → light with a 3s settle:
 *
 *     loaded dark        card rgb(28,26,22)    tab label rgb(155,148,138)
 *     media -> light     card rgb(28,26,22)    tab label rgb(155,148,138)
 *     tab round-trip     card rgb(28,26,22)    tab label rgb(155,148,138)
 *     after reload       card rgb(251,249,244) tab label rgb(107,101,89)
 *
 * Leaving the tab and returning did not help, which ruled out a stale screen.
 * The giveaway was that SOME text did change colour while its class list stayed
 * byte-identical across all four samples: nothing re-rendered at all, and that
 * ink was being repainted by a CSS rule answering the media query directly.
 * Every colour that goes through React — a View's `backgroundColor`, the tab
 * bar, a border — stayed dark.
 *
 * So the media query is the store and `useSyncExternalStore` is the
 * subscription, which is what the theme PREFERENCE half of this hook has always
 * done (see theme-preference.ts). It also retires `hasHydrated`: the server
 * snapshot argument is the supported way to say "light during static render",
 * and it says it without a state update on every mount.
 */
const QUERY = '(prefers-color-scheme: dark)';

/** True only where a real browser is doing the rendering. */
const canMatch = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function';

function subscribe(onChange: () => void): () => void {
  if (!canMatch()) return () => {};
  const list = window.matchMedia(QUERY);
  // `addEventListener` and not `addListener`: the latter is the deprecated
  // MediaQueryList API, and Safari only gained the standard one in 14. Both
  // are guarded because a MediaQueryList missing addEventListener would
  // otherwise throw during render rather than simply not updating.
  if (typeof list.addEventListener === 'function') {
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }
  if (typeof list.addListener === 'function') {
    list.addListener(onChange);
    return () => list.removeListener(onChange);
  }
  return () => {};
}

function getSnapshot(): 'light' | 'dark' {
  return canMatch() && window.matchMedia(QUERY).matches ? 'dark' : 'light';
}

/**
 * The static-render answer. It must not consult `window`: the server has no
 * media query, and returning something the first client paint disagrees with
 * is a hydration mismatch.
 */
const getServerSnapshot = (): 'light' | 'dark' => 'light';

export function useColorScheme() {
  const preference = useThemePreference();
  const system = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  // A pinned choice beats the OS, exactly as on native.
  return preference === 'system' ? system : preference;
}
