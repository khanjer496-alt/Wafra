/**
 * Build flags for AI reading of unrecognised bank alerts (Expo inlines
 * EXPO_PUBLIC_* at build time). Nothing downloads on install, launch or
 * capture: the model arrives only when the person asks for it in Settings.
 *
 *  - PREFILL (default ON when the model is on the device): an alert that
 *    every proven parser refused may open a Review item with suggested
 *    amount / currency / merchant / direction / date. Never a ledger row.
 *    EXPO_PUBLIC_WAFRA_AI_ALERT_PREFILL=0 disables it.
 *  - AUTO-POST (default OFF): EXPO_PUBLIC_WAFRA_AI_ALERT_AUTOPOST=1 lets the
 *    gate return 'post'; per-language gates (ai-alert-gates.ts) are still all
 *    OFF, and capture does not wire the post outcome yet — see
 *    docs/universal-parser-rollout.md.
 *  - VERIFIER (default OFF): EXPO_PUBLIC_WAFRA_AI_ALERT_VERIFIER=1 would run
 *    the model as a second opinion on rows the rules DID parse
 *    (ai-alert-verifier.ts). Measurement only in this build.
 */
export const AI_ALERT_PREFILL_ENABLED: boolean = process.env.EXPO_PUBLIC_WAFRA_AI_ALERT_PREFILL !== '0';
export const AI_ALERT_AUTOPOST_ENABLED: boolean = process.env.EXPO_PUBLIC_WAFRA_AI_ALERT_AUTOPOST === '1';
export const AI_ALERT_VERIFIER_ENABLED: boolean = process.env.EXPO_PUBLIC_WAFRA_AI_ALERT_VERIFIER === '1';
