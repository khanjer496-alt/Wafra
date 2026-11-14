/**
 * Build flags for AI reading of unrecognised bank alerts (Expo inlines
 * EXPO_PUBLIC_* at build time). Nothing downloads on install, launch or
 * capture. Only an already-ready platform model is used; Android preparation
 * remains an explicit action in Ask Wafra.
 *
 *  - PREFILL (default OFF while extraction usefulness is unqualified): an alert that
 *    rules left unfamiliar may open/enrich Review with a proposed family
 *    and exact merchant/date quotes. Deterministic source readers own money,
 *    currency, direction and completion. Never a ledger row.
 *    EXPO_PUBLIC_WAFRA_AI_ALERT_PREFILL=1 explicitly enables experimental Review.
 */
export const AI_ALERT_PREFILL_ENABLED: boolean = process.env.EXPO_PUBLIC_WAFRA_AI_ALERT_PREFILL === '1';
