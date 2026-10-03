/**
 * The downloaded E5 encoder (docs/local-semantic-runtime.md) is removed.
 *
 * Its evaluation showed almost no useful output for a ~37 MB download on
 * every install and ~400 MB of memory, so Ask Wafra and category suggestions
 * use the platform's own on-device model (src/lib/on-device-ai.ts). The ONNX
 * Runtime that ran E5 is no longer in the app, so this flag is permanently
 * off and every gated path below it stays on its deterministic route.
 */
export const LOCAL_SEMANTIC_E5_ENABLED: boolean = false;
