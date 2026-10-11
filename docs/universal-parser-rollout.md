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
- Colombia and Peru (see "Latin American bank templates" below).

These packs are review-only on exactly the same terms as the first wave: "review-only" means no grammar in them is verified against consented real alerts. When the user's "Auto-add alerts from unverified bank formats" setting is on (the default), the best-effort policy can still auto-add a clear completed alert from these banks with the "Auto-added — check" marker. The one certified second-wave rule (ANZ Osko credit) posts without a marker, following the US certified-template precedent; its evidence is standard-derived, not a consented real alert. They
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

## Gulf neighbours (Qatar, Kuwait, Bahrain, Oman)

These four first-wave markets now have a posting rule of their own. Its
evidence is thin and stated plainly: no Qatari, Kuwaiti or Bahraini alert text
exists anywhere in our sources (the banks and regulators say only that alerts
exist), and Oman has one Bank Muscat family whose structure comes from three
community-collected alerts. None is a consented real alert, none counts toward
the gates below, and nothing here claims "Gulf coverage".

**Money.** A three-decimal figure written with one full stop and no comma
(`KWD 12.345`, `0.650 OMR`, `BD 4.250`) is a decimal, 12.345 KWD, only after
the alert is routed to Kuwait, Bahrain or Oman and only for that market's own
currency (`dotDecimalCurrencies` in the pack, read by `alert-draft.ts`). It is
never twelve thousand. Unrouted figures, other currencies on the same alert
(`USD 1.250`), comma-written figures (`KWD 12,500`) and repeated separators
keep their ambiguity, and the riyal (two decimals) never reads a three-digit
tail as a decimal. After routing, the packs also accept `QR` beside a
two-decimal figure (`QR 42.50`, `42.50 QR`; never "QR code", "Scan QR 3
times" or `QR 123456`), `ريال قطري`, `دينار كويتي`, `دينار بحريني` and
`ريال عماني`; a bare `ريال` or `دينار` is shared by several countries and is
never evidence. The pre-routing money hint (`REVIEW_MONEY_HINT`) follows the
same rule, so a chat saying "دينار" or "12 QR codes" never reaches the
worldwide router. A spelling the universal reader did not use as money stays
as written for the launch grammar, so "at BD 12 STORE" keeps its merchant
name instead of becoming "BHD 12 Store".

**Routing.** Brands that also bank elsewhere count as a market's institution
only when the alert also states that market's own currency (ISO code, unique
Arabic abbreviation, spelled-out currency, or the Latin abbreviation beside a
figure): QNB (Egypt), NBK (Egypt), KFH (Bahrain, Turkey), BBK, Ahli United,
Bank ABC, Burgan, Doha Bank, Gulf Bank, QIB and HSBC Oman. A QNB or NBK alert in
EGP is therefore no longer routed to Qatar or Kuwait. The reverse also holds:
a `CITI`/`Citibank` sender used to route to the US by name even when the alert
stated BHD or KWD; such an alert (neighbour money and no USD or `$`) is no
longer US evidence and stays unrouted. Every other Citi alert keeps its US
route. Standard Chartered has no grammar in any of the four markets, and an
`HSBC` sender stays ambiguous (it is a UAE launch sender and a UK one), so
neither routes by name. The UAE launch registry
is untouched: ADIB, Mashreq, Emirates NBD and the rest keep their routes, and
`scripts/test/gulf-neighbour-alerts.test.js` pins today's behaviour (an ADIB
QAR purchase on an AED ledger still posts through the launch grammar; a
Mashreq KWD alert on a KWD ledger still does not post).

Institutions, by reach: QA: QNB, Commercial Bank of Qatar, Doha Bank, QIB,
Masraf Al Rayan, Dukhan Bank. KW: NBK, KFH, Gulf Bank, Burgan, Boubyan,
Warba, Commercial Bank of Kuwait. BH: NBB, BBK, Ahli United, Bahrain Islamic
Bank, KFH Bahrain (and Bank ABC). OM: Bank Muscat, Bank Dhofar, National Bank
of Oman, Sohar International, Bank Nizwa, HSBC Oman. The banks added in this
pass have body (bank-name) identities only: no SMS sender id for them is
verified, so none was invented. Bank Muscat gained `BKMUSCAT`, the one extra
sender the research records.

Notification packages, pending Play verification and deliberately absent from
`trusted-bank-notification-packages.ts`: `com.vipera.ts.starter.QNB` (QNB; a
third-party audit site only, and QNB is multi-country). No package id for any
other QA/KW/BH/OM bank has been verified.

