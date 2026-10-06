/**
 * Whether the app is in the foreground, read once for the whole app.
 *
 * Motion uses it to tell "a figure changed on screen" from "a figure changed
 * while nobody could see it". A bank capture the headless task commits while
 * Wafra is paused would otherwise start coin and arrival animations that
 * Android freezes with the activity and then finishes in clumps on resume;
 * a change committed while inactive jumps to its final value instead.
 *
 * `unknown` (before the platform has answered) and a missing state count as
 * active, so nothing that used to animate at launch is held still by a
 * platform that reports late.
 */
import { useSyncExternalStore } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

export function isAppActiveState(state: AppStateStatus | null | undefined): boolean {
  return state !== 'background' && state !== 'inactive';
}

let active = true;
let started = false;
const listeners = new Set<() => void>();

function start(): void {
  if (started) return;
  started = true;
  active = isAppActiveState(AppState.currentState);
  // Never removed: the answer outlives every component.
  AppState.addEventListener('change', (next) => {
    const value = isAppActiveState(next);
    if (value === active) return;
    active = value;
    for (const listener of listeners) listener();
  });
}

/** The current answer, outside React. */
export function appIsActive(): boolean {
  start();
  return active;
}

export function subscribeAppActive(listener: () => void): () => void {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAppActive(): boolean {
  return useSyncExternalStore(subscribeAppActive, appIsActive, appIsActive);
}
