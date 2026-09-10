# iOS history paging beta — implementation and actual test status

Date: 9 September 2026.

## Release status

A separate paging/resume candidate is implemented in the normal source tree.
Its native stores and generated App Intents compile against the installed iPhone
SDK. Targeted host tests pass. The exact Apple Messages query contract and the
complete signed Shortcut have **not** been exercised successfully on the iPhone.
This report is not evidence of a solved universal import, a measured phone import
time, or a completed Wafra app build.

The existing public History Import Shortcut was not replaced. No OTA, TestFlight
submission, Git commit/push, subscription purchase or billing change was made.
The installed phone was rechecked and still reports Wafra 1.0.0 build 55.

## Implementation

`WafraHistoryCursor.swift` works backwards using one strict date-before predicate.
It requests 51 records initially. A full page commits only records newer than its
oldest returned second and withholds the entire boundary second. The next query
must return the withheld identities and dates before the cursor can advance.
This avoids relying on fractional-second arithmetic in Shortcuts.

A short page must also contain the originally observed oldest-message anchor.
An empty, repeated, unsorted, out-of-range or discontinuous page fails rather than
being labelled completed history. These checks are guards against known query
failures, not a proof that Apple returned every indexed message in the middle of
the range. Physical provider validation remains mandatory.

`WafraPagedHistoryStore.swift` saves a protected page journal and its next cursor.
Reopening rolls a durable page forward if interruption occurred before the head
write. Identical delivery retries are idempotent. Authenticated resume rotates the
capability so a suspended earlier runner cannot keep writing.

Message records are transferred together in one scalar frame of newline-separated
Base64 JSON objects. The frame does not travel over a URL, network or clipboard.
Raw GUIDs are hashed before disk writes. Canonical accepted records are read by
the existing parser/review coordinator in chunks of at most 50. Source staging
uses owner-only permissions, iOS complete file protection and backup exclusion.
The host tests model protection metadata; they do not certify iPhone encryption.

The opt-in `history-paging-device` profile adds the Begin and Stage App Intents and
the hidden `ios-paging-beta` screen. The beta screen shows source-free saved counts,
starts/resumes the separate Shortcut, recovers completed staged history for review,
and supports explicit discard. Staged source is not yet a saved ledger transaction.
The user still confirms the existing transaction review before durable ledger save.

Normal profiles retain the original published Shortcut configuration. The bridge
and TypeScript loader also gained a native-authoritative paged descriptor branch;
legacy descriptors keep their existing limits and checks.

### Explicit beta limits

- Source/cursor resume expires after a fixed 24 hours. Purging occurs on store
  operations, not through a guaranteed background deletion timer.
- Staging is capped at 72 MiB and preserves earlier progress on capacity failure.
- A dense boundary grows the query from 51 to 102, 204 and 408. A still-saturated
  terminal second blocks visibly instead of discarding overflow.
- Oversized or invalid source fields can block the page. The app cannot recover
  deleted, unindexed or unavailable iCloud messages through these queries.
- The Shortcut has a 10,000-iteration safety budget; reaching it pauses rather than
  claiming completion. The JavaScript paged descriptor has a separate defensive
  one-million-record bound.
- Foreground/unlocked extraction is the test target. Background execution and
  continuous operation while locked are not certified.

These are bounded-resource safety limits, not grounds to advertise unlimited inbox
access or every iOS installation. The Messages search route requires iOS 26+.

## Verification actually completed

| Check | Result |
| --- | --- |
| New native paging/journal harness | 229 assertions passed |
| Existing native history host harness | 385 passed, 0 failed |
| Updated native bridge/source contract | 105 passed, 0 failed |
| New Shortcut graph and current JS loader tests | 15 passed, 0 failed |
| Existing published Shortcut artifact contract | Passed |
| TypeScript typecheck | Passed |
| Targeted ESLint | Passed |
| Ledger & Light design-baseline check | Passed |
| New native module and generated App Intent iPhone-SDK typecheck | Passed |
| Full Wafra binary / physical extraction | Not completed |

