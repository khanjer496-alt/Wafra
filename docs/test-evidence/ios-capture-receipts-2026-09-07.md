# iOS capture receipts and setup status — 7 September 2026

Work branch: `work/ios-guided-onboarding`, PR #24.
Runtime implementation revision: `88af191e6833f233090be3897c803de268615744`.
Validated input revision: `bf3961f031e216a1ce25867803b9477f5fd54d5c` plus its deterministic, hash-checked source edits.
Validation run: https://github.com/khanjer496-alt/Wafra/actions/runs/34065481826

## Implemented

Missing, non-numeric, non-finite or invalid first-capture timestamps no longer qualify as evidence of a real financial alert. The same predicate is used by setup, automatic-capture status and legacy relay-retirement checks. In particular, an omitted native field cannot satisfy a `!== null` test anymore.

The real native queue now stores two optional diagnostic receipts:

- `lastReceivedAt`: local time when a new message and its queue manifest are saved. Duplicate retries, refused input, disabled capture and capacity refusal do not advance it.
- `lastHandledAt`: local time of actual verified queue acknowledgement. Empty/unknown acknowledgements and failed source deletion do not fabricate processing.

Queue handling includes duplicates and non-financial messages; it is NOT a last-transaction timestamp. The first qualifying financial alert remains separate. The bridge returns milliseconds; native storage uses seconds.

The setup screen now has a collapsed English/Arabic Capture status panel. It can display pending counts, queue warnings, receipt dates and paused/off/unknown states. An empty queue explicitly does not prove every bank alert arrived. Old binaries without the new receipt fields show unknown dates. The existing status controller supplies these facts; no second polling loop was added.

Diagnostic projection is allowlisted: message bodies, senders, event identifiers, credentials and arbitrary native properties are not included. New manifest fields are additive; missing or malformed diagnostic metadata does not invalidate existing queued events. Encryption/file-protection policy, raw-message retention, capture consent, entitlements and parser/money rules are unchanged.

## Completed checks

- Application and server TypeScript checks: passed.
- Repository lint: passed.
- Setup/recovery checks: 229 passed, 0 failed.
- Journey/health/controller/component checks: 27 passed, 0 failed. These include the earlier synthetic history-traversal checks; they are not 27 real-device SMS tests.
- Existing application regression command: 71 app suites and 3 server suites passed; native Swift suites were not run by the Linux command and are reported separately below.
- Real Swift module bridge: 53 passed, 0 failed, with explicit Expo/store boundary stubs.
- Actual Swift queue against synthetic filesystem records in an iOS 26.2 simulator: 23 passed, 0 failed. No storage stub or weaker production-protection mode was used.

Native tests cover new receipt persistence, idempotent replay, disabled/invalid admission, empty/unknown acknowledgement, injected deletion failure, successful processing, old-manifest migration, malformed new metadata, source-free status and cleanup. They do not simulate real bank-message delivery or a physically locked phone.

Existing tests were updated to require the new optional status fields and validated timestamps. Documentation comments are ignored when comparing the exact TypeScript interface; no interface members or existing checks were removed. The original full regression command remained a gate. Earlier unsuccessful validation attempts are not counted as passing runs.

The one-use edit transport is removed from the resulting normal source tree. It verified original file hashes, checked the remote branch had not moved and pushed without force only after the application and native jobs passed.

## Unchanged or still pending

No new TestFlight binary was built or distributed in this continuation; the existing public beta was not modified. The new native receipts require a subsequent iOS build before they appear on a phone. The published Shortcuts and their action parameters were not replaced.

This is capture instrumentation and readiness hardening, not a claim of faster end-to-end imports, improved parser recognition or guaranteed capture of every purchase. Messages still use the existing native queue and foreground processing path.

The larger-history coordinator remains unwired to an Apple extraction provider. The published history Shortcut still has its 2,999-retained-message coverage bound; no 30-day limit or mandatory bank picker was introduced. Physical iPhone automation, locked/force-quit/reboot behavior, real-inbox accuracy/speed and rendered native onboarding remain acceptance tasks. Unrelated browser-navigation failures were not repaired or waived by this change.
