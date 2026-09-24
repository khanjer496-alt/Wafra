# Universal parser rollout contract

The worldwide parser is a separate bounded context from the launch-tested UAE
and Saudi importer. New market packs may inspect and suggest, but they do not
enter the shipping auto-import router until their own bank/template fixtures
meet every gate below. A changed or unknown template falls back to review.

## First-wave market packs

- United States, United Kingdom, France, Germany, Spain, Italy and Netherlands.
- India, Qatar, Kuwait, Bahrain, Oman, Egypt and Jordan.

The pack vocabulary is seeded from bank, central-bank and payment-network
documentation. Most US and European institutions publish alert categories but
not stable message bodies, so those seeds remain synthetic until consented,
locally redacted fixtures prove an exact institution/channel/template grammar.

## Second-wave market packs

- Canada, Australia, Brazil, Mexico and Singapore.

These packs are review-only on exactly the same terms as the first wave. They
add domestic rails (Interac e-Transfer; NPP/Osko/PayID/PayTo/BPAY; Pix/TED;
SPEI/CoDi/DiMo; PayNow/FAST/GIRO), ISO currency routing (CAD, AUD, BRL, MXN,
SGD), institution identities (RBC, TD Canada Trust, BMO; CommBank, ANZ,
Westpac, NAB; Itaú, Bradesco, Banco do Brasil, Nubank; BBVA México, Banorte,
Santander México, Citibanamex; DBS/POSB, OCBC, UOB) and Portuguese/Spanish
posting, failure, pending and request vocabulary.

Their evidence is `scripts/test/fixtures/public-alert-evidence.js`: eleven
second-wave rows (CA 2, AU 3, BR 1, MX 3, SG 2) reconstructed from issuer
documentation (`standard-derived`) or a public user report with every personal
field replaced (`community-derived`), next to 27 US rows of the same kind.
Values and names are fictional. None of them is a consented real alert, so none
counts toward the automatic-import gates below.

Six certification rules cite these rows (ANZ Osko credit, Itaú card purchase,
Banorte purchase, recurring charge and refund, DBS PayNow outgoing); Canada has
none because its only documented family, Interac Request Money, never posts.
Each rule is anchored to the whole documented template and still requires the
semantic layer to prove the event posted. Only the ANZ Osko credit states its
own completion ("received"). The Itaú, Banorte and DBS templates are headings
("compra …", "cargo recurrente …", "PayNow outgoing …") with no completion
verb, and the same headings open holds, requests, reversals, fraud questions,
promotions and limit changes. A heading is therefore not posted evidence: those
alerts are refused today and their rules stay inert until a template-specific
posting adapter exists. The fixture file pins this as a fail-closed known gap.

Market-specific vocabulary is scoped to its own pack. A bare `$` means CAD,
AUD, MXN or SGD only after an alert has been routed to that market by sender,
institution, ISO currency or a domestic rail; a US alert still reads `$` as USD
and an unrouted `$` stays ambiguous. Spanish "compra" and Portuguese "saque"
change only Mexican and Brazilian readings. Brands that also bank in another
supported market need a country-qualified identity: TD and BMO are US banks
too, BBVA and Santander are Spanish, and Scotiabank is omitted because its
alerts do not say whether they are Canadian or Mexican; "DBS Bank India" and
other named DBS subsidiaries are not Singapore evidence. ANZ, Westpac and DBS
also operate in New Zealand or Hong Kong, which have no pack; a bare `$` in
such an alert could be read as AUD/SGD. That is a known limitation, not
coverage for those countries.

