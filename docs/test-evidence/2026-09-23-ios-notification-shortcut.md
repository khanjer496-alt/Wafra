# iOS notification Shortcut candidate — 23 September 2026

## Final scoped review result

The local artifact work and independent money/replay/capacity review are complete.
The final five-file safety run passed **39/39 tests**, including the actual
coordinator, parser, import planner and materialized ledger reducer for both mixed
SMS/notification arrival orders. First ACK failure, subsequent user corrections,
retained Review and retry now preserve one transaction and the corrected values.
Independent inspection found no remaining actionable issue in the final two-pass
coordinator block. The **55 Shortcut tests** and signed-resource checks also passed.

All findings in the review history below were resolved for this bounded first
release. Ambiguous matching notifications enter Review; notification card payments
and other non-transaction events do not reach automatic financial mutation.
Protected notification reviews survive the legacy review quota, storage/restore,
and queue overflow; unchanged legacy-source eviction policy is not claimed fixed.

Reviewed coordinator SHA-256:
`b0b34c60f2093411dde84603db4f1e654e784c69f366b6bf54931061fb31910e`.
Reviewed replay guard SHA-256:
`dddf37393ca28b12e93014baa461f9bb8b92f5b3cc9d24b48d33f304278603af`.
The final run log is
`ios-release-evidence/notification-shortcut-20260923/money-review-final.log`.
Broader implementation/native/UI evidence belongs to
`docs/test-evidence/2026-09-23-ios27-notification-capture.md`.

**Still open:** successful full app build and extracted App Intent metadata,
installation, real iOS 27 Notification-to-Text conversion and locked-phone bank
delivery. The available phone is iOS 26. No publication or physical qualification
is implied by this local review result.

## Scope

Work is based on canonical `main` at
`d95c3d892462b284e7524445d8c09005429cb0b3`, with existing uncommitted work
preserved. The separate **Investigate Arc.moi iPhone fix** task owns the native
receiver, queue, parser adapter, setup screens and their tests. This task owns
the prebound Shortcut builder, its regression tests, local signed artifacts and
this qualification record. No commit or publication is authorized by this record.

The candidate removes manual text-field wiring. A manual run with no input sends
the benign `Wafra notification setup check` phrase to
`CaptureWafraNotificationIntent` and stops. A run with input converts that input
to text and calls the same action once. The native receiver treats the exact
setup phrase as a permission/setup check, without creating a financial record.

The Shortcut does not query Messages, read historical notifications, send data
over the network, or choose a bank. It does not include an invented automation
trigger: an exported iOS 27 Notification automation fixture is not available.
The bank app and Notification trigger must still be selected in Shortcuts.

## Candidate and local verification

### Preferred candidate for app bundling

The capture task requested an exact filename match for its bundled resource and
Shortcuts run URL. The graph remains unchanged, including its name
**Wafra Notifications v1**. The preferred bundle candidate is:

`ios-release-evidence/notification-shortcut-20260923/bundle-v1/Wafra Notifications v1.shortcut`

- **22,747 bytes**, SHA-256
  `93e9c6e120a6a7bedeb95a3b4b952c7a57cbad9622ba269562de1413e6608fcc`.
- Unsigned signing input, signing output and final copied artifact all have the
  exact basename `Wafra Notifications v1.shortcut`.
- JSON matches the reviewed seven-action builder exactly. Apple signature
  validation passed on a disposable copy. The retained file matches the
  separate `WafraNotificationsV1.preserved.bin` copy byte-for-byte.
- A `manifest.json` beside the file records these checks and outstanding gates.
- This confirms filename/JSON-name alignment, not the installed name on a phone.
  Native bundling, the setup action and final app build belong to the capture
  task; this artifact record is not proof that they have shipped.

The source resource at
`modules/wafra-live-capture/ios/Resources/Wafra Notifications v1.shortcut` was
subsequently checked against this candidate and has the same SHA-256. The podspec
includes `Resources/**/*`, and the native bridge resolves only that fixed bundled
filename. This is source/resource verification, not a compiled-app verification.

