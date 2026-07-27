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

### saurabhgupta050890/transaction-sms-parser — **MIT**

The TypeScript original the Dart package above was ported from. Its published
corpus is a single example row, and that row earned its keep:

    INR 2000 debited from A/c no. XX3423 on date IST at SMAPLE Avl Bal- INR 2343.23

A **hyphen** between the label and the figure. Wafra read nothing at all from
`Avl Bal- AED 2343.23`, because `-` is one of the mask characters barred from
the gap. Now allowed as a separator immediately after the label, while a *run*
of hyphens beside the figure (`Avl Bal AED ----9235.93`) is still a mask and
still refused. Both halves pinned.

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

**ritesh-kanwar/Cashiro** is the same trap wearing a different name: same UAE
bank list, same "on-device, no cloud" pitch, **also AGPL-3.0**, and it has a
`parser-core` module that is exactly what one would want to read. Its source
was deliberately not opened here.

**Xetera/sms-regex** has **no licence file at all**, which means all rights
reserved — nothing in it may be copied. Moot anyway: its patterns are Turkish
(Trendyol, Getir, Finansbank, Türk Telekom), with no Gulf coverage.

## Not open source

**[Obba](https://www.obba.pro/)** is a commercial MENA tracker claiming 25+
banks across English *and* Arabic, Emirates NBD and ADCB among them. No source
and no corpus to read — its interest is as proof that Arabic parsing is table
stakes in this market, not a technical curiosity.

## Arabic — was the gap, now supported

Every Arabic bank SMS used to be refused outright, including ones whose amount
was already in Latin script, because the parser gates on an English verb
before it looks at anything else. Banks in both Gulf markets send Arabic to any
customer whose profile language is Arabic, so this was a whole-user gap rather
than a missing format.

`src/lib/arabic-sms.ts` rewrites the vocabulary into the wording the parser
already reads, and everything downstream — categories, cards, dues,
subscriptions — is inherited rather than reimplemented. See that file's header
for why a rewrite rather than a second parser.

Al Bilad's two published formats are the reference, and are pinned verbatim in
`scripts/test/arabic.test.js`:

    شراء عبر نقاط البيع
    بطاقة: **1234;الإئتمانية
    لدى: <merchant>
    دولة: السعودية
    مبلغ: 12.00 SAR
    رصيد: 1234.56 SAR
    في: 2019-05-07 23:44

### Still open

- **Dates.** `في: 2019-05-07` is ISO; the date patterns read `d/m/y`, so an
  Arabic message's own date is not used. Live SMS take the received time, so
  this only shows on a bulk import of old messages.
- **The word list is the ceiling.** A rewrite is only ever as good as its
  vocabulary, and this one has never been checked against a real Arabic
  message from a UAE bank — there is no such corpus to check against. The
  first real one will almost certainly add words.