Pending, authorization-hold, on-hold, approval-required, limit-change, request,
fraud-question and declined wording (English, Portuguese and Spanish) now keeps
an alert out of the posted state in every pack, unless the same clause states
completed settlement ("was debited", "foi debitado", "fue cargado") that is not
itself negated ("nothing was charged"). This is a clause-level guarantee: the
structured universal parser reads the clause that owns the amount, so a status
split off by a comma ("... recebido de JOAO, pendente"; equally "... received
from JOHN, pending confirmation" in English) is not yet vetoed on its
verified-app semantic-generalization path. That pre-existing gap affects every
market and is tracked separately from these packs. Other known gaps are pinned in the
fixture file: non-posted transfer/recurring rows read family `unknown`, and a
"was canceled" Zelle alert is refused as `unknown` rather than `failed`.

A routed alert reads numeric dates with its market's convention from the
country model (`src/lib/country.ts`, keyed by the same ISO code): Australia,
Brazil, Mexico and Singapore are day-first; Canada stays undecided, so an
ambiguous Canadian date is never guessed. Choosing one of these countries does
not select a launch parser pack; they keep the neutral pack.

The review interface now carries market-scoped institution candidates from
sender and body evidence for representative first-wave banks. Exact sender and
body agreement is identified; conflicts remain ambiguous; unknown senders stay
unknown. These research identities do not claim that a bank's message formats
are supported, and institution evidence never bypasses transaction safety.

## Automatic market routing

Country selection is not a parser input for the worldwide review path. Each
alert is routed independently from its sender/institution identity, localized
bank grammar, payment rail and currency evidence. Device region is only a
supporting hint: it cannot create a route, and it cannot override a bank alert
from another country. This matters for expatriates, travellers and foreign
cards.

The router returns `single`, `ambiguous` or `unknown`; it does not expose an
uncalibrated confidence percentage and it never returns the source or sender.
Generic USD/EUR symbols, English or Arabic text, and an overlapping global
brand such as HSBC remain ambiguous without market-specific evidence. Two
independent consistent alerts can resolve a provisional capture market;
duplicate copies of one alert cannot manufacture consensus.

Routing is not import authorization. UAE and Saudi automatic capture continues
through the launch parser. First- and second-wave global routes feed only the
review path until the corresponding bank/template rollout gates pass.

## Private review tray

A global alert reaches the encrypted review tray only after the launch parser
returns no transaction and the worldwide inspector finds one posted,
institution-backed transaction with an exact currency, exponent, amount,
direction and supported family. Authentication, failed, future, statement,
balance, mandate-lifecycle, unknown-direction and ambiguous-amount messages are
discarded rather than shown as parser failures.

Tray items contain structured evidence only—no raw message, sender, account
reference, parser reason or candidate list. Pending items expire after 30 days
and are capped at 50. Add/dismiss decisions leave only an opaque, expiring
tombstone so rescans do not nag the user. The tray is excluded from editable
backups and never creates transactions, bills or subscriptions automatically.

Android performs review admission on-device. The iOS relay now provides the
same review fallback for known UAE/Saudi bank senders: it discards the message
text and sender, then seals only exact money, direction, institution, family,
masked instrument and opaque keyed identities to the phone. The app persists
that item in its encrypted tray before acknowledging the relay row. This is
launch-market parity, not worldwide parity; non-UAE/Saudi relay misses remain
discarded until their own threat model and rollout evidence exist.

## Ledger money staging

Persisted ledgers now carry an explicit ISO currency and minor-unit exponent
while keeping every existing UAE/Saudi `*Fils` integer unchanged. The first
schema accepts exponents 0, 2 and 3 so currencies such as JPY, AED/USD and KWD
have exact input/format primitives. This is storage preparation, not permission
to auto-import global alerts: import, FX, relay, reports and backup-version
contracts still need end-to-end currency enforcement before those rows may
enter the ledger.

India has stronger standardized evidence: NPCI publishes AEPS success,
decline, reversal, withdrawal, balance-enquiry and transfer alert families,
plus UPI collect-request and statement-narration standards. A collect request
or AutoPay pre-debit notice is future intent and must never post as spending.

Primary research starting points:

- [RBI electronic-transaction customer protection](https://rbi.org.in/commonman/Upload/English/Notification/PDFs/NOTI1506072017.PDF)
- [NPCI AEPS SMS standard](https://www.npci.org.in/PDF/AePS/circular/2019-20/Circular%2004%20-%20Standardization%20of%20SMS%20alerts%20to%20customers.pdf)
- [NPCI UPI collect-request standard](https://www.npci.org.in/PDF/npci/upi/circular/2018/Circular%2057.pdf)
- [NPCI UPI AutoPay](https://www.npci.org.in/product/autopay)
- [Chase alert categories](https://www.chase.com/personal/mobile-online-banking/login-alerts)
- [Bank of America alert categories](https://info.bankofamerica.com/en/digital-banking/alerts)
- [NatWest transaction-notification behavior](https://www.natwest.com/support-centre/payments/general/credit-card-transaction-notifications.html)
- [Banque de France banking glossary](https://www.banque-france.fr/fr/comites-consultatifs/ccsf/glossaire-du-ccsf)
- [Sparkasse account-alert categories](https://www.sparkasse.de/pk/produkte/konten-und-karten/banking/online-services/kontowecker.html)
- [CaixaBank alert taxonomy](https://www.caixabank.es/particular/caixamovil/alertaparticulares.html)
- [Banca d'Italia payment instruments](https://www.bancaditalia.it/compiti/sispaga-mercati/strumenti-pagamento/index.html)
- [Rabobank notification categories](https://www.rabobank.nl/particulieren/service/online-bankieren/pushmeldingen-instellen)
- [Qatar retail payment systems](https://www.qcb.gov.qa/en/Pages/Retail-payment-systems.aspx)
- [Central Bank of Kuwait transaction-alert requirement](https://www.cbk.gov.kw/en/cbk-news/announcements-and-press-releases/press-releases/2018/08/201808150943-press-release-cbk-instructions-to-local-banks-on-providing-free-text-messaging)
- [Central Bank of Bahrain payment landscape](https://www.cbb.gov.bh/wp-content/uploads/2022/11/The-Digital-Payment-Landscape-Report-2022.pdf)
- [Central Bank of Oman payment systems](https://cbo.gov.om/Pages/ElectronicFundsTransfer.aspx)
- [Central Bank of Egypt debit-card case study](https://www.cbe.org.eg/ar/consumer-protection/case-studies/debit-cards-case-study)
- [Central Bank of Jordan retail payment systems](https://cbj.gov.jo/EN/Pages/Retail_Payment_Systems)

## Decision order

1. Resolve authentication, failed, future, informational or posted status.
2. Ground amount and currency, preserving ambiguous interpretations.
3. Separate transaction amount from balance, limit, due and fee figures.
4. Resolve debit/credit direction.
5. Identify purchase, transfer, cash, refund, fee, utility or recurring family.
6. Suggest a category only when evidence is explicit.
7. Treat explicit recurring language as a recurring-payment candidate, then
   detect subscriptions across posted history; one merchant charge is never enough.

Mandates, standing instructions and direct-debit notices are structured
schedule evidence, not proof that the economic family is a cancellable
subscription. A utility, loan, insurance payment or investment can use the
same payment scheme. Lifecycle messages (create, modify, pause, resume,
cancel) remain informational; pre-debit notices remain future; neither writes
money. Full mandate/reference values are not copied into review reports.

When two nearby figures cannot be safely clause-scoped—for example a charge
immediately followed by an available balance—the review inspector refuses to
choose a primary amount. Exact bank-template grammar may later recover those
false negatives; the generic layer must not guess.

OTP/3DS, collect requests, pre-debit notices, declines, statements, balances,
marketing and phishing-like messages are forbidden imports even when they
contain a valid amount and merchant.

## Fixture provenance

Every fixture must say whether it is:

- `standard-derived`: sanitized from a bank/network standard;
- `synthetic`: invented to exercise a grammar edge;
- `consented-redacted`: a real alert, redacted locally with explicit consent.

Synthetic and standard-derived fixtures can build and review a pack. They can
never contribute to an automatic-import score. Every benchmark fixture records
its institution, channel, template version and authoring/held-out split.
Evaluation uses only consented, redacted, held-out real alerts, and the gate
closes if one institution/channel/template version appears in both splits.

## Automatic-import gates

Per market/bank pack, automatic import requires:

- at least 300 consented, redacted held-out real fixtures across at least five institutions;
- at least 60 held-out non-posted alerts and 10 examples of every required
  purchase, transfer, cash, refund, fee, utility, recurring, statement, balance
  and authentication family;
- at least 20 failed/declined and 20 future/pre-debit held-out alerts;
- posted-vs-non-posted precision of at least 99.7%;
- posted-transaction recall of at least 95%;
- exact posting-status accuracy of at least 99%;
- exact amount, currency and direction of at least 99.5%;
- family precision of at least 98%;
- recurring-alert precision of at least 98%, preferring lower recall to false recurring labels;
- duplicate-creation rate no higher than 0.1%;
- zero forbidden imports;
- zero regressions in the complete UAE/Saudi suite.

These are engineering launch gates, not regulator-provided thresholds. Passing
them makes a pack eligible for a limited bank/template rollout; it does not
turn on an entire country. Physical shadow telemetry and user confirmation
remain required before broader enablement.

The recurring-alert metric measures single-message classification only. It is
not a subscription-accuracy claim. Subscription accuracy requires a separate
held-out sequence benchmark through the history-based detector, including
variable utilities, mandate lifecycle changes, cross-account fees and explicit
user dismissals.
