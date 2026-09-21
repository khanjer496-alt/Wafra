/**
 * ⚠️ RECONSTRUCTED PLUMBING HARNESS — STUB ⚠️
 *
 * `diagnostic-export.ts` calls `getStabilityDiagnostics(now)` but no module in
 * this repository defines or exports it, and no import brings it into scope —
 * it is a bare `TS2304: Cannot find name`. Like the other three, it was never
 * committed.
 *
 * This stub reports that the module was not recovered rather than inventing
 * stability figures. The call site already tolerates failure
 * (`.catch(() => null)`).
 */

export interface StabilityDiagnostics {
  available: false;
  reason: 'stability-module-not-recovered';
}

export async function getStabilityDiagnostics(
  _now: number,
): Promise<StabilityDiagnostics> {
  return { available: false, reason: 'stability-module-not-recovered' };
}
