# Public bank-SMS sources

What a search for open bank-SMS parsers actually turned up, and what each one
is worth to Wafra. Recorded so the next search starts where this one stopped
instead of re-treading it.

**There is no public UAE SMS corpus.** Every result is either an Indian
parser, a Gulf parser with no sample data, or a bank marketing page saying
*that* it sends alerts without ever quoting one. The only real UAE corpus this
project has is the two accuracy exports in this directory, from real phones.

## Usable

### MabudAlam/transaction_sms_parser — **MIT**

Dart package, 30+ Indian banks. India-only, so its bank list and UPI handles
are no use here. Its *vocabulary* is: the balance-phrase synonyms it accepts
are the same shorthand HSBC, Citi and Standard Chartered carry into the Gulf
on shared templates.

Four spellings it accepts that Wafra did not read, now closed and pinned in
`parser.test.js`:

| wording | reads as |
| --- | --- |
| `Avbl bal` | balance |
| `Avl lmt` | limit |
| `Avbl. credit limit` | limit |
| `Limit available` | limit |

Bare `Balance AED 5,000` is still deliberately refused — `minimum balance
AED 3,000` is a requirement, not this account's money.

No code was copied; the licence is compatible either way.

### obahareth/bank-al-bilad-sms-parser

Saudi, and the only source found with **Arabic** GCC message text:

    شراء عبر نقاط البيع بطاقة: **1234;الإئتمانية لدى: <merchant> مبلغ: 12.00 SAR

### sarim2000/pennywiseai-tracker issues

The issue tracker, **not the code**. Contributors paste real message text when
requesting a bank, and those quotes are facts about bank wording.

## Do not copy from

**sarim2000/pennywiseai-tracker** is **AGPL-3.0**. It supports six UAE banks —
ADCB, Emirates Islamic, Emirates NBD, FAB, Liv, Mashreq — which makes its
source the most tempting thing in this list and the most dangerous. AGPL would
force Wafra to publish under AGPL too. Read the issues; stay out of the code.

## Known gap: Arabic

Wafra refuses every Arabic bank SMS, including ones whose amount is in Latin
script:

    ❌ شراء عبر نقاط البيع بطاقة: **1234 لدى: CARREFOUR مبلغ: 132.00 AED
    ❌ عملية شراء بمبلغ AED 250.00 لدى نون من بطاقتك المنتهية 8575
    ❌ تم خصم مبلغ 150.00 درهم من حسابك رقم 1234 لدى بيسان الطبي
    ❌ تم خصم د.إ 150.00 من حسابك

UAE banks send Arabic to customers whose profile language is Arabic, so this
is a whole-user gap rather than a missing format. Not started — it needs its
own decision about scope.
