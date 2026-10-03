# iPhone capture setup and history recovery — 23 September 2026

## Scope and source

The reported problems are slow history import, history failing on some phones,
and difficult setup for future messages/notifications. Work is on canonical
`main`, based on `d95c3d892462b284e7524445d8c09005429cb0b3`, without committing or
publishing. Pre-existing UI edits were preserved.

## Changes

- Setup now checks the installed capture Shortcut and its permissions before
  showing the Message automation instructions. The check explicitly runs in the
  foreground. Help describes first-run app permission and the Shortcuts Privacy
  option for locked execution when present. Confirming the automation re-reads
  native status and does not rerun an already-proven check. A failed status read
  cannot bypass setup, and a successful callback is not proof of bank delivery.
- Removed duplicate sender explanation from the automation step; the whitespace
  filter instructions now accurately say they match messages containing a space.
- History Shortcut errors return with an explicit failure state. Before the first
  saved page, the UI does not claim saved progress. It offers the existing PDF/CSV
  statement import route without discarding a resumable SMS session or marking
  that history complete. During onboarding, only an explicit live navigation
  token allows the statement screen; an arbitrary cold deep link does not.
- `stageColumns` accepts a wholly absent sender column as empty senders, exactly
  like the existing typed-row fallback. Nonempty partial sender columns still
  fail alignment validation. This removes one known reason to fall back to a
  per-message native call. It does not prove that date/body/GUID columns work on
  every iOS version or establish a measured speedup.
- A separate History v7 candidate overlaps strict oldest-query age bands by one
  second. Regression tests reproduce the v6 hole at the one-, three-, and ten-year
  boundaries and verify v7 at each boundary and one millisecond either side.
  Generated v2–v6 graphs remain byte-identical. Runtime installation URLs still
  point to the previously published artifacts.

## Verification

- Native paging harness: **442 checks passed**, including 100-message equivalence
  between absent-sender columns and typed rows, complete source records, page
  checkpoints, and refusal without cursor advancement for partial/sentinel errors.
- Final iPhone journey, paging graph and loader group: **181 tests passed**.
- Permission controller: **4 tests passed**. Existing capture setup suite:
  **395 assertions passed**. Full setup UX/recovery suite: **281 assertions passed**.
- Onboarding/navigation/handoff suites: **47 tests passed**. History
  recovery/setup suites: **14 tests passed**.
- Typecheck and scoped ESLint passed after the app changes.
- Independent read-only review completed with no remaining actionable findings
  after fixing the failed-status preflight branch.
- Public artifact checks passed for the current capture iCloud record
  `822bcc1dd2964b9f887ef9b93601441d` (35 actions, approved, graph equality) and
  the published history v2/v4/v6 artifacts.
- The ordinary `npm test` command **did not pass**: its native build check stopped
  because `ios/Wafra.xcworkspace` was absent. CocoaPods installation subsequently
  restored the workspace (142 pods); the native gate was rerun. Installed Xcode
  is 26.1.1. The final native-gate result is recorded below.

## Local signed candidate

Generated with:

```sh
node scripts/build-ios-paged-history-shortcut.mjs --boundary-safe /tmp/WafraHistoryV7.json
plutil -convert binary1 -o /tmp/WafraHistoryV7.unsigned.shortcut /tmp/WafraHistoryV7.json
shortcuts sign --mode anyone --input /tmp/WafraHistoryV7.unsigned.shortcut --output /tmp/Wafra-History-v7-review.shortcut
```

Review files are under `ios-release-evidence/capture-history-20260923/`:

- `WafraHistoryV7.json`: verified candidate graph, 170 actions.
- `Wafra-History-v7-review.shortcut`: Apple-signed AEA1, 44,184 bytes.
- SHA-256: `caad9e7dbfa5997a8b07883621ab72badc0894e0c73f1dadf2459d916c3b07f4`.

