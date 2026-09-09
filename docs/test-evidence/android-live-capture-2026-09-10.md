# Android capture and transaction clarity — 10 September 2026

## Implementation

- Recognize completed ENBD `Payment of … to … with Credit Card ending …`
  notification previews. Extract the merchant without including card wording.
- A separate promotional paragraph no longer suppresses a structurally proven
  FAB card-purchase preview. OTP, decline, failure, reversal and future-charge
  checks still inspect the complete message before any footer trimming.
- Observe SMS-provider changes while the eligible Android app is active.
  Events contain no body, sender, amount, identifier or other bank data. The
  existing permission-gated reader, single-flight executor and durable ledger
  remain the only capture path. Release observation on opt-out and unmount.
- Coalesce provider bursts. A change during another read earns a follow-up;
  returning to Android checks recent messages without the former 30-second
  suppression. Successful manual joins report completion without scanning twice.
- Parser upgrades initially read one newest inbox page, then transfer the saved
  cursor and its rows atomically to the existing resumable history coordinator.
  Only reaching the end of history stamps parser completion. Missing provider
  results and incomplete pages without a cursor continue to fail closed.
- An empty incremental import does not rebuild full-history duplicate indexes.
- Parser version 40 repairs source-proven wrong-issuer fallback assignments.
  Unidentified new payments are not attached to the first saved credit card.
  Preserve user corrections and previously evidenced instruments. The unresolved
  account reference remains countable money, not an invented bank balance.
- Transfer history/corrections belongs under Accounts rather than Settings.
  Existing automatic own-account, external-evidence and card-repayment rules
  remain unchanged. “Outward” alone is not proof of external ownership.
- A single ordinary transaction displays its amount once. Keep differing
  exclusion/split totals and useful labelled multi-entry day subtotals.

## Verification before native build

- App/server TypeScript and full repository ESLint passed.
- 639 repair, workflow and iOS-journey tests passed.
- All 71 original JavaScript suites were executed. The four initial failures
  were resolved and rerun: contracts (289), import planning (267), parser
  (1,049) and iOS capture setup (390) assertions passed.
- Native preview regex/corpus: 39 assertions passed, with 111 of 118 transaction
  fixtures recognized. This is fixture coverage, not universal bank coverage.
- Actual JVM pattern compilation and engine tests: 29 assertions passed.
- Local synthetic browser transaction, 44-screen light/dark audit, English/
  Arabic Home and transfer-review flows passed. No personal ledger was uploaded
  by those browser tests.
- A private backup simulation of the reproduced wrong-issuer assignments kept
  every transaction identity, amount and date and exactly preserved period
  spending. Backup, bank text and the numerical report remain outside Git.

## Boundaries

Native purchase previews can run without a JavaScript ledger session. Ledger
capture runs while the app is active and catches up on return; this change does
not add another background database writer or plaintext SMS archive.

This is not a bulk duplicate cleanup. No historical look-alike transaction is
deleted merely for sharing a merchant, amount or date. Installed-device checks
and APK signature verification are separate release evidence; browser fixtures
must not be represented as real SMS-delivery measurements.
