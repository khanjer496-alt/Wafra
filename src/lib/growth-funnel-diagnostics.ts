/**
 * ⚠️ RECONSTRUCTED PLUMBING HARNESS — STUB ⚠️
 *
 * `getGrowthFunnelDiagnostics` is imported by `diagnostic-export.ts` but was
 * never committed to this repository. It blocks bundling, which blocks the
 * on-device runtime verification.
 *
 * This stub reports that the module was not recovered rather than inventing
 * funnel numbers. The call site already tolerates failure
 * (`.catch(() => null)`), and a diagnostics bundle from a harness build will
 * carry this marker instead of counts, so nobody reads a funnel figure that
 * was never measured.
 */

export interface GrowthFunnelDiagnostics {
  available: false;
  reason: 'growth-funnel-module-not-recovered';
}

export async function getGrowthFunnelDiagnostics(
  _now: number,
): Promise<GrowthFunnelDiagnostics> {
  return { available: false, reason: 'growth-funnel-module-not-recovered' };
}