This has a separate review filename and must be launched manually when installed
for testing. The released app still runs the v6 installed name. Signing is not
installation, device validation, or publication.

## Remaining product qualification

The paired iPhone 16 Pro initially appeared unavailable, then briefly advertised
availability over the local network. Partial device metadata reports iOS 26.6.2
(build 23G90), but the tunnel disconnected and the targeted Wafra app lookup timed
out. iPhone Mirroring also could not connect. USB/unlocked access is needed to
qualify the flow. No device changes, permission grants, message reads, financial
uploads, or purchases were performed.

1. On an available iPhone, run the permission check, create the Message automation,
   and observe a naturally arriving bank alert with Wafra closed and the phone
   locked. Verify its actual ledger/review outcome and absence of duplicates.
2. Confirm Notification input and content binding on iOS 27 before adding a
   notification setup option. Apple's current guide documents the trigger and
   Title/Subtitle/Message filters; this does not prove payload delivery to Wafra.
   This patch does not advertise a tested notification-capture integration.
3. Run v7 on both the small and previously failing large inbox. Record page mode,
   elapsed time, source count, dates, resume behavior, and bank attribution.
   Broad initial age-band queries can still fail inside Apple's Find Messages;
   v7's boundary fix is not a dense-inbox query fix. The statement route offers
   an alternative without depending on that query.
4. Exercise native PDF/CSV selection and return during onboarding. Existing
   statement-processing consent/configuration requirements still apply.
5. Separate discovered issue: `ios-history-import.ts` caps review-only candidates
   at 50, as does the downstream review tray. This patch does not change that
   policy; large worldwide review-only imports need retained-source/batched review
   before claiming no unsupported-alert loss.

References: [Arc permission FAQ](https://arc.moi/faq/),
[Apple notification triggers](https://support.apple.com/guide/shortcuts/event-triggers-apd932ff833f/ios),
[Apple automatic/locked execution](https://support.apple.com/guide/shortcuts/add-automations-apdfbdbd7123/ios).

## Broader test result

The separate broad JavaScript interaction run executed 1,375 tests and initially
reported 46 failures. Seven failures introduced by this task were resolved:
three tests still pressed preflight controls in their former order, and four
shared onboarding tests needed the new handoff dependency loaded. The targeted
iPhone group then passed all 181 tests; both English/Arabic welcome-scene and
workflow-onboarding pairs also passed. A failed/cancelled preflight now persists
its in-progress state before returning to the app.

The remaining 39 failures in that broad run belong to other/concurrent changes:
9 Wallet tests missing the transfer-activity-copy harness dependency,
26 Transactions tests missing transfer-activity, 1 Spending test missing
period-pill, 2 focused-input contrast selectors, and 1 import-screen source
contract. An independent reviewer traced each to diffs outside this task.
These do not constitute a green repository-wide gate and were not repaired
within this capture/history task. The 79 app test files were also exercised
separately, with the changed setup UX suite rerun after its old expectations
were updated (281 assertions passed).

## Final native build result and cleanup

After restoring CocoaPods, the actual native history store completed **394
checks with zero failures**. The full Xcode app build still did not pass. The
first temporary gate retained only the tail of its failed build log. A second
build with two jobs and a persistent log identified the concrete environment
failure: **No space left on device** and **build database or disk is full**.
The remaining Foundation/XPC/UIKit module errors occurred alongside that disk
exhaustion; this is not evidence of a successful app compilation.

Only this task's temporary DerivedData directory
`/tmp/wafra-capture-native-build-20260923` was removed, recovering about 3.1 GiB
(3.2 GiB available afterward). Source, the signed candidate, CocoaPods workspace,
and evidence were retained. Build diagnostics remain at
`/tmp/wafra-capture-xcode-final.log`. A full build, compiled App Intent metadata,
and built-resource verification remain blocked until sufficient disk space is
available. No broad cache cleanup or deletion of user files was performed.
