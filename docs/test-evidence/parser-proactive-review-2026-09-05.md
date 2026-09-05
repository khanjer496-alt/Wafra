# Proactive parser review — 5 September 2026

## Scope and current result

This pass follows the user's request to find merchant, statement, due-date,
subscription and utility failures before users report them. It preserves the
previous account-identity and duplicate-reconciliation fixes. No new country or
bank was enabled for automatic importing, and no source messages were uploaded.

Parser version is 31. Existing redacted specimens and explicitly synthetic
boundary controls exposed and now cover the following failures:

| Area | Before | Corrected behavior |
| --- | --- | --- |
| Seller | An account-reference footer could replace Starbucks with “Your Account” | Bank nouns in a footer cannot become the seller |
| Categories | SEWA/Homeinet could override the user's pinned Other category | The user's correction survives parsing and interpretation |
| Utilities | Unknown reference payees or water parks became utilities | Unknown stays Other; the existing water-park entertainment rule is reachable |
| Bill identity | Prose produced identities such as customer:VICE | A usable identifier needs numeric evidence; prose is not account identity |
| Statements | Abbreviated Total Amt Due / Min Amt Due were missed, so minimum could become total | Explicit total and minimum fields remain separate regardless of their order |
| Deadline | A generation date could replace an explicit payment deadline | Explicit deadline grammar wins, including Arabic numeric dates |
| Unknown deadline | Receipt time supplied a missing/invalid/yearless statement deadline | Android, local iOS and historical wrappers preserve null; no dated card obligation is invented |
| Money | Partial regex matches truncated malformed local amounts or fell through to fees | Complete local-money tokens are checked before automatic interpretation |
| Balance | Malformed balance punctuation contaminated otherwise valid purchases | The balance stays unknown while the valid purchase survives |
| Parking | A first numeric safeguard rejected a valid fee because ancillary VAT had three decimals | The real parking receipt retains its separately stated two-decimal fee |
| Utility payment | One receipt could settle two distinct utility accounts | Explicit account conflicts block matching; one receipt cannot satisfy competing strong claims |
| Arabic bills | ASCII normalization prevented real matching; a first Unicode change then matched generic “bill” words | Unicode titles work, and generic Arabic service words do not identify providers |
| Legacy bills | A weak no-identity claim prevented a valid explicit-account match | Explicit identity evidence outranks weak title evidence |
| Subscriptions | Ordinary repeated shopping, health and entertainment purchases became cancellable services | These remain visible recurring commitments unless known service evidence applies |
| Renewals | Adding 30/365 days drifted monthly/yearly renewal dates | Calendar progression handles month ends and retains leap-day evidence |

The amount guard does not invent a comma-decimal interpretation or round excess
local precision. It checks AED/SAR-style tokens only. Three-decimal foreign
money and broader locale policy remain separate work.

## Verification

Tests were added and observed failing before their respective fixes. Review
caught the parking-VAT regression, Arabic generic-word matching, strong/weak
bill-identity priority, and the leap-year history edge case before completion.

Final core verification against a frozen private copy of the compiled modules:

| Suite | Passed | Failed |
| --- | ---: | ---: |
| Parser | 966 | 0 |
| Bank corpus | 1,338 | 0 |
| Invariants | 32 | 0 |
| Bank-alert interpreter | 70 | 0 |
| Import plan | 216 | 0 |
| Accounting pipeline | 46 | 0 |
| Bills | 44 | 0 |
| Unit / recurring payments | 763 | 0 |

Build, root/server typecheck, scoped ESLint, and diff-check passed. Independent
final reviewers additionally passed 9 numeric-policy probes and 8 bill/calendar
probes, with no blocking finding left in those reviewed scopes.

A wider private-build attempt ran all 66 JavaScript suite entry points, but is
not an authoritative combined gate: the relocated Worker/relay modules could
not resolve `@noble/ciphers`, and Android capture mocks assumed the original
build-directory path. The integration task owns the real combined suite and
native/app builds against the frozen repository. No full-suite or native-build
success is claimed by this report.

The original unchanged 799-message invariant input set still has 91 unresolved
category results. Added adversarial controls change the aggregate denominator;
the resulting aggregate percentage is not a field-accuracy or bank-coverage
percentage.

## Next requirements for broad reliable parsing

1. **Represent incomplete statements honestly.** Minimum-only summaries still
   use the legacy minimum-as-total model. This is unresolved. Introduce separate
   optional total, minimum and deadline facts; distinguish “minimum satisfied”
   from “statement settled.” The UI, allocations, reminders, relay contract and
   backup validation must support unknown totals together. Do not substitute
   zero, the minimum, or the credit limit for an absent total. The integration
   task is reviewing the smallest conservative interim refusal; the existing
   fallback is `statementTotalFils` in `src/lib/sms-parser.ts`, with minimum-only
   acceptance specimens in `scripts/test/parser.test.js` around lines 3743 and
   4592. Full total/minimum specimens around lines 4941 and 4944 must stay valid.
2. **Keep date completeness.** A day/month without a year is partial evidence.
   Any future inference needs a stated reference date, bounded rules and a
   visible estimated status. Message-receipt time is not a payment deadline.
3. **Separate extraction from financial meaning.** Normalize locale and money,
   extract source facts, classify event meaning, then reconcile the ledger.
   Merchant guesses must not rewrite amounts, posting state or instrument
   identity. Recurrence is a ledger inference, not proof of a subscription.
4. **Measure each field and market independently.** Track exact amount,
   currency, direction, seller, institution/instrument, total, minimum and due
   date; count false postings, missed supported events and explicit review
   separately. Public/repository redacted specimens and synthetic probes must
   remain distinct evidence classes.
5. **Run proactive mutation and lifecycle tests for every supported family.**
   Cover changed whitespace, Arabic digits, field order, merchant words that
   resemble status, malformed amounts, conflicting identifiers, invalid dates,
   month/year rollover, both capture orders, refunds and repeated payments.
   Verify through materialization, reconciliation, persistence and reload.
6. **Expand automatic bank coverage only with evidence.** The existing global
   inspection/review infrastructure is not worldwide automatic-import proof.
   Add independently sourced, redacted acceptance examples per institution,
   language and event family before enabling an additional automatic path.
7. **Treat capture completeness separately.** Perfect extraction cannot recover
   messages the device never supplies or infer balances from partial history.
   Account freshness, attribution and unknown balance state still matter.

The repeated-terminal-punctuation tolerance in the lexical guard remains a
bounded limitation; this pass does not claim exhaustive numeric-format support.

## Repository coordination

Another active Wafra integration task was discovered during final verification.
All source edits and shared rebuilds were frozen immediately and exact path
ownership was sent to that task. Coordination is now agreed: this task may
write only this new report and perform read-only review; the integration task
owns all future source edits, shared builds and combined-suite runs. Existing
currency/exponent, paste-parity and acknowledgement protections were preserved.
Final integrated app artifacts require verification from the agreed frozen
source, including native builds. No commit, push or release was performed by
this task.
