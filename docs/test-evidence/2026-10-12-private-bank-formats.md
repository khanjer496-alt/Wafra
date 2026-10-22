# Personal bank formats — 12 October 2026

Wafra now has a local **Import bank activity → Teach a bank format** flow
for iOS and Android. It addresses missing bank layouts without requiring a
public SMS corpus or an eligible on-device language model. This implementation
does not establish bank-wide or worldwide automatic parsing coverage.

## Delivered behavior

1. Paste one complete alert and its exact sender when available. Select an
   exact principal amount and whether money left or entered the account.
   Payee and a full-year transaction date are optional exact source fields.
2. The first sample creates an ephemeral draft. Paste a different received
   alert with the same layout; inspect the newly extracted values.
3. Explicitly confirm the second alert to save the format. A repeated first
   alert does not qualify. Failed durable writes preserve a retryable preview.
4. Matching alerts may fill missing fields in eligible Review entries during
   Android SMS/notification scanning, iOS live capture and Messages History.
   Review confirmation remains necessary for these proposals. Existing parsed
   rows and the UAE/Saudi launch routes retain their current handling.
5. **Forget this format** removes the format durably; a failed removal restores
   the prior row and permits retry. Different layouts need separate teaching.

The feature does not call an LLM or a cloud service and works in Private Mode.
The web screen permits source inspection and amount selection, but saving is
disabled because its secure device-key implementation is native-only.

## Privacy and monetary boundaries

The encrypted local state retains bounded typed slots, public currency
metadata and HMAC digests for fixed wording, sender, sample identity and
authenticated state. It contains no raw sample, literal anchor/sender text,
merchant, transaction amount/date or secret key. The 32-byte key uses native
SecureStore with `WHEN_UNLOCKED_THIS_DEVICE_ONLY`. Formats are omitted from
exports and dropped on restore. Erase deletes the key; missing-key capture
readers do not silently create a replacement.

Leaving, backgrounding or unmounting the teaching screen clears samples and
unsaved previews. Deferred SecureStore work cannot retain/read a canceled
sample through the screen's source accessors. Matching sessions are generation
bound and invalidated during restore, erase and relevant preference changes.

Whole-message matching preserves fixed status/direction wording. Balance,
limit, minimum-due, statement, OTP, pending, declined, future and profile-owner
fields cannot be taught as a payment. Isolated completed fees are supported.
Ambiguous currency/principal or unsupported number conventions abstain. Absent
years, merchant names and instrument identity are not invented. Learned
matches have no posting outcome and cannot override known source facts.

## Local checks at the earlier feature checkpoint

- Production core: 41 cases; source-contract/context ownership: 10; teaching
  choices: 4; capture integration: 44; Android headless lifecycle: 11.
- Secure-key/store lifecycle: 16 cases, including failed-save/forget rollback,
  preference-write races and restore/erase generation ownership.
- Real screen/core/runtime host workflow: 18 cases across iOS and Android
  presentation modes, Arabic, Private Mode, two-alert save, forget, retry,
  canceled secure-storage work and source clearing. Native APIs are test
  adapters; these are not physical-phone keychain or presentation results.
- The normal universal runner includes the new production suites. Existing
  UAE/Saudi, AI-source, money, non-posting and captured-event guards remain
  exercised rather than bypassed.
- App/server typecheck, normal source build and changed-source ESLint pass.
  English light/dark and Arabic exported-screen browser checks are recorded
  separately in the safe verification manifest.
- All eight older journey/backup harnesses affected by the new imports were
  rerun against real production dependencies: 61 cases pass. The broader gate
  reported generated iOS intent/localization and website legal-copy failures
  at that checkpoint. The current candidate results and remaining launch gates
  are tracked in [the final candidate evidence](2026-10-12-parser-launch-candidate.md).

Independent read-only review and exact source hashes are saved in
`artifacts/datasets/research/private-format-build/independent-review.safe.json`.
The focused review passes 233 cases; its final screen recheck passes 18. A
separate loader review passes 64 cases with no native/key reads from unready
sessions. The final command results and presentation evidence are in the same
directory. The broader gate was fully attempted through suffix continuations:
the 28 missing-dependency failures were resolved by the 61-case rerun; 13
existing assertions were still failing across generated iOS setup/localization
and website legal-copy tests at that checkpoint. Those are historical results;
see the candidate evidence above for subsequent fixes and current gates. No
single clean green full run was claimed at that checkpoint.

## Remaining qualification

The accepted replay layouts and generated variants show bounded format
learning, not accuracy on unseen banks. Validate with actual consenting users'
distinct received alerts before claiming a bank's coverage. The native key
read/save/erase lifecycle, keyboard/accessibility and capture-to-Review flow
still need physical iPhone and Android validation. No release build, publishing,
commit, push or deployment is implied by these local checks.