### Earlier review candidate retained

- Builder: `scripts/build-ios-notification-shortcut.mjs`.
- Regression suite: `scripts/test/ios-notification-shortcut.test.mjs`.
- Candidate directory: `ios-release-evidence/notification-shortcut-20260923/`.
- Installable review file: `Wafra-Notifications-v1-review.shortcut`, **22,748 bytes**.
- Preserved signed copy: `Wafra-Notifications-v1-preserved.bin` (identical bytes).
- Signed file SHA-256:
  `e1d01b1808d3e0da3152a2385515900857905d601aad50ccf3689968775aa816`.
- Generated JSON SHA-256:
  `7ed3b487f03b29975671970d08cc64f0253ec271538c24ab09f88131edffaaf8`.
- Builder SHA-256:
  `3d6a75be12d57b04d938bc65cb4da0a0060bfa6c26c2a4e9d430772c2bb31fba`.

The **55 tests passed**. They exercise emitted control flow and String bindings
over synthetic input, setup/live separation, Arabic and multiline preservation,
native failure propagation without retries, artifact mutations, and CLI failure.
The evaluator explicitly refuses Notification objects and lists; it does not
stand in for Apple's input conversion. Independent read-only review found no
actionable issues in the final builder and tests. Syntax and whitespace checks
passed, as did the existing SMS local-capture artifact regression suite.
The new suite is included in `scripts/test/run.sh`'s existing Node test group;
runner syntax and its one-line integration diff passed inspection.

Both the generated JSON and a binary-plist round trip matched the reviewed
seven-action graph before signing. `shortcuts sign --mode anyone` exited zero
and generated an AEA1 file. Apple's signature was then validated independently
using the existing artifact checker's `--signature-only` mode on a disposable
copy. That check does
not inspect the signed archive's opaque contents; provenance comes from signing
the verified unsigned graph in this task. Apple's signing tool emitted
Objective-C `debugDescription` attribute warnings despite successful completion.
The descriptor team matches the existing capture builder and `eas.json`'s
`appleTeamId`; signed-app entitlements remain part of the build qualification.
Signing directly to a retained path proved unreliable on this host: both files
used as the signing CLI's output disappeared later, while separate byte copies
persisted. The final installable file and preserved `.bin` copy are copies of
the same successfully signed bytes, not signing-tool output paths. Validation
used another disposable copy. `manifest.json` identifies the final signature
above. The underlying cause of the output-file disappearance was not established.

Reproduce the focused checks with:

```sh
node --test scripts/test/ios-notification-shortcut.test.mjs
node scripts/test/ios-local-capture-shortcut-artifact.test.js
node scripts/build-ios-notification-shortcut.mjs /tmp/WafraNotifications.json
```

No full-repository, full-app-build or physical-capture pass is claimed here.
The existing app's installation URLs remain unchanged.

## Device and build boundary

`xcrun devicectl` found the paired iPhone 16 Pro and returned iOS **26.6.2**.
The user confirmed that only the iOS 26 iPhone is available. A real iOS 27
Notification trigger and its input conversion cannot be qualified on this phone.
No device update, installation, bank transaction or notification simulation was
performed.

The host has Xcode **26.1.1**, with approximately **3.7 GiB** available at the
initial check. The capture task's prior full build exhausted disk. No parallel
full build was started here. Host graph tests and Apple signing cannot establish
installed App Intent binding, background delivery, or financial correctness.

## Required release qualification

1. Build the app containing `CaptureWafraNotificationIntent`. Check actual
   extracted App Intent metadata, including the required scalar `text` parameter,
   background execution and authentication policy.
2. Install that exact app and the signed Shortcut on an iOS 27 iPhone. Enable
   Wafra capture, run the Shortcut without input while unlocked, and grant the
   requested permission. Verify setup proof without any queued financial record.
