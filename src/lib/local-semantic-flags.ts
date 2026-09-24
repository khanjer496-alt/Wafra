/**
 * The downloaded E5 encoder (docs/local-semantic-runtime.md) is OFF by default.
 *
 * Its evaluation showed almost no useful output for a ~37 MB download on
 * every install and ~400 MB of memory, so Ask Wafra and category suggestions
 * now use the platform's own on-device model (src/lib/on-device-ai.ts) and
 * nothing downloads E5 on install, launch or question.
 *
 * The code stays so research builds can re-enable it explicitly with
 * EXPO_PUBLIC_WAFRA_LOCAL_E5=1 at build time (Expo inlines EXPO_PUBLIC_*).
 */
export const LOCAL_SEMANTIC_E5_ENABLED: boolean = process.env.EXPO_PUBLIC_WAFRA_LOCAL_E5 === '1';
