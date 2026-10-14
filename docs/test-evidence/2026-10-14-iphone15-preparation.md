# iPhone 15 preparation — 14 October 2026

Owner requested a dedicated iPhone15 test session tomorrow and selected **15 October, 6 PM Dubai time**. An active one-run thread heartbeat is scheduled. Physical installation/testing on that dedicated phone is authorized; repository commits/pushes, public release and real-money bank actions require separate approval.

## Prepared

- The [26-case runbook](../ios-iphone15-acceptance.md) covers actual SMS, Shortcuts, source units/transfers/Review, lifecycle and protection states, imports, erasure, sandbox billing, EN/AR/accessibility and phone performance. All physical result rows start not tested.
- Read-only `scripts/release/iphone-test-readiness.mjs` consumes supported CoreDevice JSON, selects only the intended iPhone15 family, queries only Wafra, redacts device identity, and keeps artifact/source/physical proof unverified. Today it returned device_unavailable and made no app lookup; a different paired iPhone16 was not selected. Live app-JSON schema confirmation waits for the intended phone.
- Latest PR159 CI actually ran: native and browser jobs passed; one timing-dependent small-transfer-graph assertion failed. Source-loaded controlled-clock tests now cover immediate and deferred correct graphs; production6ms/8ms budgets and real40ms performance threshold are unchanged.
- 44 focused readiness/scheduling/performance checks, syntax/lint and independent review pass. Prior shared-parser/native94 and complete portable3794 checks remain recorded separately in the integration evidence; no new app-source behavior was changed today.
- Corrected beta-readiness's obsolete Documents checkout and marked relay Capturev2 instructions historical. Current local graphs are bundled Capturev3 and Historyv8.

## Fresh build attempt

Pinned Node22.22.3/EAS22.4.0 authenticated and accepted existing remote signing configuration for the app and widget. The reviewed production-candidate working-tree source was uploaded (53MiB); EAS advanced the remote build number188→189, then rejected build creation because Free iOS quota is exhausted until1November. **No new build/IPA exists, no Apple submission occurred and no paid plan changed.** Credential readiness is not signing-validity proof.

The normal EAS CLI includes changed/untracked source without a commit when requireCommit is false. Because its Git metadata still describes the base revision, an independent1005-file build-input snapshot and parser resource hash were saved. The initial archive-only inspection matched the actual parser resources; its task-created copy was removed after checking. A brief disk reserve dip does not prove that visible70MiB copy caused the full disk change.

A prior signed baseline version1.0.0 build188 from d23c32e4 was downloaded and its IPA hash matched its receipt. It lacks WafraBackgroundParser.js and cannot validate the new integration. TestFlight link existence or old successful submission is not fresh tester availability.

## Next gate

The existing GitHub macOS workflow can produce and verify the signed candidate with Xcode26.2+, frozen existing credentials and packaged parser/AppIntent checks. It requires the reviewed source on main; the owner has been asked for explicit commit/push approval under AGENTS. An [explicit publication manifest](../../artifacts/iphone15-readiness-20261014/publication-plan.safe.json) lists the candidate changes and excludes local evidence/cache files. Unrelated unfinished canonical billing/legal edits remain preserved. A restored Expo quota would permit the current uncommitted working-tree build instead.

The [safe preparation receipt](../../artifacts/iphone15-readiness-20261014/preparation.safe.json) and build-source/build-attempt receipts record this state. One iPhone15/OS can be tested deeply; this alone does not establish all iOS versions, banks/languages, Apple's banner suppression or Android-equivalent background ledger posting.
