# Local semantic runtime (on-device E5)

Wafra ships an optional on-device multilingual sentence encoder
(`alphaedge-ai/multilingual-e5-small-arb-32768`, dynamic INT8 ONNX, 384-d)
used for two narrow jobs:

1. **Parser shadow mode.** For every universally inspected bank alert, the
   deterministic parser's redacted semantic window is embedded and compared
   with the parser's own family. Bank-app notifications are scored inline;
   SMS history windows are queued (bounded at 10,000) and scored one at a time
   off the scan path, so an import never waits on the encoder. An existing
   inbox never reaches the encoder on its own (live capture sees only new
   messages and the startup parser-repair pass is excluded), so Settings →
   "Send test diagnostics" also starts a bounded background pass over the
   readable inbox (`local-semantic-inbox-shadow.ts`, up to 40,000 messages,
   stops when the queue drops). Only aggregate counters are kept
   (`localSemanticShadowSnapshot`, `localSemanticInboxShadowStatus`). The
   model never changes an amount, currency, status, direction, dedupe key, or
   import decision.
2. **Ask Wafra intent fallback.** When the deterministic planner recognised
   nothing in a fresh question (plain Help, or its "didn't understand"
   clarification marked `unrecognized`) and no conversation context is active,
   the encoder ranks the
   question against app-owned intent prototypes and may pick one closed tool
   (`spending-total`, `subscriptions`, `upcoming-payments`, ...). The compiled
   request must pass the production request validator, and every number in the
   answer is computed by the deterministic ledger executor. Nothing the model
   emits reaches the ledger unvalidated.

## Modules

| File | Role |
| --- | --- |
| `src/lib/local-semantic-model.ts` | Types, prototype registry, thresholds, gating, retriever, closed-set family classifier, Ask plan chooser, redaction. |
| `src/lib/local-semantic-runtime.native.ts` | Downloads and SHA-256/size verifies the pinned model + tokenizer, creates the ONNX session, mean-pools and L2-normalizes. |
| `src/lib/local-semantic-runtime.ts` | Web/Node fail-closed stub (`native-only`). |
| `src/lib/local-semantic-bundle.ts` | The three code-owned JSON artifacts under `assets/local-ai/`. |
| `src/lib/local-semantic-shadow.ts` | Shadow comparison and source-free counters. |
| `src/lib/local-semantic-assistant(.native).ts` | Ask Wafra fallback wiring. |
| `src/lib/universal-template-certification.ts` | Deterministic gold/green certification that decides automatic vs Review for universally parsed events. Not model-driven. |
| `src/lib/universal-confidence.ts` | Deterministic evidence-completeness score used by certification. Not a model probability. |
| `plugins/onnxruntime-gradle9-compat` | Binds the `VersionNumber` class Gradle 9 removed so `onnxruntime-react-native@1.24.3` configures under Expo SDK 55. |

## Artifacts

Runtime artifacts are **not** bundled in the APK. They are fetched once from
the `local-ai-e5-v1` GitHub release and stored under the app document
directory (`local-ai/<model-version>/`):

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `model.int8.onnx` | 34,825,743 | `70fd5ee627d2…c4f9a1` |
| `tokenizer.json` | 2,406,512 | `40b7d6f2e0b8…fc5f60` |
| `tokenizer_config.json` | 1,206 | `606031684b9a…957b2` |

A size or hash mismatch deletes the file and fails closed
(`artifact-verification-failed`). After one full hash match a `<name>.verified`
marker lets later launches trust exact size plus marker instead of re-reading
the encoder. Failures back off 1 min → 5 min → 30 min → 2 h; the status
carries `retryAfter` and source-free `metrics` (download, prepare, session
create, encode count/total/max, failures) that the diagnostics export reports.
`EXPO_PUBLIC_WAFRA_LOCAL_AI_BASE_URL` may point dev builds at a mirror; hashes
never change.

## Authority boundaries

- Deterministic parsing (`alert-draft`, `alert-semantics`, `universal-parser`,
  the AE/SA launch parser) owns money, status, direction, dedupe and identity.
- `certifyUniversalTemplate` is the only path from a universal event to
  automatic posting, and it is regex + confidence based; the model is not an
  input to it.
- `redactLocalSemanticText` replaces deterministic spans with typed
  placeholders and collapses residual 4+ digit runs before any text is
  embedded. `contracts.test.js` pins that this module and certification cannot
  import a ledger writer or network transport.
- Diagnostics export (`localSemantic.runtime` / `.shadow`) contains only the
  runtime state, model version, a truncated error code and aggregate counters.

## Verification status (21 September 2026)

- Recovered from the preserved `Documents/Wafra` checkout after commit
  `7115f29b` landed the runtime without the module it imports. The recovered
  `local-semantic-model.ts` passes its original 14 repair tests unchanged.
- Certification rules for markets the shipped `UniversalMarket` union does not
  include (AU/BR/MX/SG) were removed from the recovered registry; those return
  with their market packs. The US public-evidence fixture suite from the same
  unmerged wave is not wired because it depends on parser semantics that are
  not on `main`.
- Typecheck 0 errors; lint 0 errors; all JavaScript suites and the server
  suites pass on the host. The three macOS-only native iOS store checks need
  the generated `ios/` project and run in CI.
- On-device model download, hash verification, ONNX inference, latency and
  memory have **not yet** been measured on a physical Android device with this
  source. Do not read shadow or Ask-fallback quality claims from the offline
  experiments as device evidence.
