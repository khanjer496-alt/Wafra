# On-device iOS bank-alert parser integration

Date: 14 October 2026. Status: design for owner review; production integration not started.

## Outcome and agreed constraints

Run the shared parser inside Wafra's background Shortcut action so Wafra's
notifications follow the same currency and movement facts as the app. Preserve
foreign-currency alerts, unknown formats for Review, original receipt bytes,
replay behavior, and the current encrypted ledger protections. SMS remains
on-device. The owner has no physical iPhone available now.

The tested JavaScriptCore prototype passes 24 controlled cases using the
39-module existing parser closure. That establishes host engine feasibility;
it does not establish physical AppIntent behavior or worldwide bank coverage.
This integration cannot change Apple's automation trigger notification.

## Architecture decision

Use a pure shipping adapter, a deterministic source-based resource generator,
and a native Swift JavaScriptCore reader in the existing WafraLiveCapture module.
Keep the current AppIntent names, parameters, result strings and background
configuration. Both message intents continue to stage protected receipts first;
their existing notification callback then consults the shared parser.

The runtime creates a fresh context per admitted call on a serial runner. Busy,
oversized, unavailable, canceled or overdue preview work produces no Wafra
banner. It never deletes or acknowledges a receipt. It has no filesystem,
keychain, ledger, networking, React Native or AI bindings. Preview failure cannot
fail an otherwise successful staging action.

Alternatives considered: keeping the Kotlin/Swift regex reader retains a second
interpretation that diverges across currencies; starting a second React Native
ledger writer adds ownership and locked-key problems; cloud AI violates the
agreed on-device constraint. The shared pure parser has a tested native runtime
route and preserves the existing ledger owner.

## Shipping code and build route

- `src/lib/ios-background-alert-parser.ts`: guarded shared-parser adapter and
  versioned scalar result contract.
- `scripts/generate-ios-background-parser.cjs`: compile its transitive closure
  directly from normal `src/lib` source with the project's pinned TypeScript.
  Reject Node, RN, native, storage and unresolved external dependencies. Do not
  consume or reconstruct `scripts/test/build` or historical validation bundles.
- Emit deterministic plain UTF-8 JavaScript and source/version/SHA-256 metadata
  into the existing native resource bundle. No downloaded executable code.
- `WafraBackgroundAlertParser.swift`: optional resource lookup, hash/version
  check, fresh-context execution and strict output validation.
- Link JavaScriptCore in the module podspec. Generate/check resources before
  prebuild/CocoaPods in the current CI and iOS build workflows. Expand native
  path filters to include the generator, adapter and parser closure.

The generator also emits the expected source hash for foreground code. Its
`--check` runs in the existing OTA/update validation route. Explicitly include
the generated native resource/metadata in the Expo native fingerprint and test
that parser-source changes alter that fingerprint. A changed native parser
resource requires a matching native build. Exchange the foreground expected
source hash in the settings snapshot and suppress previews on a native/source
hash mismatch; never silently pair a new OTA parser with an old native reader.

Missing resources fail quietly; the runtime must avoid the existing resource
resolver's precondition failure. Do not fall back to a weaker financial reader
when the shared runtime fails.

## Context, result and notification policy

Persist a separately validated settings snapshot in the protected native
manifest: schema version, nullable ISO country, parser market AE/SA/ZZ, and
nullable ledger currency/exponent and expected parser source hash. Synchronize it from hydrated foreground
preferences through an additive optional native bridge method. Validate it in
Swift and again in the pure adapter against existing currency/country metadata.
Do not infer country from currency or invent defaults when context is missing.
The snapshot contains no account records, balances, merchant overrides, raw
messages or encryption keys. Parser preferences cannot authorize ledger posting.
Missing, malformed or unsupported optional snapshot fields decode to unavailable
preview context. They must not invalidate the existing manifest, block receipt
staging/draining, or alter old record bytes. Add old-manifest and malformed-
snapshot migration tests.

Per call, use the already validated sender/body and available observation time.
Normalize placeholder senders to empty. Use the existing source-qualified date
and issuer conventions; do not promote a placeholder to bank identity.

