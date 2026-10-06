/**
 * The native launch splash, held until the first screen with the ledger has
 * laid out (Home, onboarding, storage recovery or the lock).
 *
 * It used to hide as soon as the fonts were in memory, which showed a
 * "Loading ledger" skeleton for the rest of hydration and then popped Home in
 * over it, with Home's coin reveal starting under the splash. Now the root
 * releases it one frame after the hydrated tree commits, with a fallback so
 * a slow or failed read never leaves anyone on the splash. Screens that run
 * an entrance (Home's coins) wait for `useLaunchSplashHidden()`, which turns
 * true one frame after the hide has gone through.
 */
import * as SplashScreen from 'expo-splash-screen';
import { useSyncExternalStore } from 'react';

/** The longest the splash waits for the ledger before it gives way anyway. */
export const LAUNCH_SPLASH_TIMEOUT_MS = 4_000;

let hidden = false;
let releasing = false;
let fallback: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function publish(next: boolean): void {
  if (hidden === next) return;
  hidden = next;
  for (const listener of listeners) listener();
}

function armFallback(timeoutMs: number): void {
  if (fallback !== null) clearTimeout(fallback);
  fallback = setTimeout(() => {
    fallback = null;
    releaseLaunchSplash();
  }, timeoutMs);
}

/**
 * Keep the splash up for a new launch (the root mounting, including Android
 * recreating its activity in a process that already ran once). Safe to call
 * more than once.
 */
export function holdLaunchSplash(timeoutMs = LAUNCH_SPLASH_TIMEOUT_MS): void {
  // A hide already on its way finishes; holding again would strand it.
  if (releasing) return;
  SplashScreen.preventAutoHideAsync().catch(() => {});
  publish(false);
  armFallback(timeoutMs);
}

/** Hide the splash once; screens waiting on it start a frame after the hide. */
export function releaseLaunchSplash(): void {
  if (hidden || releasing) return;
  releasing = true;
  if (fallback !== null) { clearTimeout(fallback); fallback = null; }
  const shown = () => {
    releasing = false;
    // One frame after the hide, so an entrance starts on a visible screen.
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => publish(true));
    else publish(true);
  };
  SplashScreen.hideAsync().then(shown, shown);
}

export function launchSplashHidden(): boolean {
  return hidden;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useLaunchSplashHidden(): boolean {
  return useSyncExternalStore(subscribe, launchSplashHidden, launchSplashHidden);
}

// Armed at load: even a root that never holds or releases cannot keep an
// entrance waiting on a splash nobody hides.
armFallback(LAUNCH_SPLASH_TIMEOUT_MS);
