# Matched beta integration — 9 September 2026

## Integrated source

The reviewed main-line checkout started at `ca14f20`, including parser v39,
cross-message account ownership, protected capture, and the future-first
new-user setup flow. The iOS date investigation started at `130b3bb` and had
not been committed. Its main history generator was unchanged between those
base revisions, so the reviewed date patch was integrated without replacing
newer parser, ledger, onboarding, or UI code.

This integration includes the corrected Date-field serialization, accepted
duration unit identifiers, bounded count-only diagnostics and their regression
tests. It does not include or enable the experimental unbounded fast-history
query or the separate native paging prototype.

The default published history graph remains byte-identical to the previously
audited production graph. The Date-field correction affects the dated smoke
graph and adaptive experiment; merging that correction does not silently
replace the published iCloud Shortcut or remove the production history limits.

## Verification before publication

- 613 repair, workflow, iOS-journey and onboarding-action tests passed, with no
  failures or skips, using the combined source.
- The focused iOS-journey run passed all 39 tests.
- The production Shortcut artifact checker passed; regression tests check its
  exact pre-integration graph hash.
- Application/server TypeScript checks and lint passed.
- Ledger & Light design guard, history-beta build configuration and OTA
  configuration checks passed.
- Base parser v39 commit `ca14f20` had successful GitHub check and browser jobs.
  Combined-commit GitHub CI remains a separate result to verify after pushing.

The owner's previously successful physical Date Filter Check v2 is recorded in
`ios-history-date-binding-2026-09-09.md`: a valid future boundary, Future=0,
and three results for the before-future query. This was a bounded query test,
not an end-to-end bank-history import.

At this integration check, the paired iPhone still reported Wafra build 55 and
required its passcode. Its previous LAN UI runner did not respond. No lock was
bypassed, application data erased, or physical-import success inferred.

An independent worker could not be started because the connector returned
`WORKER_IDENTITY_LOST`. No independent approval is claimed.

## Build and acceptance boundary

Use the canonical Android and iOS GitHub workflows on the same integrated
main-line source. Use the GitHub macOS iOS route with the existing history-beta
profile rather than another EAS-hosted build: the earlier hosted attempt hit
the account allowance. No subscription or billing configuration is changed.

Keep Android full-inbox corpus export and experimental notification capture
disabled. Record each workflow's actual source commit and artifact metadata;
different Android/iOS build numbers do not mean different source revisions.
Build creation, successful compilation, TestFlight upload, Apple processing,
tester-group availability, device installation and physical acceptance are
separate states and must not be reported interchangeably.

The current onboarding supports future capture first and explicit history
deferral. It must not display deferred history as completed. The current
published history importer may refuse large retained inboxes whose two capped
ends do not overlap. This beta must not be advertised as a universally complete
or unlimited iOS history importer.

Still required for that claim: distinct older-page and combined-window checks,
same-timestamp boundaries, interruption/resume, source-to-ledger fidelity and
repeat-import deduplication on the exact installed candidate. Real future SMS
delivery while locked/offline and after restart also remains a physical-device
acceptance gate. Do not promote an external real-user beta based on compilation
or the count-only date diagnostic alone.

Local source-free check logs are in the ignored sibling directory
`builds/resume-20260908/matched-beta-20260909/`. The older top-level checkout,
its unreadable Git index and unrelated unfinished work were left untouched.
