/** Opt-in local timing only. Never accept message text, dates, IDs or amounts. */
const PHASES = new Set([
  'routine:start', 'collect:done', 'reviews:start', 'reviews:done',
  'plan:start', 'plan:done', 'save:start', 'save:done', 'routine:done',
  'inbox:start', 'page:read', 'page:progress', 'page:done', 'inbox:done',
] as const);
export type CaptureTracePhase = typeof PHASES extends Set<infer T> ? T : never;

export function captureTraceEnabled(): boolean {
  return typeof process !== 'undefined' && process.env.EXPO_PUBLIC_WAFRA_CAPTURE_TRACE === '1';
}

export interface CaptureTraceEntry {
  phase: CaptureTracePhase;
  count: number;
  ms: number;
  page: number;
  /** Milliseconds since the first retained entry; never a wall-clock instant. */
  at: number;
}
// The console sink is unreachable on a tester's phone. A bounded in-memory
// copy of the same numbers lets the Settings diagnostic export carry them,
// so a "still slow" report can come with page timings instead of guesses.
const RETAINED_ENTRIES = 512;
const retained: CaptureTraceEntry[] = [];
let retainedOrigin: number | null = null;

export function captureTraceSnapshot(): CaptureTraceEntry[] {
  return retained.map(entry => ({ ...entry }));
}

export function captureTrace(phase: CaptureTracePhase, count = 0, milliseconds = 0, page = 0): void {
  if (!captureTraceEnabled() || !PHASES.has(phase)) return;
  // Runtime validation is intentional: logging must fail closed even if a
  // caller crosses the TypeScript boundary with an arbitrary object/string.
  if (![count, milliseconds, page].every(n => typeof n === 'number' &&
    Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER)) return;
  const entry = { phase, count: Math.floor(count), ms: Math.round(milliseconds), page: Math.floor(page) };
  try {
    const now = Date.now();
    retainedOrigin ??= now;
    retained.push({ ...entry, at: now - retainedOrigin });
    if (retained.length > RETAINED_ENTRIES) retained.splice(0, retained.length - RETAINED_ENTRIES);
    console.info('WafraCapture', JSON.stringify(entry));
  } catch { /* A diagnostic sink may never block financial capture. */ }
}
