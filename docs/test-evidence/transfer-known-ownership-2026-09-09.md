# Cross-message account ownership — 9 September 2026

## Behaviour

Parser version 39 separates account ownership from pairing two observations of
one transfer. A completed transfer with a known source and an explicitly named,
bank-scoped destination can be classified from independently captured activity
on that destination. A matching incoming receipt is not required for ownership.
Incoming transfers explicitly naming another independently observed own bank
account use the same rule. The full retained history is considered, irrespective
of display period or message order.

Ownership is derived from source capture metadata, not from editable Wallet
names, a beneficiary mention, a globally unique last-four suffix, matching
amounts, or the algorithm's earlier guesses. Account IDs, bank, instrument kind,
and captured ending must agree. Duplicate identities, conflicting banks, missing
issuers, unknown source attribution, edited observations, and malformed evidence
cannot establish ownership. A bank-side payment naming a beneficiary credit
card does not by itself establish that the card belongs to the user.

The derived assessment can identify an owned account without a transaction
counterpart. It does not invent a reciprocal link, a destination credit, a user
decision, or a balance adjustment. Existing amount/currency/reference and
mutual-uniqueness rules still govern receipt pairing. Ambiguous receipts remain
unpaired even when ownership of the outgoing destination is already known.

A completed debit to an independently identified own credit card is classified
as a repayment, not new spending. Without a linked receipt, its bank debit
appears in cash used for card payments; it does not manufacture a card posting
or silently settle a statement. When the existing receipt-matching rules find
the counterpart, cash reporting uses that canonical receipt and the original
bank debit date instead of counting the debit a second time.

The review screen explains both new classifications in English and Arabic.
The user can override an unpaired automatic classification. Explicit user
decisions continue to win and survive restore/recheck. Deleting or correcting
the supporting source observations invalidates derived ownership rather than
leaving a permanent guessed rule. No new raw SMS retention or backup schema is
introduced.

## Verification

- Application and server TypeScript checks, lint, and Ledger & Light guard.
- 606 repair, workflow, iOS-journey, and onboarding-action tests, with no failed
  or skipped tests. These include the new independent-ownership suite and
  bilingual review-screen correction tests.
- All 71 existing application suites, plus the universal parser/evidence and
  numeric-input supplemental entrypoints.
- Owner-supplied full-history replay: all 22 checks pass, including repeat
  import, restore, original-money protection, manual-edit preservation, explicit
  ownership decisions, and fresh-ledger repeatability.
- Additional read-only probes with matching receipts removed from cloned
  real-history transfers retain ownership from other bank SMS without inventing
  counterparts or changing recorded observations.
- A 12,000-transfer synthetic check exercises indexed ownership inference.
  This is a desktop regression bound, not a physical Android speed measurement.

The complete owner snapshot's pending count is unchanged: its identifiable
explicit own-account transfers already had receipts and were paired by v38.
The new rule handles the missing-receipt case; it does not turn the remaining
masked or unidentified destinations into confident guesses.

Private messages, account identifiers, financial totals, and replay states are
not committed. Local evidence is stored outside the shipping checkout under the
ignored `builds/resume-20260908/ownership-20260909/` directory. Replay can be run
with owner-authorized local input:

```sh
bash scripts/test/build.sh
TZ=Asia/Dubai node scripts/audit-transfer-corpus.cjs \
  /path/to/owner-personal-review.json /path/to/private-report.json
```

## Release boundary

This change is based on main `917793e` in the recovered main-line checkout.
The old top-level checkout has an unreadable Git index and unrelated work; it
was not reset, overwritten, or used as a shipping source.

The local validation above does not constitute a full browser run, native
storage build, physical-phone test, APK installation, or TestFlight release.
Exact-commit GitHub CI and installer status must be checked separately.
Independent worker review was unavailable because the connector returned
`WORKER_IDENTITY_LOST`; no independent approval is claimed.
