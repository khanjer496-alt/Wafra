# Public bank-SMS sources

What a search for open bank-SMS parsers actually turned up, and what each one
is worth to Wafra. Recorded so the next search starts where this one stopped
instead of re-treading it.

There is no authoritative, machine-readable public UAE bank-alert corpus.
Individual alert examples do appear in public support pages and public posts,
and those can pin a grammar after sensitive values are replaced. The two
accuracy exports in this directory are repository-supplied redacted fixtures;
their original, unmasked bodies are not part of this repository.

## Privacy and evidence rules

- Never add an original, unredacted customer message.
- Replace card/account digits, names, amounts and other identifying values in
  public examples unless the source already masks them.
- Label synthetic grammar probes as synthetic. They establish parser behavior,
  not evidence that a bank sends that exact wording.
- The tests keep fixture text in memory only. Production ingestion must persist
  the structured transaction and discard the raw body after processing.

## Eight-bank audit

The audit covers the banks named in the product brief. “Redacted fixture”
means stable repository test data, not a claim of access to customer inboxes.

| Bank | Evidence pinned in tests | Remaining evidence gap |
| --- | --- | --- |
| Emirates NBD (ENBD) | Redacted purchase, ATM and available-limit families | More Arabic ENBD wording |
| ADCB | Redacted card-use, Salik and statement families | More Arabic ADCB wording |
| FAB | Broad redacted coverage: multiline card purchases, account credits, direct debits, statements and card payments | More Arabic FAB wording |
| Mashreq | Public/redacted `was used for a purchase`, foreign-currency `using your card`, compact named-month dates, and aggregate catch-up refusal | Itemized delayed-settlement email format |
| ADIB | Public/redacted compact masked-card purchase; official `Covered Card` terminology | Published Arabic alert bodies |
| RAKBANK | Official alert-family list; a clearly labelled synthetic retail grammar probe | No public exact message body found—do not fabricate one |
| Liv | Redacted `You spent`, ATM and transfer families | More statement and Arabic variants |
| Wio | Public/redacted app-push wording with foreign amount plus AED equivalent | More debit, credit and transfer push bodies |

### Named-bank sources used in the 2026-07 audit

- [ADIB SMS Banking](https://www.adib.ae/en/personal/services/sms-banking)
  confirms transaction alerts and the bank's “Covered Card” terminology. A
  [public compact-format example](https://www.reddit.com/r/dubai/comments/10ehikd/)
  pins the masked-card grammar after values are replaced.
- [RAKBANK SMS Alerts](https://www.rakbank.ae/en/cards/card-safety/sms-alerts)
  confirms retail, online, cash-withdrawal and other alert families, but does
  not publish their bodies. The RAKBANK test is therefore explicitly
  synthetic.
- A [public Wio notification example](https://www.reddit.com/r/UAEcreditcards/comments/1s6ji00/automatically_track_all_your_card_spends_in_one/)
  pins the “foreign amount (AED equivalent)” order. This is app-notification
  evidence, not SMS evidence.
- Public Mashreq examples pin a
  [USD purchase with compact date](https://www.complaintlists.com/someone-used-credit-card-google-zabusamid/),
  a [GHS purchase with day-month-name date](https://www.linkedin.com/posts/sweekar-b-r-46091b7a_mashreq-fraudulentactivity-mashreq-activity-7118200109640630272-AGye),
  and an [aggregate delayed-settlement notice](https://www.reddit.com/r/dubai/comments/1edi2is/what_happened_to_mashreq/).
  The aggregate is refused because one total cannot safely represent several
  already-notified purchases.
- The GHS fallback uses the
  [Bank of Ghana daily interbank rate](https://www.bog.gov.gh/treasury-and-the-markets/daily-interbank-fx-rates/)
  published for 2026-07-27. It is only an approximate parser fallback; ledger
  FX should replace it with a dated transaction rate.

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

## Do not copy from

**sarim2000/pennywiseai-tracker** is **AGPL-3.0**. It supports six UAE banks —
ADCB, Emirates Islamic, Emirates NBD, FAB, Liv, Mashreq — which makes its
source the most tempting thing in this list and the most dangerous. AGPL would
force Wafra to publish under AGPL too. Its architecture may inform independent
design review, but its source, regexes and fixtures are not Wafra inputs.

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

The shipping `src/lib/sms-parser.ts` normalizes Arabic digits, orthography and
transaction vocabulary directly, so categories, cards, dues and subscriptions
continue through one parser interface. `src/lib/arabic-sms.ts` is a historical
test-only rewrite and is not the production seam.

Al Bilad's two published formats are the reference, and are pinned under the
Saudi market in `scripts/test/fixtures/saudi-bank-formats.js`, executed by the
same acceptance harness as the named UAE corpus:

    شراء عبر نقاط البيع
    بطاقة: **1234;الإئتمانية
    لدى: <merchant>
    دولة: السعودية
    مبلغ: 12.00 SAR
    رصيد: 1234.56 SAR
    في: 2019-05-07 23:44

The labelled `في: YYYY-MM-DD HH:mm` and slash-separated twin are both accepted
without enabling an unlabelled year-first date anywhere else in a message.

### Still open

- **The word list is the ceiling.** A deterministic parser is only ever as good as its
  vocabulary, and this one has never been checked against a real Arabic
  message from a UAE bank — there is no such corpus to check against. The
  first real one will almost certainly add words.