**Posting.** One decision, `decideGulfNeighbourPosting` in
`src/lib/gulf-neighbour-alerts.ts`, called from the same unproven-format seam
as every other non-launch alert (`parseUniversalPostedEvent` in
`launch-alert-parser.ts`, reached from `parse` and `parseUnproven`):

- It applies only when the router proves a single QA/KW/BH/OM route through a
  recognised institution. Anything else keeps the generic best-effort policy
  unchanged.
- **Best-effort (QA, KW, BH, and Oman beyond the one template).** The alert is
  read by the SAME launch grammar the UAE and Saudi Arabia use (`parseSms`),
  not by a new one. The market's own spellings are first rewritten to the ISO
  code, so the grammar reads them as exact foreign money (KWD keeps 12345
  thousandths). Its offline-table conversion and any balance snapshot are
  discarded. The row posts only when every check passes: the setting is on;
  the shared non-completed-wording guard and a limit-change guard find
  nothing; the alert states a completion verb; the grammar reads one
  transaction in exactly the market's currency; the universal reader, scoped
  to the same market, reads the same amount and does not contradict the
  direction; the date is not in the future; and foreign money has a dated
  rate on the device. The row carries the existing `bestEffort` marker
  ("Auto-added — check"). Anything else from such an institution goes to
  Review, with the amount filled once the currency is routed. The generic
  universal reader may not post it alone.
- **Certified (Oman, Bank Muscat, one family).** `om-bank-muscat-card-purchase-v1`
  (`gulf-neighbour-templates.ts`, also registered in
  `universal-template-certification.ts`) anchors the whole Arabic debit-card
  purchase alert: OMR on one side of a three-decimal amount, a masked account,
  the merchant (numeric terminal ids stripped), a `YYYY/MM/DD hh:mm:ss` date
  and the balance sentence, with nothing before or after. Delivered by Bank
  Muscat's own SMS sender, it posts without the marker, following the ANZ and
  US certified-template precedent. The same wording, future-date, money and FX
  guards still apply. Outside AE/SA every SMS path honours the best-effort
  setting, so this one does too. Bank Muscat's deposit, transfer, payment, ATM
  and refund alerts have no real sample, so they have no template. They take
  the marked grammar path or Review.
  The merchant slot accepts only a card descriptor (Latin letters, digits,
  space and `& ' * / -`, a full stop only inside a token), so a sentence such
  as "SHOP. ألغيت العملية" or "SHOP. Transaction failed" between the merchant
  and `بتاريخ` can never be read as part of the name. The template reader and
  the certification registry also check the WHOLE message against the shared
  non-completed wording guard plus template-only words (refunded, returned,
  blocked, disputed, `استرجاع/استرداد/إرجاع/إعادة`, `تعليق/إيقاف`, `بانتظار`,
  `قيد المراجعة`, `لا تشارك`, `إذا لم تقم`); certification no longer returns
  `automatic` on `event.status` alone.
- **Notifications.** The same decision owns a notification routed to QA/KW/BH/OM
  through a recognised institution: `auto-import.ts` lets
  `parseLaunchAlert` (and so `decideGulfNeighbourPosting`) decide, and the
  universal certification and Green semantic generalization never post such a
  row on their own. Heading-only notices therefore go to Review on
  notifications too, and the best-effort setting gates Bank Muscat's template
  there as it does on SMS. (Certified templates in other countries keep their
  existing notification rule; the Gulf-neighbour rule is stricter because
  every neighbour post, template included, is under the setting.)
- **Card bill payments** ("Your card 1234 bill of KWD 120.500 has been paid",
  "تم سداد فاتورة البطاقة …", "payment … towards your card") are moving money
  between the person's own accounts, never spending: they go to Review.
- **Heading-only notices** (an amount and a card with no completion verb) are
  never booked here. They could be booked only inside an exact per-bank
  certified template with a masked card and no negation, pending, OTP or promo
  wording, and no such template exists for these markets.
- **Never posted**, each pinned in English and Arabic: OTP and verification
  codes, declines, pending holds, promotions and cashback offers, balance-only
  notices, limit changes, mini-statements, bills and amounts due, future-dated
  alerts and template-shaped alerts carrying OTP wording. The shared
  non-completed guard (`best-effort-autopost.ts`, every marked path) now also
  refuses `ألغيت`, `لم تنجح`, `غير ناجحة`, `غير مكتملة`, a suspended or stopped
  card, `استرجاع/استرداد/إرجاع/إعادة المبلغ`, `بانتظار`, `قيد المراجعة`,
  `لا تشارك`, "amount refunded/returned", "to be debited", "blocked" and a
  raised dispute. "إذا لم تقم بهذه العملية اتصل بنا" is a security footer on
  genuine completed alerts and is deliberately not a veto on the marked path
  (it does break the exact template).

