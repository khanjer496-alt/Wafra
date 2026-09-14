import { AppState, Platform } from 'react-native';

/**
 * Tiny source-free JS responsiveness monitor used only for support diagnostics.
 * It records timing buckets, never screen names, transaction data or arbitrary
 * labels. Background time is explicitly excluded so returning after an hour
 * does not look like a one-hour JS-thread stall.
 */

const SAMPLE_INTERVAL_MS = 1_000;
const RECENT_STALLS_MAX = 8;

export interface RuntimePerformanceSnapshot {
  sampleIntervalMs: number;
  activeSamples: number;
  lagOver100Ms: number;
  lagOver250Ms: number;
  lagOver500Ms: number;
  maxLagMs: number;
  recentStallsMs: number[];
}

let started = false;
let active = AppState.currentState === 'active';
let expectedAt = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let subscription: { remove(): void } | null = null;
let activeSamples = 0;
let lagOver100Ms = 0;
let lagOver250Ms = 0;
let lagOver500Ms = 0;
let maxLagMs = 0;
let recentStallsMs: number[] = [];

const now = (): number => Date.now();

const resetExpectedAt = () => {
  expectedAt = now() + SAMPLE_INTERVAL_MS;
};

const sample = () => {
  const current = now();
  if (!active) {
    expectedAt = current + SAMPLE_INTERVAL_MS;
    return;
  }
  const lag = Math.max(0, Math.round(current - expectedAt));
  expectedAt = current + SAMPLE_INTERVAL_MS;
  activeSamples += 1;
  maxLagMs = Math.max(maxLagMs, lag);
  if (lag >= 100) lagOver100Ms += 1;
  if (lag >= 250) lagOver250Ms += 1;
  if (lag >= 500) lagOver500Ms += 1;
  if (lag >= 100) recentStallsMs = [...recentStallsMs, lag].slice(-RECENT_STALLS_MAX);
};

/** Idempotent; Android only. Returns a cleanup for tests/unusual root unmounts. */
export function startRuntimePerformanceMonitor(): () => void {
  if (Platform.OS !== 'android') return () => {};
  if (!started) {
    started = true;
    active = AppState.currentState === 'active';
    resetExpectedAt();
    timer = setInterval(sample, SAMPLE_INTERVAL_MS);
    subscription = AppState.addEventListener('change', (next) => {
      active = next === 'active';
      resetExpectedAt();
    });
  }
  return () => {
    // Root normally lives for the process lifetime. Cleanup still matters in
    // Fast Refresh/tests where a second root can otherwise leave a timer behind.
    if (timer) clearInterval(timer);
    timer = null;
    subscription?.remove();
    subscription = null;
    started = false;
  };
}

export function getRuntimePerformanceSnapshot(): RuntimePerformanceSnapshot {
  return {
    sampleIntervalMs: SAMPLE_INTERVAL_MS,
    activeSamples,
    lagOver100Ms,
    lagOver250Ms,
    lagOver500Ms,
    maxLagMs,
    recentStallsMs: [...recentStallsMs],
  };
}
