# iOS background parser experiment — 14 October 2026

The existing pure parser executes in Apple's JavaScriptCore from Swift, without
React Native, native host bindings, network or ledger access. This is a tested
technical route for moving classification into the background Shortcut action.
Production AppIntent integration has not been implemented by this experiment.

The strict host proof passes 24 controlled synthetic cases: 12 positive and 12
negative. Node and actual Swift JavaScriptCore outputs match in all 24 cases.
Independent semantic assertions pass: Node 155, native outputs 155 and Swift
156, including absent host APIs. The 39-module bundle is 1,483,537 bytes. Its
SHA-256 is 8d15e91aca1cd38dbb786488704d7020a8af0f851e14446d10519a3727066b2f.

On this Mac (arm64, macOS 26.1), bundle loading took 25.9 ms; median case time
was 41.8 ms, maximum 247 ms and total case time 1,034 ms. These are host
measurements, not minimum-iOS, physical-phone, cold-intent or memory-pressure
performance claims. The bundle uses the normally compiled source modules and
refuses stale builds, stub modules and external dependencies. It is a test
artifact, not a second shipping parser implementation.

## Safety defects exposed and fixed

The initial strict probe found three unsafe pure-API results: first-person USD
chat became an expense, first-person AED chat became an expense, and a negated
ENBD transfer became income. The existing local iOS adapter already had the
personal-message guard, but the new pure entry point did not. That bounded guard
now lives at the shared pure parser boundary and is reused by local capture.
Leading principal negation refuses only that claim, preserving completed
purchases with secondary negative fee, balance or security wording. The native
Kotlin/generated Swift preview uses the matching leading-principal control.

Focused source checks pass 164 cases, including 69 new pure-boundary controls.
Independent pure review passes 143 cases; native review preserves 16 ENBD/footer
variants and passes 21 focused cases. App/server typechecks, 23 universal suites,
460 capture checks and 43 existing preview checks pass. Actual Swift checks pass:
queue 331, bridge 114, preview/credential fixture 172, resources 172 and malformed
preview/privacy admission 14. Scoped lint has no errors. No full signed application
or complete application test-run success is claimed.

## Production work remaining

1. Generate a signed-app resource from the normal parser source and load it from
   a bounded, serialized JavaScriptCore context in the background AppIntent.
2. Supply a minimal validated parser context (country, currency and exponent),
   without reading the encrypted ledger or claiming account ownership.
3. Use source-grounded movement facts for Wafra's notification; retain unfamiliar
   or ambiguous financial evidence for the existing foreground Review path.
4. Keep exact receipt bytes, identity, replay handling and the single foreground
   ledger writer. The ledger key remains WHEN_UNLOCKED_THIS_DEVICE_ONLY.
5. Verify the integrated signed build on a physical iPhone: normal/foreign
   currency, transfers, personal SMS, OTP, replay, closed/locked/offline behavior
   and the exact Shortcuts notification setting/banners.

Both paired iPhones were unavailable during this task, and the owner confirmed
no iPhone is available now. The banner remains unverified. A parser executing
after an Apple automation trigger cannot suppress that trigger's system banner.
Current public pinned Shortcut artifacts remain approved and graph-identical;
that check does not prove the installed Shortcut or physical execution.

No production integration, ledger/key protection change, commit, push,
deployment or installation occurred as part of this experiment. Parser safety
fixes are local source changes in the preserved canonical tree and the candidate.

Primary references: [Apple JavaScriptCore](https://developer.apple.com/documentation/javascriptcore),
[App Intent runtime](https://developer.apple.com/documentation/appintents/configuring-the-runtime-behavior-of-your-app-intents),
[Expo 55 BackgroundTask](https://docs.expo.dev/versions/v55.0.0/sdk/background-task/).
Expo background tasks are deferred by the system; they do not establish
immediate per-SMS delivery.
