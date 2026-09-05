# iOS local capture implementation handoff

**Recorded:** 2026-08-26 (Asia/Dubai)
**Status:** implementation and exact public artifact verified; real locked-phone
bank-alert capture remains a physical TestFlight gate
**Branch:** `codex/universal-parser-adversarial-tests`
**Base commit:** `114dc63bf0d7b464f6d5fac351b305e3d0b0aa5e`

This record is deliberately source-free. It contains no Message text, sender
label, account/card data, token, signing material, private device identifier,
or invented Apple result.

## 2026-09-04 sender-scope correction

The earlier implementation notes below describing **Any Sender** with an empty
**Message Contains** field are superseded as setup guidance. On a physical iOS
26.6.1 phone, that configuration did not enable **Next**. Apple requires an
explicitly selected sender or phrase. Wafra's future automatic capture is
therefore limited to bank senders the user selects; history import and manual
entry remain available. This correction does not qualify the future-capture
path: the locked-phone selected-sender bank-alert observation remains required.

## Verified implementation

- Task 1 canonical sender registry: complete in code and fixtures. Production
  aliases remain empty until exact masked physical evidence exists.
- Task 2 protected native queue: complete. Admission is disabled by default;
  records are bounded, protected, and backup-excluded. Pending records
  logically expire after 30 days and their physical files are removed the next
  time capture runs or Wafra accesses the queue. Expiry deletion is retryable
  across deletion failure or a crash between file and manifest updates.
  Records are acknowledged only after durable app storage.
- Task 3 Expo module and background App Intents: source and simulator build
  verification complete, including English/Arabic intent resources.
- Task 4 local parser/drain coordinator: complete with forced-market,
  durability, review, decline, deduplication, and milestone coverage.
- Task 5 scoped relay retirement: complete locally. The implementation retires
  only legacy Shortcut ingest and preserves email, PDF, CSV, sync, trusted
  devices, queued rows, and wake-only push behavior.
- Task 6 lifecycle integration: complete, including shared drains and
  retirement retries, paywall-independent bounded warning recovery with an
  opaque compare-and-clear native warning ID,
  in-flight opt-out/Private Mode fencing, hydration/status races, erase
  ordering, and English/Arabic migration disclosure. A source-free native
  lease enforces the exact local-trial/store entitlement deadline even while
  Wafra is closed; consent remains separate so a verified renewal resumes the
  existing automation. Pending-only queues remain visibly recoverable after
  entitlement expiry without enabling new admission.
- Task 7 setup: the relay-backed wizard was replaced with two stages. Its
  earlier Any Sender instructions are superseded by the sender-scope correction
  above; setup now requires a selected bank sender. Manual and history routes
  remain available.
- The setup protocol rejects known retired Shortcut IDs and accepts only the
  exact public iCloud URL shape. The current beta profile uses the distinct
  public **Wafra Local Capture** URL
  `https://www.icloud.com/shortcuts/96f93402213144e8885db33f48fc6168`.

## 2026-09-02 public artifact gate

The downloadable unsigned graph behind the URL above matches the generated
**Wafra Local Capture** graph exactly after removing only Apple's share-time
Watch surface and restoring the public record name. Apple's record reports
`signingStatus: APPROVED`. The graph has a no-input local setup-proof branch and
a Received Message branch that extracts Sender, Body, GUID and Date, hashes the
GUID, and calls `StageWafraLiveMessageIntent`. It contains no network, relay,
Files, clipboard, logging, notification, analytics or source-output action.

This artifact result proves what will be installed; it does not replace the
remaining physical trigger test. Before calling future capture qualified, a
TestFlight user must create the Apple personal Message automation and observe
one real bank alert while the phone is locked, followed by Wafra draining and
parsing the protected queue on its next foreground.

Wafra 1.0.0 build 45 embeds this exact URL and Apple reports the uploaded build
as `VALID`. At the user's explicit request on 2026-09-03 it was assigned to the
internal **Team (Expo)** and external **Beta** groups; Apple reports both states
as `IN_BETA_TESTING`. The real bank-alert trigger gate above remains outstanding
and the public availability is not recorded as proof of that behavior.

Independent read-only reviews for Tasks 1–7 are recorded in the task reports
under `.superpowers/sdd/2026-08-25-ios-local-capture/`. The final Task 6,
Task 7, and lifecycle re-reviews reported no remaining findings.

## Verification results

The following commands completed successfully in the final worktree:

- `npm test`: 61 app suites, 3 server suites, and 2 native Swift suites.
- Native history store: 18 passed, 0 failed.
- Native live-capture store: 123 passed, 0 failed.
- Native live-capture bridge: 49 passed, 0 failed.
- Native App Intent resources: 57 passed, 0 failed.
- Bank-alert semantic matrix: 985 passed, 0 failed; the complete parser run
  reported 3,487 passed, 0 failed across 1,144 mutated alerts.
