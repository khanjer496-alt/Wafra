import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Platform } from 'react-native';

/**
 * Tiny source-free JS responsiveness monitor used only for support diagnostics.
 * It records timing buckets, never screen names, transaction data or arbitrary
 * labels. Background time is explicitly excluded so returning after an hour
 * does not look like a one-hour JS-thread stall.
 */

const SAMPLE_INTERVAL_MS = 1_000;
const RECENT_STALLS_MAX = 8;
const RUNTIME_BREADCRUMB_KEY = 'wafra.runtime-breadcrumb.v1';
const BREADCRUMB_VERSION = 1;
const RAPID_TAB_WINDOW_MS = 2_000;
const BREADCRUMB_WRITE_INTERVAL_MS = 250;

interface PersistedRuntimeBreadcrumb {
  version: 1;
  processStartedAt: number;
  updatedAt: number;
  recentMainTabPresses2s: number;
  lastStallMs: number;
  maxStallMs: number;
  stallsOver100Ms: number;
}

export interface PreviousProcessPerformanceBreadcrumb {
  /** Age at diagnostic collection time; never an absolute device timestamp. */
  updatedAgeMs: number;
  recentMainTabPresses2s: number;
  lastStallMs: number;
  maxStallMs: number;
  stallsOver100Ms: number;
}

export interface RuntimePerformanceSnapshot {
  sampleIntervalMs: number;
  activeSamples: number;
  lagOver100Ms: number;
  lagOver250Ms: number;
  lagOver500Ms: number;
  maxLagMs: number;
  recentStallsMs: number[];
  recentMainTabPresses2s: number;
  previousProcess: PreviousProcessPerformanceBreadcrumb | null;
  operations: Partial<Record<RuntimeOperationTag, RuntimeOperationSnapshot>>;
}

export type RuntimeInteractionTag = 'main-tab-press';

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
  | 'capture-collect'
  | 'capture-plan'
  | 'capture-save'
  | 'auto-import'
  | 'daily-summary'
  | 'reminder-projection'
  | 'history-scan-page'
  | 'history-plan-page'
  | 'history-apply-page'
  | 'history-persist-page'
  | 'history-save-page'
  | 'home-insight'
  | 'wallet-balances'
  | 'wallet-dues'
  | 'wallet-reissues'
  | 'wallet-activity';

// Runtime validation also protects callers crossing untyped/native boundaries.
// Record makes additions to the public tag union require an explicit allowlist.
const OPERATION_TAGS: Record<RuntimeOperationTag, true> = {
  'ask-total': true,
  'ask-plan': true,
  'ask-transfer-scope': true,
  'ask-execute': true,
  'ask-evidence': true,
  'bills-projection': true,
  'bills-open-dues': true,
  'bills-paid-cards': true,
  'bills-transfer-scope': true,
  'bills-manual': true,
  'bills-agenda-items': true,
  'bills-agenda-window': true,
  'notification-drain': true,
  'capture-collect': true,
  'capture-plan': true,
  'capture-save': true,
  'auto-import': true,
  'daily-summary': true,
  'reminder-projection': true,
  'history-scan-page': true,
  'history-plan-page': true,
  'history-apply-page': true,
  'history-persist-page': true,
  'history-save-page': true,
  'home-insight': true,
  'wallet-balances': true,
  'wallet-dues': true,
  'wallet-reissues': true,
  'wallet-activity': true,
};
const SLOW_OPERATION_MS = 100;
const OPERATION_TRACE_INTERVAL_MS = 1_000;
const lastOperationTraceAt = new Map<RuntimeOperationTag, number>();

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
const processStartedAt = Date.now();
let mainTabPresses: number[] = [];
let previousProcessBreadcrumb: PersistedRuntimeBreadcrumb | null = null;
let breadcrumbInitPromise: Promise<void> | null = null;
let breadcrumbWriteTail: Promise<void> = Promise.resolve();
let breadcrumbWriteTimer: ReturnType<typeof setTimeout> | null = null;
let lastBreadcrumbWriteAt = 0;

const now = (): number => Date.now();

const nonnegativeFinite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

function parsePersistedBreadcrumb(raw: string | null): PersistedRuntimeBreadcrumb | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const row = value as Partial<PersistedRuntimeBreadcrumb>;
    if (
      row.version !== BREADCRUMB_VERSION ||
      !nonnegativeFinite(row.processStartedAt) ||
      !nonnegativeFinite(row.updatedAt) ||
      !nonnegativeFinite(row.recentMainTabPresses2s) ||
      !nonnegativeFinite(row.lastStallMs) ||
      !nonnegativeFinite(row.maxStallMs) ||
      !nonnegativeFinite(row.stallsOver100Ms)
    ) return null;
    return {
      version: BREADCRUMB_VERSION,
      processStartedAt: row.processStartedAt,
      updatedAt: row.updatedAt,
      recentMainTabPresses2s: Math.floor(row.recentMainTabPresses2s),
      lastStallMs: Math.round(row.lastStallMs),
      maxStallMs: Math.round(row.maxStallMs),
      stallsOver100Ms: Math.floor(row.stallsOver100Ms),
    };
  } catch {
    return null;
  }
}

function initializeBreadcrumbPersistence(): Promise<void> {
  if (Platform.OS !== 'android') return Promise.resolve();
  if (breadcrumbInitPromise) return breadcrumbInitPromise;
  breadcrumbInitPromise = AsyncStorage.getItem(RUNTIME_BREADCRUMB_KEY)
    .then((raw) => {
      const persisted = parsePersistedBreadcrumb(raw);
      if (persisted && persisted.processStartedAt !== processStartedAt) {
        previousProcessBreadcrumb = persisted;
      }
    })
    .catch(() => undefined);
  return breadcrumbInitPromise;
}

