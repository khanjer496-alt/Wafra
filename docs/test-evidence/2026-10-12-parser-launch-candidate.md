# Parser launch candidate — 12 October 2026

Status: source candidate implemented; current capture/parser checks, app/server typechecks and scoped independent review pass. A completed full application test run, signed native artifact and current physical-phone behavior remain open. This is not a launch approval or a bank-wide coverage claim.

The candidate is `/Users/naserkhanjar/.codex/worktrees/parser-launch-candidate/Wafra`, based on current `origin/main` at `d23c32e4b641a6e98f7c5581f818cf20d974cc2d`. It contains the parser work in normal source and test paths. The dirty canonical checkout remains preserved; unrelated billing and legal drafts were not bundled. No commit, push, deployment, submission or device installation has occurred.

## Final behavior

| Path | Unverified formats |
| --- | --- |
| Android SMS | Strongly grounded completed movements may auto-add with **Auto-added — check** under the default best-effort setting; other eligible alerts go to Review. |
| Android bank notifications | Native financial/credential checks run first. Existing installer, app identity and source qualification still apply before any automatic import. |
| iPhone live capture | Unverified alerts remain Review-only. |
| iPhone Messages History | Eligible ordinary movements may auto-add with the marker. Unverified card statements and repayments remain typed Review. |
| Unverified statements, every path | Typed Review retains totals, minimums, deadlines and card facts; no unmarked debt is created. |
| Android provider-SMS completed card repayments | The dedicated guarded adapter retains best-effort provenance and instrument-scoped replay tombstones; repayments remain settlements, not spending. Weak notification and legacy delivery observations retain repayment facts in typed Review. |
| Personal formats and paste | Two received alerts can establish a device-bound format that fills eligible Review fields. It cannot authorize posting. Sender-bound formats cannot match senderless paste. |

UAE/Saudi launch-tested formats retain their existing behavior. The US, UK, Jordan and European rules provide format-dependent best-effort or Review support; the collected evidence does not establish bank-wide coverage in those markets.

## Implemented launch fixes

- Sender-qualified principal currency controls issuer date conventions. A secondary balance/fee, shared symbol, body-only bank name or conflicting issuer cannot supply that proof.
- Owner/lifecycle dates cannot become transaction dates. Genuine transaction dates following greetings remain usable.
- Routed Jordan JD/dinar amounts preserve three decimal places. Currency aliases remain scoped; foreign currency and embedded identifiers are not relabelled.
- A new statement grammar refuses competing card identities rather than attaching debt to the first card in a message.
- European financial notification vocabulary reaches the existing source qualification pipeline. Native credential refusal includes grouped and Unicode codes before queue storage.
- Teaching, second-sample validation, matching and Review share qualified source date conventions. Deferred key IO cannot read a canceled paste or teaching source.
- Card-payment Undo uses provider identity or a qualified card/bank/receipt identity; it cannot suppress another card payment solely because time and amount match.
- Web erase bypasses unavailable native SecureStore. Native credential read/decoding errors still stop erasure before local mutation.
- Unqualified platform-model alert inference is off by default. No research model weights, model runtime or cloud SMS inference is shipped by this change.

Personal teaching remains narrower than the normal parser's money reader: routed JD/dinar spellings are not yet teachable, and unresolved amounts/dates require Review. Stored formats contain authenticated device-bound structure, are omitted from portable backups, and are retired on erase or incompatible key/source state.

## Evidence boundaries

Focused checks and independent reviews reproduce the financial defects before their fixes and verify refusal and field-preservation controls afterward. These include actual Kotlin classes and actual History/planner/ledger/payment-allocation paths. They do not establish physical-phone behavior or accuracy across every bank.

App/server typechecks and Expo doctor pass; lint has no errors and 18 existing warnings. Both platform native sources were generated through the normal Expo prebuild route. The candidate has its own pinned dependencies, including the locked Expo Updates version.

The normal universal runner passed all 22 suites, and the monetary/evidence gates and 48 invariants passed. The actual Swift History source suite passed 394 checks. The final rebuilt focused checks passed: relay 315, Android Review capture 153, import planner 390, best-effort posting 526, capabilities 7, onboarding 225, country 110 and card/native Review 29. The production Kotlin financial/credential classifier passed 175 checks; existing Kotlin cases passed 113.

The 90 application and three server suites were exercised separately after the native build stop. Two stale structural tests were corrected and passed in the rebuilt checks above. A broader interaction run reached 2,425 subtests before it was stopped for disk pressure; its 14 harness dependency/haptic failures were corrected, with all 34 affected storage/screen checks then passing. The remaining interaction files are running in fresh processes. This is continuation evidence, not a completed full `npm test` run.

CocoaPods installation succeeded after normal prebuild. The subsequent full native application build was stopped after 331 seconds to preserve disk reserve, at about 0.91 GB free. No native artifact pass is claimed. The task-generated Pods were released afterward; normal source, lockfile and build diagnostics remain. The host runs Xcode 26.1.1; Expo 55 recommends Xcode 26.2 or later.

The card-ownership finding was corrected and independently reviewed: debit/prepaid/gift-only identity cannot pay an unnamed credit card. Subsequent compatibility checks restored valid Rs. payment clauses and own-funded merchant transfers; these narrow corrections passed 73 focused production-source cases, but the review agents exhausted usage before a new independent final approval.

