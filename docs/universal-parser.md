# Bank-independent extraction and confirmed import

This implementation is a shared review/extraction layer for both UAE/Saudi
misses and sources outside the existing country registry. It does not replace
correct launch-parser results or relax automatic-import, currency, or posting
guards. An unknown bank is not a reason to discard otherwise readable facts.

## Public interface

```ts
inspectUniversalBankEvent(source, context?): UniversalBankEvent
planConfirmedUniversalImport(state, event, confirmation): ConfirmedUniversalImportPlan
canonicalUniversalSourceKey(sourceKey): string
```

`UniversalBankEvent` separates transaction amount, statement total, minimum
payment, balance, credit limit, merchant, transaction date, due date, statement
date and instrument. Each field carries a value or null, explicit/ambiguous/
missing evidence, source-coordinate spans, alternatives and categorical issue
codes. The returned event does not retain the full source message.

`context` optionally supplies an established language/market pack, sender,
documented currency aliases, or an explicitly established date order. Neither
the ledger currency nor device locale is used to invent a currency or date.
The bank/country registry is not required for explicit ISO money: CAD, JPY,
AUD and other recognized currency codes remain inspectable.

When exact money has unfamiliar role wording, the parser now exposes it for
review with unresolved amount role, posting status and direction. Competing
figures remain alternatives; a fee cannot displace an unknown principal.
Instrument, reference and date spans are excluded from monetary candidates.
The host must independently require credible financial context and explicit
posting confirmation. This broadens review eligibility, not automatic import.
Unresolved amounts retain source-wide failure, scheduling and informational
context; an isolated amount line cannot erase a preceding decline or balance
notice. Label-only lines retain ownership of amounts on the following line.

The money adapter reuses `inspectAlertDraft` for exact decimal-string amounts,
currency metadata, interpretations and spans. It associates labels with each
amount locally, so replacing a period with a comma cannot turn a purchase into
its following balance. It excludes grounded merchant spans from role detection:
NEW BALANCE is a seller, not a statement total. Statements retain their document
context when an individual clause describes a historical last payment.

The field adapter preserves uncertainty. `03/04/2026` retains alternatives
without a source date convention; yearless and two-digit-year dates are not
expanded by guessing. Full/spaced instrument numbers retain only the final four
digits. Minimum-only statements retain an unknown total. Card settlements use
the distinct `card-payment` family and cannot become ordinary income/spending.

These choices follow the distinction between locale-specific number/date
formatting and the underlying value described in [Unicode LDML numbers](https://unicode.org/reports/tr35/tr35-numbers.html)
and [Unicode LDML dates](https://unicode.org/reports/tr35/tr35-dates.html).
Separating transaction, statement and payment-due facts also follows the
structured financial-data approach in the [OFX banking specification](https://financialdataexchange.org/common/Uploaded%20files/OFX%20files/OFX%20Banking%20Specification%20v2.3.pdf).
This module does not claim to be an OFX importer.

## Host integration contract

The application integration task owns the existing capture/store/UI paths.
This new module set is tested but is not itself wired into those paths.

1. Extract while the source is available in memory, then retain the normal
   discard/Private Mode policy. Reconstruct a whitelist of safe review fields;
   do not persist an arbitrary input object, raw body, sender, excerpt, or
   unrecognized diagnostic properties. Source coordinates do not require
   retaining the text they pointed into.
2. Associate the proposal with the host's immutable pending-review identity,
   capture identity, observation time and expiry. Review eligibility is not
   authority to mark an iOS automation as a qualified known-bank capture.
3. Show extracted suggestions and explicit alternatives. The user confirms
   status, amount/currency, direction, account, merchant/category and date.
   The adapter refuses absent confirmation, ungrounded money, incompatible
   instruments, invalid dates, mismatched currency/exponent, and non-posting
   events. Unknown fields require user input rather than a guessed default.
4. At confirmation, fetch the same unexpired proposal from authoritative state.
   Bind its source key and observation time yourself; do not accept unrelated
   UI-supplied identity metadata. Call the planner immediately against fresh
   state and commit its result in a serialized operation. A ready batch is
   single-use; replaying a cached batch is not an idempotency guarantee.
5. Use the existing materialization/store import and commit-time money checks.
   Await durable persistence before resolving the review, writing a tombstone,
   or acknowledging a native queue record. Do not opt generic unknown formats
   into learned automatic rules or known-bank automation qualification.

Confirmed transaction imports support the existing ledger's native minor-unit
scale, including JPY/0, USD/2 and KWD/3. They neither rescale existing data nor
mix a different currency into an established ledger. Cross-currency posting
still needs a separate, explicit dated FX contract.

Canonical identity bridges preserve native provider identity through review:

- `apple_message_review_source_<64 hex>` → `h<64 hex>`.
- `android_message_review_source_a123` → `ha123`.
- Existing `arc1_...` hashes remain opaque; provider IDs cannot be reconstructed
  from an amount, timestamp or raw body.

The confirmed adapter handles ordinary postings only. Statements, balances,
future obligations and card settlements need dedicated validated handlers;
their extracted facts are available without turning them into transactions.

## Verification and evidence limits

Run the dedicated, in-memory suite:

```sh
node scripts/universal-test/run.cjs
```

It writes no compiled modules and does not change the existing 66-suite gate.

| Suite | Passing checks |
| --- | ---: |
| Merchant/date/instrument fields | 56 |
| Money and field ownership | 66 |
| Public event extractor | 50 |
| Confirmed import adapter | 49 |
| Text → ledger → reload integration | 20 |
| Total | 241 |

All five suites passed. The six new TypeScript modules have zero strict
no-emit diagnostics; scoped ESLint and whitespace checks passed. Independent
review reproduced and verified the fixes for historical statement payments,
fee substitution, merchant role contamination, OTP footers, negative posting
status, spaced identifiers, malformed date suffixes and canonical identities.

The tests are explicitly synthetic structural/adversarial examples unless they
identify an existing redacted specimen. They establish behavior, not proof of
every bank's real message formats. No worldwide automatic-admission gate was
enabled. Named-month extraction currently covers English and Arabic; other
unsupported wording and ambiguous facts remain unresolved. One message with
multiple possible transactions remains ambiguous instead of selecting one.

## Integration ownership

Only new `src/lib/universal-*`, `scripts/universal-test/` and this documentation
were written in this workstream. The existing parser32, capture, review, money,
package and test-harness files remain owned by the integration task. It owns
the source-free review variant, admission for valid AE/SA misses as well as
unknown worldwide issuers, expiry/backup validation, native qualification and
durable confirmation wiring. Final app verification follows that handoff.