**Conservative outcomes, by design.** These go to Review after this change
where they posted (marked) before, and are pinned in
`gulf-neighbour-alerts.test.js`:

- `Purchase of QAR 1.500 …`: a riyal never has three decimals, and the
  grouped reading (QAR 1,500) is not stated, so the figure is not trusted.
- `Purchase of KWD 1.234.500 …`: repeated full stops stay ambiguous even on a
  Kuwaiti route.
- `QR 123456 reference: …`: `QR` beside a bare integer is a code, not money.
- `You have sent KWD 50.000 to TEST PERSON`: no completion verb the policy
  recognises ("sent" alone), so it waits in Review.
- Body-only brands (Dukhan Bank, Bank Nizwa, National Bank of Oman, and the
  other body identities above) route by name even when the alert states
  another currency: `Bank Nizwa: USD 50.00 debited …` on a US/USD ledger used
  to post as a marked US alert and now routes to Oman, where its USD is not
  the market's own currency, so it waits in Review with the amount filled.
  This is intentional. These are single-country banks, so a USD alert from
  one is a foreign spend in Oman, not a US alert; requiring OMR before the
  name counts would hand the alert back to the generic policy under a US
  route, which attributes it to the wrong country. Review is the
  conservative outcome. Multi-country brands keep the own-currency rule.

Fixtures: `scripts/test/fixtures/gulf-neighbour-alert-fixtures.js`, written in
Wafra's own words with fictional values and per-row provenance (`synthetic`
for every QA/KW/BH row; `community-derived` structure for OM-BM-1).

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

## Latin American bank templates (Brazil, Colombia, Mexico, Peru)

Colombia and Peru are review-only packs on the same terms as the second wave:
COP and PEN, the Bre-B (and its "llave" keys), PSE, TransfiYa and Botón
Bancolombia rails, the Yape, Plin and CCI rails, Spanish second-person
preterites ("compraste", "pagaste", "recibiste", "te envió") as completion
words, and institution identities for Bancolombia, Davivienda, DaviPlata,
Nequi, Banco de Bogotá and Nu Colombia; BCP, Yape, Interbank, Plin, BBVA Perú
and Scotiabank Perú. Brazil gains Inter, C6 Bank, Caixa, Santander Brasil,
Mercado Pago and PicPay. Numeric dates are day-first in all four countries
(`src/lib/country.ts`). None of this is verified coverage: no consented real
alert exists for any of these banks, so every gate below stays closed.

### Posting rule: authorisation-time templates (a per-template exception)

Card alerts in these countries are sent when the card is AUTHORISED
("Compra … APROVADA", "Aprobado(a)", "Compra autorizada") and no later
posting alert follows. Everywhere else in this contract a bare approval or
authorisation is not posted evidence, and that remains true. By product
decision, approval wording counts as posted **only** inside one of the exact
per-bank templates in `src/lib/latam-alert-templates.ts` whose mode is
`approval`, and only when every one of these holds:

1. the whole message matches that bank's anchored template (prefix, field
   order and terminator; only the captured merchant/name/key text varies).
   Captured free text holds no `!`, `?`, `¡`, `¿` or line break. A dot is
   allowed anywhere, because real merchants and names abbreviate
   (`SUPERMERCADO STA. LUCIA`, `EXITO S.A.`, `CAJERO CRA. 7`, `SR. PEDRO`).
   The outside scan blanks a capture only up to its first sentence break
   (`. `), so everything after it stays visible to the guards and
   "MERCADO SOL. Compra estornada." cannot hide its second sentence inside
   the merchant;
