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

export function captureTrace(phase: CaptureTracePhase, count = 0, milliseconds = 0, page = 0): void {
  if (!captureTraceEnabled() || !PHASES.has(phase)) return;
  // Runtime validation is intentional: logging must fail closed even if a
  // caller crosses the TypeScript boundary with an arbitrary object/string.
  if (![count, milliseconds, page].every(n => typeof n === 'number' &&
    Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER)) return;
  try {
    console.info('WafraCapture', JSON.stringify({ phase, count: Math.floor(count),
      ms: Math.round(milliseconds), page: Math.floor(page) }));
  } catch { /* A diagnostic sink may never block financial capture. */ }
}