3. Add a Notification automation to the imported Shortcut, selecting one banking
   app. Configure immediate execution and permission to run while locked where
   available. Confirm the input variable remains connected.
4. Observe a naturally arriving bank alert with Wafra closed and the phone locked.
   Record the payload shape without logging financial content, then open Wafra
   and distinguish durable receipt from the final transaction/review outcome.
5. Verify one correct transaction; repeat delivery, SMS overlap, genuinely
   separate identical purchases, missing transaction details, and review-capacity
   cases. Rejected or unretained reviews must not be acknowledged as saved.
6. Reopen/restart and verify durable results. Publish the verified artifact and
   installation link only after the app, Shortcut and device evidence agree.

## Review history

These entries record successive review snapshots. Their open findings were
subsequently resolved as described in the final scoped review result above.

Read-only synthetic checks reproduced two issues in the concurrent capture
implementation: the same purchase delivered with two fresh observation UUIDs
posted twice, and admitting 51 unresolved review items retained only 50 while
reporting every item admitted. Both were sent to the owning task, which accepted
them as release blockers. Their resolution must be verified against its final
source; signing this Shortcut cannot resolve or qualify those behaviors.

Follow-up review of the interim fixes found two additional cases that were sent
back to the capture owner: a saved notification observation retried after SMS
healing and a user edit still reached fuzzy deduplication and added a second
transaction; and global non-evicting review admission was paired with retention
handling only for iOS notification callers. The final patch must bypass posting
for an already-saved observation and keep the capacity change consistent with
every affected caller (or scope it to this flow). These remain unverified in
this artifact record until the owning task completes its fixes and review.

A further mixed-source regression was reproduced after capacity protection was
limited to incoming notifications: a later SMS review evicted an already-retained
notification from a full tray (49 of the original 50 remained, no tombstone).
The owner was given the exact reproduction. Retention must protect existing
notification reviews across mixed-source admission before this path is qualified.

### Subsequent stable-patch review

The final focused five-file safety run completed **33 tests with zero failures**.
The original saved-UUID/edit retry and mixed-source quota/restore regressions now
pass. Read-only review still reproduced gaps outside those tests:

- SMS arrives first: a reconciled notification creates no new transaction, so
  its observation receipt was not stored. After ACK failure and a user edit,
  the same queued notification could add another transaction.
- Notification arrives first, then SMS heals the row: a new indistinguishable
  observation bypassed possible-replay review because the comparison excluded
  rows whose `viaPush` flag had been cleared, despite their retained receipt.
- Card-payment notification: its special planner branch omitted both the
  observation receipt and push flag, and the replay helper only handled ordinary
  transactions. After SMS healing and a user edit, replaying the same queued
  payment added another payment in a synthetic reproduction.

All three were reported to the owning task with reproducible inputs. These are
source review findings; the **33/33** result is not a complete monetary pass or
release approval. No source fixes were made by this artifact/review task.

The next boundary patch completed **36 focused tests with zero failures** and
resolved the previously-saved SMS, SMS-healed fresh UUID, retained/tombstoned
review retry and card-payment cases (card-payment notifications now enter Review
before accounting). One original case still reproduced: an SMS and matching
notification in the **same native page** both remained parsed because the guard
did not index the page's SMS. The saved result had no notification receipt;
failed ACK followed by a user correction and retry added another transaction.
The capture task received this exact remaining blocker and a request for both
mixed-page arrival-order regressions. The 36-test run is not a monetary sign-off.

After indexing earlier SMS outcomes, the focused replay file passed **12 tests**.
An independent actual-planner/reducer check of both orders showed SMS-first now
safe (`parsed/review`, one saved transaction, retry ignored), but notification-first
still produced two parsed outcomes and one saved row **without a receipt**. After
a user correction, retrying that notification added another transaction. This
remaining order-dependent case was reported with exact timestamps and outcomes;
final review must exercise both page orders through the real planner/reducer.
