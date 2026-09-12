/**
 * Privacy-safe, process-local JS launch timing.
 *
 * The vocabulary is closed on purpose: callers can record when a fixed app
 * lifecycle boundary happened, but cannot attach amounts, merchants, message
 * text, account details, device identifiers, or arbitrary metadata.
 * The origin is this module's evaluation, not the user's icon tap or native
 * process start. Internal Release builds can expose the fixed snapshot as a
 * local JSON file; production builds do not render that export control.
 */
export const LAUNCH_PHASES = [
  'js-instrumentation-start',
  'fonts-ready',
  'ledger-load-start',
  'ledger-read-complete',
  'ledger-metadata-complete',
  'ledger-overrides-complete',
  'ledger-row-transforms-complete',
  'ledger-reparse-complete',
  'ledger-migration-complete',
  'ledger-accounts-complete',
  'ledger-repairs-complete',
  'ledger-declines-complete',
  'ledger-finalize-complete',
  'ledger-reducer-normalize-start',
  'ledger-load-complete',
  'first-usable-home',
  'first-history-page',
] as const;

export type LaunchPhase = (typeof LAUNCH_PHASES)[number];

export interface LaunchMetric {
  phase: LaunchPhase;
  elapsedMs: number;
}

export interface LaunchTimeline {
  mark(phase: LaunchPhase, atMs?: number): void;
  snapshot(): LaunchMetric[];
}

const monotonicNow = (): number =>
  typeof globalThis.performance?.now === 'function'
    ? globalThis.performance.now()
    : 0;

export function createLaunchTimeline(startedAtMs = monotonicNow()): LaunchTimeline {
  const recorded = new Map<LaunchPhase, number>([['js-instrumentation-start', 0]]);

  return {
    mark(phase, atMs = monotonicNow()) {
      if (!LAUNCH_PHASES.includes(phase) || recorded.has(phase) ||
        !Number.isFinite(atMs) || !Number.isFinite(startedAtMs)) return;
      recorded.set(phase, Math.max(0, Math.round(atMs - startedAtMs)));
    },
    snapshot() {
      return LAUNCH_PHASES.flatMap((phase) => {
        const elapsedMs = recorded.get(phase);
        return elapsedMs === undefined ? [] : [{ phase, elapsedMs }];
      });
    },
  };
}

const launchTimeline = createLaunchTimeline();
const loggedPhases = new Set<LaunchPhase>();

export function markLaunchPhase(phase: LaunchPhase): void {
  launchTimeline.mark(phase);
  if (process.env.EXPO_PUBLIC_WAFRA_CAPTURE_TRACE !== '1' || loggedPhases.has(phase)) return;
  const metric = launchTimeline.snapshot().find((entry) => entry.phase === phase);
  if (!metric) return;
  loggedPhases.add(phase);
  try {
    console.info('WAFRA_LAUNCH_TIMING', JSON.stringify(metric));
  } catch {
    // Diagnostic output must never interrupt the lifecycle being measured.
  }
}

markLaunchPhase('js-instrumentation-start');

export function getLaunchMetrics(): LaunchMetric[] {
  return launchTimeline.snapshot();
}

export function isInternalLaunchDiagnosticsEnabled(): boolean {
  return process.env.EXPO_PUBLIC_WAFRA_INTERNAL_DIAGNOSTICS === '1';
}

export function serializeLaunchMetrics(): string {
  return JSON.stringify({
    schemaVersion: 1,
    metrics: getLaunchMetrics(),
  }, null, 2);
}