Return only schema/parser versions, route parsed/review/ignore, provenance and
an optional notification payload. The payload contains movement family,
debit/credit direction, source currency, integer minor-unit string, exponent,
optional bounded merchant, and only a proven four-digit instrument tail. No raw
body, reference, full account identifier, owner, category, balance, rate or
converted ledger amount crosses back to Swift.

For foreign parsed rows require a valid `originalCurrency`,
`originalMinorUnits` and `originalExponent` pair before accepting `originalMoneyOf`.
That helper's legacy `originalAmountMinor`/exponent-two fallback is insufficient
for this contract. If the true pair is absent or invalid, obtain an explicit
single source principal through the guarded Review seam or suppress the banner.
For ordinary same-currency rows with no foreign/FX annotation, validated
`parsed.currency` and principal `parsed.amountFils` remain eligible when they
agree with the source movement; use current ISO exponent metadata. Never display
a converted ledger estimate as the source charge. For Review use the guarded
shared Review seam and a single explicit principal amount. Missing FX means
Review, not disappearance. Never repin the ledger merely to obtain a parsed row.
Currency and exponent must agree; format money in Swift with integer/decimal operations.

Explicit known-format completed movements may use a movement banner. Unverified
but clearly posted, single-money bank events may use a distinct "Bank alert to
review" banner; they must not announce that Wafra recorded spending/income.
Ambiguous money/direction/status, statements, repayments, personal messages,
credentials, promotions, requests, declines and unsupported data remain silent
and retain their existing foreground handling. Best-effort posting is disabled
in this adapter to preserve current iOS Review policy. Transfers use sent/
received wording without claiming own-account ownership or net spending.

Existing charge-alert preference, entitlement, opt-out and notification
permission gates remain authoritative. Recheck capture-enabled, current
entitlement and charge-alert state together under the native manifest lock
before emitting a result. Existing `instantAlertsEnabled()` alone checks only
the alert preference and is insufficient. Require the current validated
context digest/source hash to equal the captured snapshot before emission;
changed preferences or parser resources suppress a stale result. Check OS
notification permission separately; any gate failure suppresses only the
preview. Snapshot and gate
errors must not invalidate or discard the already staged receipt.
Preserve stable notification identifiers and exact source bytes for replay.

## Bounds and failure behavior

Keep the current 16 KiB queue body and 80 UTF-16 sender limits. Preview work
accepts at most 4 KiB UTF-8 body; longer bodies remain queued unchanged. Resource
closure is at most 64 modules and bundle at most 2 MiB; result at most 2 KiB.
Only finite positive safe integer amounts, supported exponents and closed
vocabularies are accepted. No text truncation may turn a refusal into a posting.

Use a two-second result deadline checked before and after evaluation. Installed
public JavaScriptCore APIs do not provide a hard execution kill; a dispatch
wait/cancellation does not interrupt synchronous JavaScript. Do not claim that
it does. Bounded trusted input, a serial admission gate, pathological-input
checks and physical measurements are required; late results are suppressed.

Ledger writes remain in the foreground drain. Its key stays
WHEN_UNLOCKED_THIS_DEVICE_ONLY. Full Android-style closed/locked ledger updates
are outside this integration and require a separate design and privacy decision.

## Verification and release gate

Test the actual shipping adapter and generated native resource, not a test
rewrite: UAE/Saudi positives, ENBD transfer legs, USD/EUR/GBP/JOD in differently
pinned ledgers, three-decimal units, missing FX, unknown country, ambiguity,
personal text, OTP/grouped codes, declined/future/negated movements, genuine
receipt advice, missing/corrupt resources, malformed output, busy/late calls,
preference/entitlement changes and exact replay bytes. Compare source and
packaged resource hashes and parser version in the signed artifact.

Run app/server typechecks, targeted/native checks, relevant full suites and an
independent read-only review. Physical iPhone evidence must cover locked,
closed, offline and retry behavior, real alerts and the exact Apple banner.
No phone proof, universal coverage, signed build or silence claim can be inferred
from the existing 24-case macOS proof. Commit/push/deploy/install remain governed
by the owner's separate publication authorization.
