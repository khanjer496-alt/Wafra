# Onboarding: from an example to a real first entry

Accepted direction, 8 September 2026: an interactive example followed by setup choices. Work starts from canonical `main` at `d6dd2eef92f34d04b64dd44e72f911d6c1caad15`.

## Experience

1. **See the value.** A charcoal Ledger & Light welcome shows an explicitly labeled sample coffee purchase. “Organize this alert” switches it to a categorized entry. The example is optional, reversible, and component-local; it never sets currency or writes financial/setup data. “Choose how to start” is available immediately.
2. **Choose the method.** Two equally accessible actions on phones: iOS local Apple Shortcuts or Android bank SMS, and manual tracking. Android permission and first-three-app-days/Pro terms appear before selection. iOS explains that past messages can wait and retains its detailed privacy sheet. Web previews offer manual tracking only.
3. **Optional preferences.** Goals and budget style are reached from the setup-choice screen. They use two-step progress. Back returns to the choice that opened them; saved preferences have an explicit edit state. Real amounts still wait for actual currency and credible income.
4. **Begin with real data.** Successful manual setup offers a first entry or an empty-ledger tour. Permission denial and setup errors offer recovery and an explicit manual choice, without manufacturing capture success.
5. **iPhone setup.** A single heading precedes Future alerts first and optional Past messages second. Readiness evidence follows the steps. After future setup is checked, the primary action opens the existing protected history-deferral confirmation; importing history stays an explicit secondary choice. Saved sections and pending-history recovery are preserved. All cleanup and durable completion handlers remain intact.

## Implementation boundaries

The gate stays above the mounted navigator and retains encrypted hydration, recovery, route exceptions and resume behavior. A busy guard serializes async setup choices. The shared store, parser, monetary projections, source-bound review editor and native capture implementations are outside this change. The Android notification beta is configured only through its existing guarded Settings flow.

Use existing bundled fonts/tokens and Expo SDK 55 / React Native 0.83.10. No dependencies or build/version configuration changes. Text wraps and the full experience scrolls at larger sizes. Logical layout follows the existing RTL provider; directional icons already mirror. Example/step transitions use opacity or modest entry motion only when motion preference is known, without progress timers.

## Home readiness consistency

The physical build-55 QA finding is included: Home now requires both native action proof and the saved Message-automation confirmation before reporting that it is waiting for the first alert. An unreadable confirmation record fails closed. Queue warnings, entitlement, opt-out, migration and actual received-alert milestones keep their previous precedence; receipt evidence is not discarded. Existing focus and app-active refreshes reread the flag, and Home already routes unfinished automation to setup.

## Verification results

Before disk pressure interrupted local tools:

- All 71 app JavaScript suites passed via the direct runner (exit 0, no failed assertions).
- 121 focused onboarding, iOS journey, workflow, money-reactivity and source-review tests passed.
- Browser acceptance passed 4 onboarding scenarios, 15 existing universal-review scenarios and 8 Home cashflow scenarios. English and Arabic RTL, 320px width, 200% browser text and reduced motion were exercised with isolated storage.
- TypeScript, scoped lint and the Ledger & Light design baseline passed during implementation.
- An independent reviewer checked the gate, example and consent/recovery logic; a second reviewer checked the iOS presentation change. Findings about durable completion and the accessible optional-plan explanation were addressed.

On the final onboarding-handler source:

- All 27 action tests pass, including explicit manual opt-out, unavailable Android bridge, duplicate taps, persisted completion, visible failed-save retry, and automatic save-only retry without rescanning.
- All 81 onboarding checks and 6 executed resume scenarios pass.
- The canonical readiness/lifecycle Task 6 block passes 63 checks after the Home status fix. This executes the actual hook and existing focused tests, with no source substitution.
- All five changed TS/TSX source files parse and transpile with zero syntax diagnostics. This does not replace the blocked full semantic typecheck.
- Changed files were read back and hashed after atomic writes; no partial temporary source files remained.

Saved browser evidence: `/private/tmp/wafra-onboarding-browser-final/verification.md` and its `onboarding/` screenshots/results. Browser snapshots precede the last two Android recovery-only handler refinements and the iOS Home readiness correction. Those changes have direct executed-source tests and do not change the welcome visuals. The temporary exported sites were stopped and removed to recover disk space; the screenshots and test logs remain.

## Saved previews

These images are actual browser renders with isolated, empty ledger storage:

- [Welcome](test-evidence/onboarding-redesign-20260908/welcome.png)
- [Organized example](test-evidence/onboarding-redesign-20260908/organized.png)
- [Arabic at 320px and 200% text](test-evidence/onboarding-redesign-20260908/arabic-large-text.png)

## Initial implementation verification limits

The full `npm test` run passed 348 Foundation history-store checks, then stopped because the canonical checkout has no generated `ios/Wafra.xcworkspace`. This is not a passing native packaging check.

Later, the Mac reached 100% disk usage. iCloud evicted local Git metadata, dependencies and several unrelated source files. Final broad reruns returned file-read `ETIMEDOUT` errors (57 of 123 combined cases failed to read their inputs), and a compiler-API retry reported unavailable files/modules. These reruns are not green and do not establish final whole-app verification. The narrower final onboarding tests above execute readable current source.

The isolated iPhone development client never reached this app build: its local manifest/server loading was interrupted by these file-read failures. No new Android native build was started. There is no native UI acceptance, physical-iPhone delivery proof, real-SMS proof or genuine bank-app notification proof for this redesign.

Only this task’s disposable simulator and regenerable preview/cache intermediates were removed. The original iPhone 17 remains booted and Wafra_Pixel remains present. The existing iPhone data was not changed; only its installed development binary was read to install the separate test simulator.

At that implementation checkpoint, Git status was unavailable because iCloud could not materialize `.git/HEAD` and `.git/index`. During release preparation, the original unavailable index was preserved at `.git/index.icloud-preserved-20260908` and a verified HEAD index restored Git access without changing working files. This record covers implementation checks; release verification and exact commit/build IDs are recorded separately.

## Physical feedback after initial implementation

A build-55 user reported slow extraction and ambiguous early return from a
manually started Shortcut. The updated order and extraction-stage copy do not
solve the underlying throughput problem or provide live preparation telemetry.
No import-speed improvement is claimed. See `ios-beta-readiness.md` for the
remaining physical acceptance limitations. The future-first follow-up passed
268 focused setup/recovery checks with real handlers and unchanged native code.
