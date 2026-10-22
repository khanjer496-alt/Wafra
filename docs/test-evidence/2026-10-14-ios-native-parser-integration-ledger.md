# Integration execution ledger

Owner approved the design and autonomous implementation. Commits, pushes, installation and publication remain unauthorized.

## Rulings

- Use the existing candidate at origin/main `d23c32e4`; canonical main `dcd28ec8` is 93 commits behind. Preserve both trees and unrelated changes.
- Mirror narrow reviewed deltas. Upstream-only Apple Pay observations, unrelated billing work and differing localization text were preserved.
- Dormant FX declarations can remain in the pure closure, with `fxLookup: () => null`; executable host access is rejected during generation and unavailable in JavaScriptCore.
- Country, parser pack and ledger denomination are independent preferences. Missing preferences are nullable rather than inferred.
- The two-second deadline suppresses late results; it cannot interrupt synchronous JavaScript execution.
- No second ledger writer, financial database access, network callback, weaker key protection or automatic posting of unverified templates was introduced.

## Completed implementation and review

- Shared adapter: 63 actual-source regressions, independent transfer/name controls. Mixed movements, conversational examples, credentials, statements and debt repayments stay silent; source money is exact; unfamiliar clear movements can produce a Review caption.
- Direct-source generator: deterministic bounded 40-module resource; indirect top-level host execution refused; native fingerprint and OTA freshness checks; local-build signed-resource verification route.
- Native settings: 9 JS synchronizer cases and 22 actual Swift manifest/gate cases. Independent tests preserve exact receipt bytes for malformed advisory snapshots and settings changes. Erase invalidates the JS cache, including delayed writes, without enabling capture.
- Runtime/presentation: 94 actual Swift/JavaScriptCore cases and iOS 16 SDK typecheck pass in both candidate and canonical. Independent final review also passes 94. Fresh isolated contexts remove Apple's default console binding. Native output refuses full/masked identifiers. EN/AR transfer and Review captions pass.
- Final integration review found fractional Swift observation dates could silently suppress previews and overflowing dates could crash JSON serialization. Validated integer milliseconds now cross the preview boundary; record bytes, IDs and original observation dates remain unchanged.
- macOS CI executes context/runtime component suites before native project/Pods generation and watches their test paths. Linux includes adapter/generator/context tests through the normal repair runner.
- Fresh app/server typechecks pass with a 1536 MiB Node cap. Scoped lint has zero errors and five existing warnings.

## Final validation / release limits

The normal full `run.sh` reached 394 passing actual history-store checks, then failed because `ios/Wafra.xcworkspace` is absent after Pods were released for disk pressure. The 91 normal application suites are covered across the original invariant run and the completed portable diagnostic; 3794 interaction regressions, 10 video checks, 33 onboarding-action checks and three server suites also pass. Native queue331/bridge118/reader172/admission14/resources172, context22, actual simulator receipts23 and host signals16 pass. This does not turn the failed full gate into a pass. See the final integration evidence and safe source snapshot for the exact boundaries.

Normal clean generated-source prebuild passed. Repeating prebuild over the old ignored project hit an Apple-targets duplicate-widget error; that project was preserved at `/tmp/wafra-ios-preintegration-recovery-8zj_4484/ios` before fresh generation. No source or lockfile change was needed. A failed-integrity task-local Kotlin cache was preserved and replaced from its checksum-pinned official archive.

No signed whole-app artifact, physical iPhone, closed/locked/offline Shortcut run or Apple automation-banner suppression is verified. Final resource inspection is wired to the local-build IPA workflow; the remote EAS auto-submit route generates/checks source but does not inspect a downloaded IPA. Worldwide bank-wide accuracy and full background ledger parity remain unproven.
