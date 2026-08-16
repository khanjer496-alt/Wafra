# Universal bank-alert interpretation

Wafra's launch parser uses two cooperating layers:

1. The proven UAE/Saudi grammar parser extracts exact bank-specific fields and
   remains authoritative when it has a result.
2. A format-independent semantic interpreter reads the accounting meaning of
   an alert from its evidence rather than from one sentence layout.

The semantic interpreter can recognize posted salary/payroll/WPS income,
business payouts and settlements, transfers between owned accounts, outgoing
transfers, card purchases and repayments, utility payments, ATM withdrawals,
refunds, reversals, and bank fees. It tolerates casing, whitespace, line wraps,
currency placement, reordered field lists, compact `CR`/`DR`, `A/C`, `CC`,
`FT`/`IBFT`, `POS`, `BILLPAY`, and `ATM WDL` notation, and balance text after
the movement. Compact notation is accepted only when the direction sits beside
an account or card and the alert still has one grounded movement amount.

## Automatic-import safety gate

A new semantic transaction is created automatically only when all of these are
true:

- the sender identifies exactly one enabled launch institution;
- the message proves the movement is posted, not future, pending, requested,
  declined, or promotional;
- debit or credit direction is unambiguous;
- exactly one local-currency movement amount remains after balance, limit, due,
  and statement figures are excluded; and
- wording independently proves one of the supported accounting meanings.

Unknown meanings, competing amounts, unsupported currencies, and ambiguous
institutions remain review-only or refused. OTP and security-challenge alerts
are non-posting and never become ledger rows.

Merchant names and promotional footers are untrusted text. They cannot turn a
proven card purchase into salary, an owned transfer, a fee, an ATM withdrawal,
or a card repayment. User-confirmed merchant/category choices stay higher
priority than parser suggestions.

Four-digit account and card identifiers are not money. For compact sequences
such as `A/C 1234 AED 7,500`, the interpreter removes the account-shaped
currency-suffix candidate only when another explicit local-currency movement
amount is present; otherwise it refuses the ambiguity.

## Coverage boundary

This architecture removes dependence on a bank's exact sentence template, but
it does not claim that arbitrary text can be posted safely. Automatic launch
coverage is currently limited to enabled UAE and Saudi institutions and their
local currencies. More countries require verified sender identity, currency
and amount rules, hard-negative fixtures, and held-out accounting benchmarks;
they should reuse this interpreter rather than add another parser pipeline.

The permanent semantic matrix covers every UAE/Saudi launch sender across all
supported accounting meanings, plus line-wrap, spacing, casing, balance-decoy,
future/pending, misleading-merchant, reversal, statement, and subscription
controls. The private corpus audit checks replay idempotency, duplicate
identity, user-edit protection, and unchanged monthly income, spending, cash
out, and card-payment totals without publishing message bodies.