2. the template captured a masked card or account (its last four digits);
3. nothing outside the captured merchant, name, key, place and concept text
   is negation (`não`, `no`, `rechaz…`, `recus…`, `negad…`, `insuficiente`,
   `cancelad…`, `bloquead…`), a two-step confirmation or question (`confirme`,
   `confirma tu`, `responda`, `responde`, `reconoces`, `foi você`, `SIM`, `?`),
   pending, hold or scheduled wording (`pendiente`, `pendente`, `en proceso`,
   `retenido`, `agendado`, `programado`, `será`), failed, returned, disputed,
   suspended or still-processing wording (`procesando`, `processando`,
   `devuelt…`, `devolvid…`, `falló`, `sin éxito`, `sem sucesso`, `en trámite`,
   `no se pudo`, `suspen…`, `contestad…`, `desfeit…`, `extorn…`, `erro(r)`,
   `failed`, `pending`, `refund…`, `revert…`, `void…`, `inválid…`,
   `em aberto`), a code, OTP or token, a loan, offer, limit or promotion
   (`empréstimo`, `pré-aprovado`, `cashback`, `cupom`, `limite`, `cupo`,
   `meses sin intereses`) or a link;
4. the captured merchant, name, key, place and concept text ITSELF holds no
   veto either: a negation phrase (`no realizada`, `não aprovada`), a
   decline, reversal or cancellation (`revers…`, `cancel…`, `estorn…`,
   `extorn…`, `reembols…`), the failed/returned/processing wording of point 3,
   a confirmation (`foi você`, `responda`), pending or
   scheduled wording (`pendiente`, `aguarde`, `agendamento`, `amanhã`,
   `mañana`, `em análise`) or a code. A hit there sends the alert to Review;
   it is never blanked out. Only a stand-alone `no`/`não` and offer words are
   left to the outside scan, so a merchant called "NO FRILLS" still posts.
   The outside scan blanks each capture by its exact span (match indices,
   with an ordered left-to-right fallback), never the first occurrence of the
   same text elsewhere in the message.

Approval wording with no masked card (Bradesco Cartões, C6 Bank, Itaucard,
PicPay, the short "BB: Compra aprovada", "Compra aprovada no seu Nubank",
BBVA México "Compra autorizada"/"fue aprobada") matches a `review` template:
its money is grounded for Review and it never posts. A heading with no
completion or approval verb (BBVA México "Compra por $… con tarjeta *1234",
the Banorte control notices, the Itaú "compra com cartão" reconstruction)
also stays Review or refused; the Banorte and Itaú public-evidence rows remain
pinned known gaps. Generic approval wording outside a template keeps the
behaviour above (refuse or Review).