The native harness traverses 10,001 synthetic messages and checks each identity
exactly once, a final partial chunk, Unicode/multiline content, a fresh-instance
resume, lost acknowledgements, stale capabilities, wrong/truncated/repeated queries,
dense-second behavior, a crash between page and head writes, capacity and cleanup.
Many of the 229 assertions are per-chunk checks, not 229 separate scenarios.

The current JavaScript coordinator also loaded 10,001 synthetic canonical records
through 271 short chunks. It refused attempts to enlarge legacy limits through an
absent, false or malformed native paged flag. These are host tests with a simulated
provider, not an iPhone speed or coverage benchmark.

Reproduce the focused new tests:

```sh
bash scripts/test/ios-history-paging.sh
node --test scripts/test/ios-paging-shortcut.test.mjs scripts/test/ios-paging-loader.test.cjs
```

The loader test uses the current checked-in coordinator with the project's existing
compiled parser-test dependencies. It is not a replacement for the full app build.

## Build attempt and external gates

The no-VCS EAS source archive was inspected. Candidate source hashes matched the
archive, and excluded local/private directories contained zero files. Empty
excluded directories in build-inspect output are harmless.

EAS authenticated, selected the existing ad-hoc credentials, uploaded the 5.7 MiB
source archive, incremented remote build number 59 to 60, and created the private
`history-paging-device` update channel/branch. It then rejected the build because
the account had exhausted the monthly free iOS build allowance. No build job was
accepted and no new IPA was produced. The remote number/channel reservation is
not a successful build or a published OTA. Billing was not changed.

The Mac has approximately 2.4 GiB free and Xcode 26.1.1. Expo SDK 55 documents
Xcode 26.2+ as its supported build requirement. A full local app build was not
started under these conditions. Pure native code compilation succeeded but does
not substitute for an Expo/React Native archive and provisioning check.

Direct installation of the existing TestFlight-signed build 59 failed with the
Beta-profile entitlement error. The existing build 55 remained installed.
The paired phone later accepted ordinary app launches, but XCUITest startup failed
with LocalAuthentication code -2, "Authentication canceled." No permission was
bypassed and no new history run was observed. A failed USB-only provisioning
backend lookup is not evidence that the CoreDevice connection was unavailable.

Git status remained blocked by an index memory-mapping timeout. HEAD was inspected
without repairing the index or switching away from existing work. No independent
review agent was available through the connector. These limitations remain part of
the candidate's verification status.

## A phone test that does not require another Wafra build

`scripts/build-ios-history-query-probe.mjs` generates **Wafra History Query Check**.
It uses only Apple actions and runs five queries capped at five messages each.
The final alert displays counts only: an unfiltered baseline and before-1900 /
after-2100 filters in two variable-binding representations. It does not extract
message bodies, senders or identifiers for output, upload source, or change the
Wafra ledger. It is a diagnostic, not a history importer.

Signed artifact:
`builds/ios-history-paging-20260909/Wafra-History-Query-Check.shortcut`

Bytes: 24,717. SHA-256:
`fd1956d83f25267da520f3f0e0cd7e9f5d80d46406851b1425765438802721e6`

The distributed conversation attachment was reconstructed from these exact bytes
and hash-checked. A successful basic probe should show a nonzero baseline for a
nonempty readable inbox and zero for the impossible historical/future ranges.
A zero baseline is inconclusive. A successful probe is necessary information,
not proof of exhaustive paging. Record the displayed counts or exact Apple error
before attempting the complete candidate on a matching installed app.

The separately signed **Wafra History Paging Beta** artifact exists in the same
directory but requires the new app's App Intents. Do not run it as though installed
build 55 already contains those intents, and do not put its link in production.

Evidence logs and source hashes are in `builds/ios-history-paging-20260909/`.
Raw build logs may include device/provisioning metadata and are not a public
support attachment. No real SMS content was copied into the report or logs.

Primary platform references:
- https://docs.expo.dev/versions/v55.0.0/
- https://docs.expo.dev/build-reference/local-builds/
- https://support.apple.com/en-us/125148
