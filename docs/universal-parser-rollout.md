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
  completed, posted or settled;
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

## Learned bank formats (per person, deterministic)

`learned-alert-formats.ts` (pure) and `learned-format-capture.ts` (wiring).
Order in every capture path: proven parsers and the best-effort policy →
**learned formats** → AI reading → Review as before.

- **Learning:** a universal Review item for an alert no parser recognised
  carries a *learning draft* made at capture time (boilerplate literals and
  slot types only; the tray still keeps no message text). Confirming the item
  ("Confirm and add") turns the draft into a template, or counts one more
  confirmation of it, with the person's direction and day. A different amount
  learns nothing; another day drops the date slot; the opposite direction on a
  learned format stops it. No draft in Private Mode (and switching Private
  Mode on drops pending drafts). Senders that are phone numbers are keyed by
  the format's anchor signature instead.
- **Matching** (Android SMS/notifications via `parseUnproven`/`parse`, iOS
  History import, iOS live capture's Review path): one confirmation →
  pre-filled Review item labelled "Recognised format — confirm"; two
  consistent confirmations → the row is added with the best-effort marker
  `learned:template:<direction>` plus the template id ("Learned format —
  check", confirm or undo; undo also stops the format; "Looks right" counts a
  confirmation). Auto-adding also needs a pinned ledger, the unchanged
  `decideBestEffortAutoPost` checks (non-completed wording, future date, a
  dated rate for foreign money) and the setting "Auto-add from learned
  formats" (default on; off keeps every match in Review).
- **Never** for an AE/SA sender, an alert routed to AE/SA (including by its
  own AED/SAR money), an AE/SA user or an AED/SAR ledger: learning and
  matching refuse, and on those ledgers a match can only pre-fill Review.
- **iOS live capture** reads non-Gulf alerts through Review only (it has no
  worldwide automatic row type), so a learned match there is a pre-filled
  Review item, never an automatic row.
- **Settings → Learned bank formats:** masked shapes only, sender, direction,
  currency, confirmations, status; forget one or all; the auto-add switch.
- **State:** `learnedAlertFormats` in the encrypted ledger, included in the
  exported backup and validated on restore (`validateLearnedFormatStore`: a
  malformed container rejects the backup, tampered templates are dropped).
  Erasing the ledger erases them; the two switches are preferences.

## AI reading of unrecognised alerts (optional on-device model)

Two on-device engines can read an alert that **every** rule-based path and the
learned formats refused, in this order: the phone's own model (Apple
Foundation Models on iOS 26+ with Apple Intelligence, Gemini Nano through the
ML Kit GenAI Prompt API on supported Android phones; `ai-alert-platform-reader.ts`),
then the optional downloadable tagger (pruned multilingual-E5-small, int8
ONNX, ~32.7 MB). Both only pre-fill Review ("Suggested by on-device AI");
confirming such an item teaches the format (see above). Contract:

- **Where it runs:** Android: `auto-import.ts` `inspectRefused`, inline,
  after the launch grammar, `parseUnproven`, the learned formats, the universal
  reader and the refusal pipeline all left the alert `ignored/unrecognized`.
  iOS live capture and iOS History import parse synchronously, so they hand
  such alerts to a bounded in-memory queue (`ai-alert-prefill-queue.ts`, at
  most 8 waiting, text cleared once read, never persisted) that stages the
  Review item later. Never for a UAE/Saudi sender, route, user or AED/SAR
  ledger (`ai-alert-reader.ts`, re-checked by the gate).
- **Phone model limits:** only alerts observed in the last 3 days, at most 12
  readings per 10 minutes, one request at a time with an 8 s timeout, skipped
  in Low Power Mode / Battery Saver or when the OS reports the model
  unavailable. The model returns the phase-2 harness JSON (posting + reason,
  amount and currency as written, direction, family, merchant, date) under a
  closed schema (guided generation on Apple; validated in JavaScript for
  Gemini Nano). Its strings are only located in the text; the direction is kept
  only when a direction cue in the text agrees, otherwise the person picks it.
  It never posts. Setting: "Suggest fields with on-device AI" (default on).
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
- **Model delivery (tagger):** never bundled. Downloaded only from Settings →
  On-device alert reader, off by default, Wi-Fi only unless the person turns
  "Wi-Fi only" off (the connection type comes from the OS; unknown is never
  treated as Wi-Fi), from the pinned GitHub
  release `parser-ai-tagger-v1` (overridable base URL, same hashes), verified
  by exact size and SHA-256 before every first load, ceiling 45 MB, deletable.
  Model absent → capture behaves exactly as before.
- **Second opinion (verifier)** on rule-parsed rows (`ai-alert-verifier.ts`,
  `EXPO_PUBLIC_WAFRA_AI_ALERT_VERIFIER`, off, not wired): measured to catch
  injected errors but none of the real rule errors, so it stays off.

Evidence: `docs/test-evidence/2026-09-25-parser-ai-phase2.md`,
`docs/test-evidence/2026-09-26-parser-ai-wire.md`.

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