Templates whose own verb states completion ("Compraste", "Retiraste", "Você
enviou", "Você recebeu", "Yapeaste", "te envió un pago") are mode `posted` and
pass the same guards. An outside-text guard failure returns the message to the generic
parser, never to a template posting.

A posted template event is not an import by itself. From SMS and history it
goes through the best-effort policy above and is written with the
"Auto-added — check" marker (ledger currency, FX, future-date and duplicate
rules unchanged). From a bank-app notification, template certification
(`certifyUniversalTemplate`) returns `automatic` only when the router
independently identified the template's own institution from the sender or
body; a template the body alone matches (Nubank's purchase line names no bank)
is not issuer proof for that unmarked path.

| Country | Bank | Posts (mode `posted` / `approval`, masked card where approval) | Review only |
|---|---|---|---|
| BR | Nubank | card purchase (incl. instalment total), debit/credit "acaba de comprar", Pix out, Pix/transfer in, estorno, card-bill payment (a "Card payment" transfer), boleto paid (purchase, never a guessed utility) | feed line "… com Nubank final", "Compra aprovada no seu Nubank" |
| BR | Itaú | card purchase "Compra aprovada no cartão final NNNN", Pix out/in, TED in | Itaucard purchase (no masked card) |
| BR | Banco do Brasil, Caixa, Inter, Santander Brasil | card purchase with "final NNNN"; Inter Pix in | BB short form, Inter Mastercard |
| BR | Mercado Pago | "Você pagou" (incl. "próxima fatura" card purchase), reembolso | — |
| BR | Bradesco, C6 Bank, PicPay | — | card purchase/payment (no masked card) |
| CO | Bancolombia | credit/debit purchase (incl. "asociada a T.Cred"), ATM, transfer out (account, Bre-B), QR and Botón payments, PSE/bill payment, card-bill payment (the card-payment row for the paid card), cash advance (an own-account transfer), transfer in (account, llave), payroll (salary) | the older "le informa" generation |
| CO | Davivienda | purchase and advance "Aprobado(a) … Tarjeta *NNNN" (time only; the date is the observation day) | — |
| CO | Nequi, DaviPlata | "Pagaste … con Nequi"; P2P out/in (Nequi needs Nequi identity); DaviPlata "paso plata" | — |
| CO | Nu Colombia (needs "Nu Colombia" identity) | "Compra aprobada … terminada en NNNN"; transfer in with a bare `d.ddd.ddd,dd` amount | body-only purchase line |
| CO | Banco de Bogotá | — | purchase (synthetic evidence) |
| MX | BBVA México | SPEI out (the rail fixes MXN), ATM "Retiraste", transfer sent/received with concepto (needs BBVA México identity) | purchase heading, "Compra autorizada", cardless withdrawal, own-account traspaso |
| PE | Yape | received (incl. "te yapeó", "te yapearon"), sent | — |
| PE | BCP | "Realizaste un consumo … ****NNNN" | "Compra con tarjeta BCP", transfers |
| PE | Plin | — | received and sent |

Interbank, BBVA Perú, Scotiabank Perú, Santander México and Citibanamex are
identified for routing and Review only: any generic "posted" reading of an
alert naming them is downgraded to Review (`institution-review-only`).
"Interbank" and "Plin" need Peruvian context for this (soles, PEN, "Perú",
a Peru route or the bank's own sender): "Interbank transfer of $500.00" from
a US bank is not a Peruvian alert and keeps its US behaviour.

The Spanish and Portuguese non-completion wording the best-effort policy
refuses (purchase and security codes, "token", "confirme", "foi você",
scheduled Pix, bills, loan offers, "em análise", "en análisis", "en
proceso", and reversed, returned, failed, disputed or still-processing
participles such as "extornado", "estornada", "devuelta", "devolvido",
"fallida", "sin éxito", "sem sucesso", "procesando", "en trámite",
"contestada", "suspendida", "no se pudo") applies only to an alert routed
to BR/CO/MX/PE, a person in one of those countries, or money already
resolved as BRL/COP/MXN/PEN. A US alert paid "with your Apple Pay token"
or at a cafe called CONFIRME is unaffected.

### Money and routing

- A bare `$` is COP only after the alert is routed to Colombia and MXN only
  after it is routed to Mexico, by bank identity, a domestic rail (Bre-B,
  PSE, TransfiYa; SPEI, CoDi, DiMo) or an ISO code. PSE counts only with
  Colombian context (a COP figure, a Colombian issuer or Spanish payment
  wording): "PSE&G" and "PSE HOLDINGS" are US payees. Nu, Mercado Pago, BBVA,
  Santander, Scotiabank and Itaú are shared brands and route only with a
  country-qualified signal (`R$`, `S/`, an ISO code, "BBVA México", "BBVA
  Perú", "Nu Colombia", "Santander" next to `R$`). The person's own country
  still resolves `$` only through the existing best-effort shared-symbol map.
  `R$` and `S/` are currency evidence for Brazil and Peru; like CAD, a
  currency alone (with no rail or institution) does not route.
- Amount shape may only block. COP reads a 3-digit run after `.` or `,` as
  grouping (`$45.000` = 45,000 COP) and a final 2-digit run as decimals
  whichever mark it uses (`$33.335,00`, `$1,111,111.00`, `COP44.444,44`); a
  1-digit fraction or a malformed group (`$1.25.000`, `$45.5`) goes to Review,
  and so does a COP card purchase under 50 pesos (a mangled `45.000`). MXN is
  `1,234.56`: an MX-routed `$45.000` or `$1.234,56` goes to Review. PEN is
  `S/ 12,450.00`, `S/1.60` or Yape's whole `S/ 1.`; `US$` is never PEN. BRL is
  `R$ 1.234,56`; an instalment alert books its total, not the instalment.
  COP keeps exponent 2.
- Nu Colombia's bare `2.653.381,00` is money only inside its own template with
  Nu Colombia identity.

### Yape receipt check

Yape shows the payee a three-digit "código de seguridad" so a fake payment
screenshot can be spotted. It is a receipt check, not an OTP. Only inside the
exact Yape receipt template, that one clause is removed before the wording
guards run and before anything that might be stored (`policySource`); the
code never reaches the universal event, the Review tray or a ledger row. Any
other code wording, including a Yape-looking message outside the template,
keeps refusing.

### Duplicates

A Bancolombia cash advance arrives as the advance and a matching "Recibiste
una transferencia". Both read as transfers of the same amount (the advance as
an outgoing transfer from the card, the receipt as an incoming transfer), so
neither can be counted as income, and the import planner's duplicate guard
drops a rescan of either; the advance carries the app's "Own account
transfer" title. Card-bill payments are never spending: Bancolombia's names
the paid card, so it becomes the app's card-payment row for that card
(`Card •NNNN payment`, the debit side; notifications hand it to the
card-payment adapter rather than certifying it), and Nubank's, which names no
card, is a transfer titled "Card payment".

### Android notification packages (pending verification)

No LatAm package is in `TRUSTED_BANK_NOTIFICATION_PACKAGES`. These candidates
come from open-source apps that disagree with each other and must be checked
against Google Play before any is added: Colombia
`co.com.bancolombia.personas.superapp` (and legacy `com.todo1.mobile`),
`com.nequi.MobileApp`, `com.davivienda.daviviendaapp`,
`com.davivienda.daviplataapp`, `com.bancodebogota.bancamovil`; Mexico
`com.banorte.movil`, `mx.com.santander.supermovil`, `com.banamex.movil`; Peru
`com.bcp.innovacxion.yapeApp` (letter case differs between sources),
`com.bcp.bank.bcp`, `com.interbank.bond` or
`pe.com.interbank.mobilebanking`, `pe.com.bbva.bbvacontigo`; Brazil
`br.com.intermedium`, `com.c6bank.app`, `br.com.bb.android`, `com.itau`,
`com.bradesco`, `br.com.gabba.Caixa`, `com.santander.app`, `com.picpay`.
`com.nu.production`, `com.mercadopago.wallet`, `com.bbva.bbvacontigo` and
`com.grability.rappi` serve several countries and must never map to one
market.

Evidence: `scripts/test/fixtures/latam-alert-fixtures.js` (synthetic and
community-derived rows in Wafra's own words, fictional values; each shares
only the fixed template wording with public descriptions) and
`scripts/test/latam-alert-packs.test.js`.

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

"Pending" anywhere in a message (also `pendente`, `pendiente`, `ausstehend`,
`en attente`, `in attesa`, `in behandeling`, `em processamento`, `awaiting`,
`معلق`) makes it non-posting: "Transfer … received from JOHN, pending
confirmation" stays reviewable but can never post, including through a
certified template. "Your payment to Jane was received by her/their bank"
describes the recipient's receipt, so its direction is left unresolved for
Review instead of being read as money in.

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

## Best-effort automatic posting (unverified formats)

The gates below decide when a pack becomes *verified*. Separately, by product
decision, an alert in an unverified format may be added before that, through
one policy only: `decideBestEffortAutoPost` in `src/lib/best-effort-autopost.ts`.
It never touches the UAE/Saudi launch grammar or a certified template. It never
runs for an AE/SA sender or an alert routed to AE/SA. When the launch grammar
declines such an alert on a non-Gulf ledger, the strict, unmarked universal seam
that shipped before this policy still applies, and the setting does not affect
it. Every guardrail is required:

- the setting "Auto-add alerts from unverified bank formats" is on (the
  default; off restores review-first for every unverified format);
- the universal parser reads `posted`, and an independent wording guard finds
  no pending/hold/authorisation, request, declined/failed, reversed/cancelled,
  OTP/verification, promotion, statement/bill/due/reminder or future/scheduled/
  mandate language (English, French, German, Spanish, Italian, Dutch,
  Portuguese, Arabic). Temporary authorisations, holds and charges are refused,
  and so is a bare "authorised/authorisation" unless the text also says
  completed, posted or settled. Lure wording is refused whoever sent it:
  money owed, promised or waiting to be released ("you're due a refund",
  "due to receive", "entitled to", "to release the funds", "verify your
  details", "use the payment link to receive", "sent by mistake, send it
  back"), unconfirmed charges ("we noticed a purchase", "confirm the
  following") and future shop collection ("amount to be paid"). Advert and
  shop wording ("apply now", "Hurry", "using code", "get paid", "earn up to",
  "pay now", "will be delivered", "track your order") is tested with the
  merchant descriptor masked, so a shop called HURRY CURRY or PAY NOW PARKING
  is a name, not wording. A bank's own trailing promo footer ("Apply now for
  a personal loan", "Earn up to 7.5% on FD", "Get paid up to 2 days early",
  "Track your order", "To deposit cash anytime use ...", "Reward points will
  be added") is set aside only when the rest of the text states a completed
  movement and names the reader's own card or account tail or comes from a
  registered header. A shop order number with a callback hook, a "refund is
  available" line and an "If any dispute" desk are refused unless the text
  states a completed movement on the reader's own card or account tail;
- no link whose call to action is dispute/verify/cancel/claim/accept/log in
  (and similar): "If this wasn't you, dispute here: http://…" is smishing
  bait, so the money sentence before it is never posted. It counts when the
  action is imperative at the link ("here", "now", a colon), a weak verb
  (update, log in, sign in, receive, get) names the person's own details or
  money, or the link is a shortener, a lookalike registrable domain or a
  spoofed one ("chase.com-refund.example"); a weak verb with "now"/"here"/a
  colon counts unless the link is the header brand's own domain or an app
  store; in a "Not you?" sentence a hyphenated domain counts only when it
  borrows a brand or security word and is not the alert's own brand
  ("chase-x.example" does; "first-direct.com", "credit-agricole.fr",
  "co-operativebank.co.uk" do not). A purpose-clause footer to a plain domain
  ("To dispute this charge visit www.chase.com/dispute"), a bank subdomain
  ("Sign in at secure.chase.com"), an app store, "Report Dispute", "To cancel
  alerts, visit …" and "Not you? Visit chase.com/fraud" are not.
  The same check keeps a certified template out of automatic posting;
- no wording that withdraws or questions the money sentence: fraud prompts
  ("Fraud alert", "Was this you?", "Did you authorize this?", "Reply Y/N",
  "flagged", "held", a security or bare code — never an auth, approval or
  merchant code — "that we blocked", "under review"), an unnamed
  payer ("Somebody paid you $500!"),
  earn-per-event adverts ("Earn $5 every time…", not "Earn 5% back on
  groceries"), "Tap to accept", or a question or
  condition about the payment itself ("Has JORDAN paid you $48.20?", "If
  JORDAN LEE paid you $48.20, …");
- money that is a new movement of the person's own cash: a purchase converted
  to EMI/instalments, airtime received, a merchant's own order notice (it
  repeats the bank's debit alert), a fund crediting units and a payment to the
  person's own card ("You paid $X to your … Card") are not auto-added. Whether
  such a message then appears in Review is the refusal inspector's decision;
  on the iPhone History import most of them are not imported at all. These
  checks apply only to automatic posting; user-taught (learned) templates
  keep their own wording guard;
- the unverified-sender rule. It applies only to a sender that is PRESENT and
  is a phone number of seven or more digits, an e-mail address or a generic
  word ("INFO", "ALERT", "SMS", ...): a credit from such a sender, or a debit
  whose only hook is a callback ("Not you? Call ..."), must name one of the
  reader's own cards or accounts by its tail next to an own-instrument word
  ("A/c XX4410", "card ending 4421", "Acct: ******1736", "حساب رقم XXXX1234").
  A masked figure elsewhere (a payer's phone "0712***678", "Ref *4410") does
  not count. Otherwise it waits in Review (`unverified-sender`). A registered
  alphanumeric header, a carrier short code (three to six digits) or an app
  package is not affected. NO sender at all (an iOS Messages History record,
  pasted text, the AI path without one) is not treated as unverified: such a
  credit is auto-added with the "Auto-added — check" marker when every other
  guardrail passes, and only the wording guard and the link gate stand
  between a senderless lure and the ledger. Known trade-off: a few banks
  alert from a full phone number (US toll-free alert numbers; Swedbank
  Latvia's 29610101 on Android); their credits that print no own account or
  card tail go to Review. No per-bank exception is made without real
  evidence of that bank's sender;
- a link (http, www., a short-link or a lower-case domain path) blocks
  auto-add unless the sender is a registered header, short code or app
  package;
- a supported family (purchase, cash withdrawal, refund, fee, utility,
  recurring payment, transfer) whose direction matches it: refunds are
  credits, transfers must state their direction and post as transfers;
- exactly one principal amount (a role-separated balance is allowed);
- an explicit ISO currency or proven symbol. A shared symbol (`$`, `¥`, `Rs`)
  resolves only to the user's own country's currency, so a `$` alert for a
  user in Germany stays in Review;
- a date that is not in the future;
- foreign money converts only with a dated rate already on the device (or the
  card's own charged figure checked against one), otherwise Review with
  `fx-rate-unavailable`;
- a pinned ledger currency, so a best-effort row can never make a batch
  mixed-currency (an AED/SAR ledger additionally requires a single non-Gulf route).

Refusals of a "money arrived" claim from a phone number, e-mail, generic
header or no sender wait in Review rather than being dropped when the text
carries something only a bank or wallet writes (a rail such as M-PESA, Pix,
UPI or Zelle, a balance, a reference or a transaction code) and is not a
personal chat ("from me", "I sent it", "did you get it"). A completed
movement from a registered header refused only by advert, shop-notice or
order-callback wording also waits in Review.

Posted rows still pass the import planner's duplicate guard and Wallet
near-match hold. Each carries `bestEffort: {v, format, market}`, with
code-owned identifiers only and never message text. A best-effort row never
stores the message excerpt that low-confidence rows otherwise keep. The row is
shown as "Auto-added — check", with "Looks right" (clears the marker), edit
(saving clears it) and "Undo — remove" (after a confirmation). A proven reading
of the same alert that later merges into the row also clears the marker.
Undo, deletion, undoing the import batch and deleting the account all remove
marked rows and record bounded tombstones in the same state write: the exact
source key, plus the observation time with ledger currency and amount
(`t{ts}:{currency}{minor}`). Rescans, parser re-reads and History imports then
skip that reading. A different amount at the same time is a different movement
and is not suppressed. The setting is mirrored in the foreground store and in the
killed-process Android capture wake. A failed save reverts the switch. Transactions
can be filtered to "Auto-added to check", and Review links to that list.

Channels: Android SMS inbox and delivery, Android bank-app notifications
(including green semantic generalisation, which uses the same policy with the
`semantic` format prefix) and the iOS Messages History import. iOS live capture
(`ios-local-capture.ts`) builds its parser sessions with the policy disabled,
so it stays review-only for unverified formats. None of this is a claim of verified coverage for any bank outside
AE/SA.

An alert a recognised Qatari, Kuwaiti, Bahraini or Omani institution routes is
decided by `decideGulfNeighbourPosting` instead (see "Gulf neighbours" above).
It reads the alert with the launch grammar as it is, without widening it or
changing what it reads for AE/SA, under the same setting, marker, wording,
future-date and FX guardrails. What it declines stays in Review.

## AI reading of unrecognised alerts (optional on-device model)

An optional on-device tagger (pruned multilingual-E5-small, int8 ONNX, ~32.7 MB
download) can read an alert that **every** rule-based path refused. Contract:

- **Where it runs:** only in `auto-import.ts` `inspectRefused`, after the launch
  grammar, `parseUnproven`, the universal reader and the refusal pipeline all
  left the alert `ignored/unrecognized`. Never for a UAE/Saudi sender or route
  (`ai-alert-reader.ts`, re-checked by the gate).
- **What it may do:** open a Review item whose universal event carries the
  model's grounded amount/currency/merchant/direction/date as suggestions the
  person confirms (`EXPO_PUBLIC_WAFRA_AI_ALERT_PREFILL`, on by default but inert
  until the model is downloaded). It never adds a ledger row.
- **The gate** (`gateAiAlert` in `src/lib/ai-alert-extractor.ts`) is
  deterministic: the model's amount must overlap exactly one money token found
  by the universal money reader; the currency must resolve to one ISO code
  (shared symbols and local spellings such as درهم, Dhs, ريال, SR, TL, R, N only
  through the user's own country); `hasNonCompletedWording` and the universal
  parser's authentication/pending/promotion/failed/future readings veto.
- **Automatic posting** from a model reading additionally needs the build flag
  `EXPO_PUBLIC_WAFRA_AI_ALERT_AUTOPOST=1` (default off), the best-effort
  setting, calibrated confidences at the manifest operating point, no
  competing money figure, a direction cue in the text of the same polarity and
  none of the opposite one (`ai-alert-cues.ts`), and the unchanged
  `decideBestEffortAutoPost` policy (future dates, FX, launch markets). It is
  also gated **per language** (`ai-alert-gates.ts`): a language may open only
  after passing on at least 500 labelled **real** messages with ≤ 0.3 % false
  posts and ≥ 98 % fully correct posted rows. Every language is off, and
  capture does not wire the post outcome in this build.
- **Model delivery:** never bundled. Downloaded only when the person asks,
  Wi-Fi only unless they explicitly allow mobile data, from the pinned GitHub
  release `parser-ai-tagger-v1` (overridable base URL, same hashes), verified
  by exact size and SHA-256 before every first load, ceiling 45 MB, deletable.
  Model absent → capture behaves exactly as before.
- **Second opinion (verifier)** on rule-parsed rows (`ai-alert-verifier.ts`,
  `EXPO_PUBLIC_WAFRA_AI_ALERT_VERIFIER`, off, not wired): measured to catch
  injected errors but none of the real rule errors, so it stays off.

Evidence: `docs/test-evidence/2026-09-25-parser-ai-phase2.md`.

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
