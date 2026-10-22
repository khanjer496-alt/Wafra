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
 *  - AUTO-POST (default OFF): EXPO_PUBLIC_WAFRA_AI_ALERT_AUTOPOST=1 lets the
 *    legacy gate return 'post'; per-language gates are still all OFF. The
 *    platform-model reader never calls that gate or wires a post outcome; see
 *    docs/universal-parser-rollout.md.
 *  - VERIFIER (default OFF): EXPO_PUBLIC_WAFRA_AI_ALERT_VERIFIER=1 would run
 *    the model as a second opinion on rows the rules DID parse
 *    (ai-alert-verifier.ts). Measurement only in this build.
 */
export const AI_ALERT_PREFILL_ENABLED: boolean = process.env.EXPO_PUBLIC_WAFRA_AI_ALERT_PREFILL === '1';
export const AI_ALERT_AUTOPOST_ENABLED: boolean = process.env.EXPO_PUBLIC_WAFRA_AI_ALERT_AUTOPOST === '1';
export const AI_ALERT_VERIFIER_ENABLED: boolean = process.env.EXPO_PUBLIC_WAFRA_AI_ALERT_VERIFIER === '1';
