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
  operations: Partial<Record<RuntimeOperationTag, RuntimeOperationSnapshot>>;
}

export type RuntimeOperationTag =
  | 'ask-total'
  | 'ask-plan'
  | 'ask-transfer-scope'
  | 'ask-execute'
  | 'ask-evidence'
  | 'bills-projection'
  | 'bills-open-dues'
  | 'bills-paid-cards'
  | 'bills-transfer-scope'
  | 'bills-manual'
  | 'bills-agenda-items'
  | 'bills-agenda-window'
  | 'notification-drain'
  | 'auto-import'
  | 'daily-summary'
  | 'reminder-projection'
  | 'home-insight';

export interface RuntimeOperationSnapshot {
  count: number;
  maxMs: number;
  totalMs: number;
  recentMs: number[];
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
const operationStats = new Map<RuntimeOperationTag, RuntimeOperationSnapshot>();
const OPERATION_RECENT_MAX = 6;

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

/**
 * Fixed-label, source-free timing breadcrumbs for tester diagnostics.
 *
 * Callers cannot supply arbitrary labels, screen text, IDs or financial data:
 * only the small enum above is accepted by TypeScript and persisted in memory.
 * This lets a support file distinguish a slow transfer-scope rebuild from a
 * slow evidence projection without exposing what the user asked or any ledger
 * contents.
 */
export function recordRuntimeOperation(tag: RuntimeOperationTag, elapsedMs: number): void {
  if (Platform.OS !== 'android' || !Number.isFinite(elapsedMs) || elapsedMs < 0) return;
  const ms = Math.round(elapsedMs);
  const previous = operationStats.get(tag) ?? { count: 0, maxMs: 0, totalMs: 0, recentMs: [] };
  operationStats.set(tag, {
    count: previous.count + 1,
    maxMs: Math.max(previous.maxMs, ms),
    totalMs: previous.totalMs + ms,
    recentMs: [...previous.recentMs, ms].slice(-OPERATION_RECENT_MAX),
  });
}

export function measureRuntimeOperation<T>(tag: RuntimeOperationTag, work: () => T): T {
  const startedAt = now();
  try {
    return work();
  } finally {
    recordRuntimeOperation(tag, now() - startedAt);
  }
}

export async function measureRuntimeOperationAsync<T>(
  tag: RuntimeOperationTag,
  work: () => Promise<T>,
): Promise<T> {
  const startedAt = now();
  try {
    return await work();
  } finally {
    recordRuntimeOperation(tag, now() - startedAt);
  }
}

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
  const operations: RuntimePerformanceSnapshot['operations'] = {};
  for (const [tag, stats] of operationStats) {
    operations[tag] = { ...stats, recentMs: [...stats.recentMs] };
  }
  return {
    sampleIntervalMs: SAMPLE_INTERVAL_MS,
    activeSamples,
    lagOver100Ms,
    lagOver250Ms,
    lagOver500Ms,
    maxLagMs,
    recentStallsMs: [...recentStallsMs],
    operations,
  };
}