- iOS capture/setup: 330 passed, 0 failed.
- Two-stage iOS setup UX: 37 passed, 0 failed.
- Onboarding: 60 passed, 0 failed.
- Contracts: 279 passed, 0 failed.
- Relay/capture: 268 passed, 0 failed.
- Encrypted database/store: 166 passed, 0 failed.
- Route and drawn-confirmation UI contracts: 48 passed, 0 failed.
- Worker: 336 passed, 0 failed.
- Android review capture: 34 passed, 0 failed.
- History import: 21 passed, 0 failed.
- Review-alerts UI: 15 passed, 0 failed.
- Root and server TypeScript: clean.
- Repository-wide ESLint: clean.
- Store metadata and store pricing checks: clean; live pricing remains blocked
  pending its separate commercial approval.
- Server install, typecheck, tests, Worker gate, and Wrangler dry-run build:
  clean. The Wrangler command used `--dry-run`; nothing was deployed.
- `git diff --check`: clean.

`npm run check` completed successfully on 2026-08-26, including Expo Doctor
20/20, both TypeScript projects, ESLint, all app/server/native suites, store
checks, and the Worker dry-run. SDK 55 patch alignment and the pinned build
toolchain landed separately in commit `72ed83e`; the package/config changes in
this feature add the reviewed native capture and OTA dependencies only.

The repository's existing `ios-shortcut-artifact.test.js` also exits 0, but it
validates the legacy `Wafra Capture` HTTP/POST graph. It is not evidence for
Task 8: the required `Wafra Local Capture` graph must reject every network,
Files, clipboard, logging, notification, analytics, credential, and source-data
output action.

## Remaining physical gates

`xcrun xctrace list devices` found this Mac and simulators only. No physical
iPhone was connected. Consequently none of the following is claimed:

1. A selected bank sender can be represented by the Apple Message trigger on
   the target iPhone.
2. The automation preserves complete Received Message input and exposes the
   actual sender to the local App Intent.
3. Run Immediately executes while Wafra is closed and the phone is locked.
4. A real future bank alert produces the correct local ledger row.
5. An unrelated personal message creates no staged row or network request.
6. Force-quit, reboot/first-unlock, dual-SIM, offline, low-storage, Arabic/RTL,
   shortcode, and queue-capacity cases pass on a physical device.
The exact published artifact and action-graph checks are now complete as
recorded above. Items 1–6 remain physical-device evidence requirements; in
particular, no real locked-phone bank alert has yet qualified the complete
future-capture path.

## TestFlight setup/evidence beta

At the user's explicit request on 2026-08-26, the current worktree was built
locally with the EAS `capture-beta` store profile after the account's cloud iOS
build quota was exhausted. The resulting signed artifact is Wafra 1.0.0 build
38 for `app.wafra.ios`; its SHA-256 is
`0b43a1788267771c9e26e6cd944f781862b54de9c110a3fa66456243f03d68d9`.
The signed app contains both local-capture App Intent symbols and the English
and Arabic intent resources.

EAS submission `be617fdd-eca1-4246-bd9f-2600c4dbd6b5` finished successfully
for App Store Connect app `6799171482`. Apple reports build 38 as `VALID` and
`IN_BETA_TESTING` for both internal and external TestFlight users. On 2026-08-26
the build was assigned to the external `Beta` group, its accurate beta app
description, per-build test notes, and review notes were saved, and Apple
returned Beta App Review state `APPROVED`. The enabled public link is
`https://testflight.apple.com/join/jbwzCgZ6`; a direct HTTP check returned 200.

This is an evidence/setup beta, not a qualified capture release: the production
sender registry remains empty, so real alerts are intentionally ignored until
the physical tester supplies an exact sender label that can be admitted with
source-free evidence. The public notes disclose that limitation. The beta can
verify App Intent discovery, setup proof, and the Apple Message-automation UI.

## Release handoff

The combined release plan at
`docs/superpowers/plans/2026-08-25-ios-shortcuts-release.md` must not start until
the physical gates above and the separate history-import feature handoff are
complete. That plan is the sole owner of:

- admitting evidence-backed production sender aliases;
- qualifying and publishing both exact iCloud Shortcuts;
- applying the additive D1 migration and deploying the Worker;
- replacing shared EAS, legal/store, and landing-page values;
- building and submitting the one combined iOS/TestFlight release.

No commit, stage, push, production database mutation, Worker/Pages deployment,
or iCloud Shortcut publication was performed. The local store build, App Store
Connect upload, and internal/external TestFlight distribution described above
are the only release-side mutations performed.

## Uncommitted task records

- `.superpowers/sdd/2026-08-25-ios-local-capture/progress.md`
- `.superpowers/sdd/2026-08-25-ios-local-capture/task-1-report.md`
- `.superpowers/sdd/2026-08-25-ios-local-capture/task-2-report.md`
- `.superpowers/sdd/2026-08-25-ios-local-capture/task-3-report.md`
- `.superpowers/sdd/2026-08-25-ios-local-capture/task-3-appintents-build-fix-report.md`
- `.superpowers/sdd/2026-08-25-ios-local-capture/task-4-report.md`
- `.superpowers/sdd/2026-08-25-ios-local-capture/task-5-report.md`
- `.superpowers/sdd/2026-08-25-ios-local-capture/task-6-report.md`
- `.superpowers/sdd/2026-08-25-ios-local-capture/task-7-report.md`

Commit/push steps remain skipped because repository publication was not
separately authorized for this worktree.