function pruneTabPresses(at: number): void {
  const floor = at - RAPID_TAB_WINDOW_MS;
  if (mainTabPresses.length > 0) mainTabPresses = mainTabPresses.filter((stamp) => stamp >= floor);
}

function currentBreadcrumb(at: number): PersistedRuntimeBreadcrumb {
  pruneTabPresses(at);
  return {
    version: BREADCRUMB_VERSION,
    processStartedAt,
    updatedAt: at,
    recentMainTabPresses2s: mainTabPresses.length,
    lastStallMs: recentStallsMs.at(-1) ?? 0,
    maxStallMs: maxLagMs,
    stallsOver100Ms: lagOver100Ms,
  };
}

function writeBreadcrumb(): void {
  if (Platform.OS !== 'android') return;
  const at = now();
  const payload = JSON.stringify(currentBreadcrumb(at));
  lastBreadcrumbWriteAt = at;
  const write = breadcrumbWriteTail
    .then(() => initializeBreadcrumbPersistence())
    .then(() => AsyncStorage.setItem(RUNTIME_BREADCRUMB_KEY, payload));
  breadcrumbWriteTail = write.catch(() => undefined);
}

function persistBreadcrumbSoon(urgent = false): void {
  if (Platform.OS !== 'android') return;
  const elapsed = now() - lastBreadcrumbWriteAt;
  const wait = urgent ? 0 : Math.max(0, BREADCRUMB_WRITE_INTERVAL_MS - elapsed);
  if (wait === 0) {
    if (breadcrumbWriteTimer) {
      clearTimeout(breadcrumbWriteTimer);
      breadcrumbWriteTimer = null;
    }
    writeBreadcrumb();
    return;
  }
  if (!breadcrumbWriteTimer) {
    breadcrumbWriteTimer = setTimeout(() => {
      breadcrumbWriteTimer = null;
      writeBreadcrumb();
    }, wait);
  }
}

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
  if (lag >= 100) {
    recentStallsMs = [...recentStallsMs, lag].slice(-RECENT_STALLS_MAX);
    // A process death erases every in-memory counter. Persist only timing and
    // interaction counts, never screen names, transaction data, IDs or text.
    persistBreadcrumbSoon(true);
  }
};

/**
 * Source-free interaction pressure. The tag is deliberately a closed enum so
 * no route, merchant, account or arbitrary UI label can enter diagnostics.
 */
export function recordRuntimeInteraction(tag: RuntimeInteractionTag): void {
  if (Platform.OS !== 'android') return;
  if (tag === 'main-tab-press') {
    const at = now();
    pruneTabPresses(at);
    mainTabPresses.push(at);
    persistBreadcrumbSoon();
  }
}

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
  if (Platform.OS !== 'android' || typeof tag !== 'string' ||
      !Object.hasOwn(OPERATION_TAGS, tag) || !Number.isFinite(elapsedMs) || elapsedMs < 0) return;
  const ms = Math.round(elapsedMs);
  const previous = operationStats.get(tag) ?? { count: 0, maxMs: 0, totalMs: 0, recentMs: [] };
  operationStats.set(tag, {
    count: previous.count + 1,
    maxMs: Math.max(previous.maxMs, ms),
    totalMs: previous.totalMs + ms,
    recentMs: [...previous.recentMs, ms].slice(-OPERATION_RECENT_MAX),
  });

  if (process.env.EXPO_PUBLIC_WAFRA_CAPTURE_TRACE !== '1' || elapsedMs < SLOW_OPERATION_MS) return;
  const at = now();
  if (!nonnegativeFinite(at)) return;
  const last = lastOperationTraceAt.get(tag);
  if (last !== undefined && at - last < OPERATION_TRACE_INTERVAL_MS) return;
  // The allowlist bounds this map. Rate-limit even a failing logging sink so
  // diagnostics cannot turn a hot operation into another source of work.
  lastOperationTraceAt.set(tag, at);
  try {
    console.info('[WafraRuntimeOperation]', tag, ms);
  } catch {
    // Local diagnostics must never change application behavior.
  }
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
    void initializeBreadcrumbPersistence();
    active = AppState.currentState === 'active';
    resetExpectedAt();
    timer = setInterval(sample, SAMPLE_INTERVAL_MS);
    subscription = AppState.addEventListener('change', (next) => {
      active = next === 'active';
      resetExpectedAt();
      if (next !== 'active') persistBreadcrumbSoon(true);
    });
  }
  return () => {
    // Root normally lives for the process lifetime. Cleanup still matters in
    // Fast Refresh/tests where a second root can otherwise leave a timer behind.
    if (timer) clearInterval(timer);
    timer = null;
    subscription?.remove();
    subscription = null;
    if (breadcrumbWriteTimer) clearTimeout(breadcrumbWriteTimer);
    breadcrumbWriteTimer = null;
    started = false;
  };
}

export function getRuntimePerformanceSnapshot(): RuntimePerformanceSnapshot {
  const at = now();
  pruneTabPresses(at);
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
    recentMainTabPresses2s: mainTabPresses.length,
    previousProcess: previousProcessBreadcrumb
      ? {
          updatedAgeMs: Math.max(0, at - previousProcessBreadcrumb.updatedAt),
          recentMainTabPresses2s: previousProcessBreadcrumb.recentMainTabPresses2s,
          lastStallMs: previousProcessBreadcrumb.lastStallMs,
          maxStallMs: previousProcessBreadcrumb.maxStallMs,
          stallsOver100Ms: previousProcessBreadcrumb.stallsOver100Ms,
        }
      : null,
    operations,
  };
}