Claude stopped work on PR #159 at `e74db5a1391bd34a20fe0c38654285ad033c1ab4`. Its 13 evaluation/test paths were integrated narrowly, preserving the merged PR #145/#153/#157/#158 implementations. The evaluator now uses the actual History importer; Android is labelled a parser seam, and three optional settlements require exact kind/money/card identity. All 504 rows remain synthetic. Seven wrong-direction readings were fixed or held for Review. The rebuilt gate passes with no unsafe results across 1,007 evaluations; the recorded synthetic positive acceptance floors are 108/345 Android and 95/345 History. These are regression floors, not bank-wide accuracy or coverage.

## iOS capture, currencies and ENBD transfers — 13–14 October

The attempted currency-specific trigger recommendation was withdrawn on 14 October: it would miss valid foreign-currency alerts for UAE users and other markets. The English/Arabic guide and recorded capture instructions now agree on one currency-independent space trigger. The app no longer derives the trigger from the ledger currency, and the guided-configuration guard rejects keyword/currency filters as incomplete. A space matches only messages containing a space; this is not proof of every language or SMS format. Existing personal automations require a user edit; an app update does not replace their trigger.

Apple owns the Running your automation banner. Users choose Run Immediately and turn Notify When Run off where available. Wafra cannot change another app's notification settings. Apple documents automatic Message runs without a trigger notification, but the reported banner remains unresolved: the affected iOS version and toggle state are unknown, and no fresh physical reproduction was performed. See [Apple's iOS 26 automatic-run guidance](https://support.apple.com/guide/shortcuts/enable-or-disable-a-personal-automation-apd602971e63/9.0/ios/26) and [Message trigger filters](https://support.apple.com/guide/shortcuts/communication-triggers-apdd711f9dff/9.0/ios/26).

The broad native iOS queue now rejects recognized security credentials before disk access or a capture-off notice, using the shared Android/Swift credential patterns. No currency vocabulary is used to filter queue admission. Explicit first-person conversational spending is refused by the local parser and native preview; this bounded regression fix does not establish complete personal-message classification. Unfamiliar financial alerts retain their existing parser or Review route. Privacy classification normalizes temporary text only; queue bodies, digests and replay identities keep their exact bytes. Credential advice and unrelated receipt references remain admissible.

The user's four ENBD examples already parse correctly in the current TypeScript parser. Anonymized synthetic equivalents now verify principal money, direction, balances, partial-account refusal and preservation of opposite same-amount legs in History. The native preview's shared Kotlin/generated Swift pattern now recognizes the exact completed “has been transferred to your account” shape and rejects conditional/future/credential controls. This preview is not a ledger commit; signed-device proof remains necessary.

The 13 October 640 MiB full-app typecheck attempt exhausted its Node heap. On 14 October, fresh app and server typechecks pass with a 1,536 MiB cap, and normal source-module compilation passes. The final affected checks pass: iOS capture setup 460, setup UX 282, native-preview JS 43, universal suites 23/23, and the 96 focused capture/guide/transfer/credential tests. The final production Kotlin credential/classifier check passes 230 assertions; JVM/native Kotlin regressions pass 113. Actual Swift checks pass: protected queue 331, bridge 114, preview and sensitive-message fixture 166, resources 172, queue signal 16 and malformed-preview/privacy admission controls 14. Debug/release App Intent source and notification helpers typecheck against the installed iOS SDK. Scoped lint and diff checks have no errors. Independent review passes 95 earlier capture cases and 17 final credential controls with no remaining findings. These are local source/native-component checks, not a signed application or physical Shortcut run. B2 browser results remain tied to the earlier source; B3 and the complete application gate remain pending.

## Remaining release gates

- Complete the final native/application test and artifact checks against this exact candidate.
- Verify locked, closed, offline and retry capture, History replay, grouped credential refusal, personal-format key lifecycle and erasure on physical iPhone/Android builds.
- Integrate the reviewed candidate through the repository's authorized commit/publication workflow. The canonical dirty checkout must be preserved.
- The whole-app release check reports missing global Google Play screenshots/feature graphic and the unresolved governing-law clause on upstream main. Metadata limits and guarded coverage claims pass. Store pricing is structurally valid; live commercial approval remains separate. A reviewed local legal draft already supplies the delegated Wyoming clause and publisher contact in the canonical tree; integration, publication and live verification remain separate work. This parser candidate does not certify legal/billing publication readiness.

Publication and device installation require separate owner authorization under `AGENTS.md` and `docs/repository-workflow.md`.


## Shared parser background experiment — 14 October

The current pure parser now runs in a test-only Swift JavaScriptCore context: 24/24 controlled cases match Node, with independent positive/negative expectations. The experiment exposed and fixed personal-message and leading-negated-principal gaps at the pure API boundary; the native preview now refuses the matching leading-negation shapes. This was engine feasibility and local safety evidence. The subsequently approved shared-parser AppIntent integration is now implemented and independently reviewed; signed app and physical banner/locked-device proof remain open. See the [complete experiment and next integration gates](2026-10-14-ios-background-parser-probe.md).


## Approved native integration — 14 October

The shared parser now drives the production iOS notification decision through
JavaScriptCore, with validated original currency/units, Review captions for
clear unverified formats, strict privacy output and current native gates.
Foreground ledger ownership and receipt identities remain unchanged. See the
[complete integration evidence and remaining release gates](2026-10-14-ios-native-parser-integration.md). The earlier Kotlin-derived reader remains the native credential boundary and Android parity fixture. The earlier experiment and source manifests are historical evidence, not the final integration snapshot.
