# Approved iOS shared-parser integration — 14 October 2026

Status: implemented and independently reviewed in the candidate, with narrow source changes mirrored to canonical main. Local source, native-component and remaining portable suites pass. The full whole-app gate and physical iPhone validation remain open; this is not a launch approval or worldwide bank-wide coverage claim.

## Result

After an AppIntent queues an accepted message, an isolated JavaScriptCore context runs the actual shared parser. Wafra can show a source-currency movement preview or a clearly labeled Review caption for an unfamiliar clear financial event. Original 0/2/3-decimal money is preserved, including foreign currency and missing conversion rates. The four ENBD transfer shapes retain their principal amounts and sent/received directions, with no synthetic transfer rail presented as a counterparty.

Credentials, personal conversation, examples, mixed movements, non-completed activity, debt statements/repayments and unusable output remain silent. This classifier controls Wafra's notification after delivery; Apple still controls “Running your automation.” The guided space trigger only matches messages containing spaces.

The ledger remains owned by the foreground/resume import pipeline. Native parsing does not access the financial database, keychain ledger key, network or private formats; receipt bytes, IDs, acknowledgement ownership and `WHEN_UNLOCKED_THIS_DEVICE_ONLY` remain unchanged. Missing context/resources, mismatched hashes, cancellation, busy admission or late results suppress only the preview. The two-second result deadline cannot interrupt synchronous JavaScript execution.

Country, parser pack and ledger denomination are independent, nullable validated settings in the protected native manifest. Current capture consent, entitlement, alert preference and the exact context are rechecked before notification. Erasure invalidates the foreground settings cache, including delayed writes, without re-enabling capture.

## Verification

| Surface | Current result |
| --- | --- |
| App/server typechecks | Pass with 1536 MiB Node cap |
| Normal production-module test build | Pass |
| Adapter / generator / JS settings | 63 / 23 / 9 tests pass |
| Native context / actual JavaScriptCore | 22 / 94 pass in both trees |
| Native queue / bridge | 331 / 118 pass |
| Reader / malformed admission / resources | 172 / 14 / 172 pass |
| Disposable iOS 27 receipt persistence | 23 pass; not physical SMS delivery |
| Host queue signals | 16 pass |
| Application suites covered across runs | 91 pass, including earlier isolated invariants |
| Interaction / recorded-video / onboarding actions | 3794 / 10 / 33 pass |
| Server suites | Three pass; 355 assertions |
| Scoped lint | Zero errors; five existing warnings |
| Independent final review | No remaining blocking findings; 94 native cases independently rerun |

Final review fixed mixed-principal captions, conversational prefaces, structural transfer names, default JavaScriptCore console access, native merchant identifier leakage and fractional/overflowing Swift observation dates. Validated integer milliseconds are used only for the preview; original receipt dates/identities remain intact. The real bridge accepts nullable context and rejects non-string arguments without touching consent or queue methods.

The normal full `scripts/test/run.sh` passed 394 history component checks, then failed at `xcodebuild` because `ios/Wafra.xcworkspace` is missing after Pods were released for disk pressure. The remaining normal application/interaction tests were run separately without changing assertions or weakening that gate. This is explicitly not a successful complete `npm test` run. Component receipts had a sysroot warning; the simulator completed its actual checks and was removed afterward.

Current macOS CI generates/checks resources, runs context/runtime component suites before prebuild, and watches their source files. Linux's normal repair runner includes the adapter, generator and JS context tests. Native fingerprints include exact resources; OTA validation rejects stale parser hashes. The local-build signed-IPA route verifies packaged resource bytes/version/hash. The remote EAS auto-submit route does not inspect a downloaded IPA.

## Source and release boundaries

The shipping candidate is based on origin/main `d23c32e4`. Canonical main remains `dcd28ec8`, 93 commits behind; no Git integration, commit, push, build submission or installation was authorized. Narrow changes preserve unrelated billing/legal work and upstream-only Apple Pay fields. The trees retain different localization sources, so each has its own freshly generated matching resource/hash; both pass the same native runtime checks.

The safe [source snapshots](../../artifacts/parser-launch-20261012/ios-native-parser-integration.safe.json) record each tree's explicit file hashes, generated resource hashes and proof boundaries. Older candidate/experiment receipts are historical.

Still required before launch: a complete native app build/artifact check against the final consolidated source, signed Wafra artifact verification, physical closed/locked/offline/retry capture and notification checks, and reproduction of the affected older-iOS automation banner. Worldwide unfamiliar-bank coverage remains guarded Review/best effort; all-bank accuracy and Android-equivalent background ledger posting are not established. No publication occurred.
