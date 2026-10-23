# Alert lab

A generative, labelled, metamorphic test bench for the bank-alert parser.
It writes bank SMS / push alerts for the launch markets that nobody has
collected yet, runs them through the **shipping** capture code, and reports
how many book correctly, how many wait in Review, and — the point of the lab —
every case that books unsafe money.

It does not change the parser. Parser lanes use it as a measuring stick and a
gate.

## What it generates

Each alert is composed from independent slot inventories, so most outputs
are new combinations rather than copies of a known template:

| slot | inventory |
|---|---|
| market | US CA GB IE DE AT CH FR BE NL ES PT IT PL SE DK NO CZ AE SA QA KW BH OM JO EG, each with a ledger currency, languages, sender styles (short code, alphanumeric bank id, push app title, blank like iPhone History), real and fictional banks |
| phrasing | per language (en ar de fr nl es pt it pl sv da nb cs) and family: completed purchase, card-not-present, ATM, refund, fee, incoming transfer/salary, outgoing transfer/P2P, bill/direct debit; 2nd/3rd person, active/passive |
| layout | sentence, headline (`Purchase: $12.00 at X`), labelled fields (`Betrag: … / Händler: …`, newline or `|`/`;`/`,` joined, optional sign), emoji fintech push, bilingual AR+EN duplicate |
| money | per market: symbol/ISO before or after, decimal comma or point, space/NBSP/narrow-NBSP/dot/apostrophe grouping (`CHF 1'234.50`), signs, 3-decimal KWD/BHD/OMR/JOD, zero-decimal IQD/JPY, Arabic currency words (د.إ ر.س د.ك ر.ع جنيه دينار …), Arabic-Indic digits, `$` = USD or CAD by market, explicit foreign-currency purchases |
| instrument | `card ending 1234`, `***1234`, `·5678`, `xxxx1234`, account phrases, per language |
| date | per locale, with/without year and time; ground truth is the ISO day |
| merchant | local, global and tricky names (`DECLINED CAFE`, `PENDING GOODS LTD`, `REFUND SHOP`, `99 CENTS ONLY 0123`, `MINUS 5 ICE BAR` …), billers, people, employers, ATM places |
| trailing context | available balance / credit, fraud help (`Not you? Call …`), alert-threshold sentence, STOP/HELP opt-out, links |

Every positive carries a label `{shouldPost, kind, family, direction,
amountMinor, currency, exponent, date|null, merchant|null, last4|null}`.

From each positive the lab derives:

- **Negatives** (must never book): declined/failed, pending/authorisation
  hold, future/scheduled, a genuinely hypothetical conditional (`If you make
  a purchase over X at Y, we will send you an alert` — not the "If you made
  this purchase, no action is needed" footer banks put on real charges),
  question/verification
  (`Did you make…? Reply YES/NO`), negation (`was not paid`), OTP, promotion,
  money request, statement/minimum due, pure balance, personal chat that
  mentions money (from a phone number), scam lure with a link (unregistered
  sender) — in the market's language, reusing the positive's money, merchant
  and instrument. A statement or scheduled debit may become a typed reminder
  (`cardStatement`/`billDue`) for its own stated amount; that is graded as an
  obligation, not a posting. A typed reminder read from any other negative is
  counted as `reminder` (a wrong reminder, not wrong money). The scam lures
  that copy a real charge alert plus a link differ from genuine alerts only by
  their unregistered sender and link domain; on iPhone History there is no
  sender, so only the link separates them.
- **Round-2 negatives** (`lexicon/round2.cjs`, from the english and europe
  lane reviews), in every language where the shape exists:
  `hold` (approval required / "may take 2 days to post" / "subject to final
  settlement" / card verification), `renewal` (subscription renews, trial
  ends, "is coming up"), `returned` (sent back, bounced, reported as fraud),
  `example` ("Example:", "Sample alert."), `limit` (a limit stated as the
  amount), `cardpay` (paying a credit-card bill), `ownmove` (between the
  person's own accounts), `unclaimed` (P2P waiting to be accepted or
  enrolled), `hedge` ("may have been used"), `nocharge` ("charged nothing"),
  `gluedq` ("…, didn't make this?"), `thirdp2p` (es/pt/it: someone else sent
  you money), `notyet` (not arrived / not executed / being sent / tomorrow),
  `billrecv` (a bill was received), `payeercpt` (the payee confirms your
  payment). Tolerated instead of a FALSE-POST (`generate.cjs` `NEG_ALLOWED`,
  always for the alert's own amount): a `cardPayment` for `cardpay`; for
  `ownmove` only a transaction flagged `transferHint` (the ledger keeps a
  transfer out of spending and income; an unflagged booking is a FALSE-POST);
  a `billDue` reminder for `renewal`/`billrecv`/`future`; a credit for
  `thirdp2p` and an expense for `payeercpt`. The opposite direction on those
  two is graded **WRONG**, not FALSE-POST.
- **Round-3 negatives** (`lexicon/round3.cjs`, from the final worldwide
  review). Six are TRANSFORMS of the base positive (`composeTransform`), so
  they test exactly the completed-looking alert plus one change:
  `statusline` (a status line appended in the alert's language: "čeká na
  zpracování", "NEKAD", "DENEGADA", "Tryk for at modtage", "Byli jste to vy?
  Odpovězte ANO"), `statusword` (a capitalised status word glued to the
  merchant or payee: "REWE UNGÜLTIG", "SHOP NO REALIZADA", "ICA PÅGÅR"),
  `issuerpay` (the payee replaced by a card issuer: AMERICAN EXPRESS EUROPE,
  DKB VISA, ICS, APPLE CARD …; tolerated only as `cardPayment`), `vishing`
  (a call-back or scheme-less lookalike-domain line, from a phone-number or
  e-mail sender; the call-back form is Android-only because iPhone History
  has no sender to tell it from a genuine footer), `ownacct` (the counterparty
  replaced by an own account: LIVRET A, N26 SPACE, TRADE REPUBLIC, MY
  SAVINGS …; tolerated only as a transfer-flagged row) and `signflip` (a sign
  or German S/H marker contradicting the direction: "+27,15 EUR" on a
  purchase, "-$500.00" on a deposit; ANY booking is WRONG). Two are
  templates: `threshold` ("charged more than X at Y") and `krlang` (a `kr`
  alert in another Nordic language than the person's SE/DK/NO country; ANY
  booking is WRONG currency). Nordic hedges ("kan ha dragits") join `hedge`.
- **Invariance variants** (must not change the decision or fields): add or
  remove the balance footer, fraud footer or opt-out; whitespace/line breaks;
  an emoji; NBSP around the amount; merchant letter case; an equivalent sender
  id of the same bank (Android only — iPhone History has no sender).

## Why there are DEV and HOLDOUT halves

Every inventory item (phrasing, headline, push wording, field label and
title, instrument, trailer, negative wording, money style, date style, mask,
merchant, counterparty) has a content key — its text or format descriptor.
Its half is decided once, by a hash of that content, across all markets and
languages (`generate.cjs` `sides()`), so the same wording or format (an
identical Danish/Norwegian phrasing, `12,34 EUR`, `NETFLIX`) is on the same
side everywhere. One global fix-up then moves an item across when a group of
two or more items landed entirely on one side, repeated until stable. `--split holdout` draws only HOLDOUT
items, so it measures the parser on wording, layouts and formats that parser
work was not tuned on. Tune on DEV; read HOLDOUT. If DEV improves and
HOLDOUT does not, the change memorised phrasings instead of generalising.

What is not split, deliberately: the market, family, layout kind, sender
style and bank, amounts and dates (they are the report's axes, not
vocabulary), and each market's single primary money format (`$12.34`,
`12,34 €`, `AED 12.34`), which both halves share because reading it is table
stakes (a format that is primary anywhere is shared everywhere). A
one-item group (a few ATM places) has nothing on one side; ATM place is then
omitted rather than borrowed. Layouts whose vocabulary is empty in a half fall
back to a sentence, trailers are omitted, negatives skipped: nothing is ever
borrowed across the split. `--json` records the split (`splitManifest`:
counts and every HOLDOUT content key); the gate test asserts the halves are
disjoint and that no HOLDOUT row used a DEV-only item.

## How to run

```sh
bash scripts/test/build.sh            # once per parser change, in the tree you measure
node scripts/alert-lab/run.cjs --split all --n 30            # dev + holdout, ~both paths
node scripts/alert-lab/run.cjs --split holdout --n 40 --market US,GB,DE --json scripts/alert-lab/out/h.json
node scripts/alert-lab/run.cjs --repo /path/to/other/worktree --split dev --n 20 --strict
node scripts/alert-lab/run.cjs --gate     # exactly the repair-test sample, ratchet view
node scripts/alert-lab/run.cjs --manifest # split sizes per inventory
```

Options: `--n` positives per market × family (per split), `--neg K|all`
negatives per positive (default 3, sampled from the 13 kinds), `--inv K|all`
invariance variants per positive (default 2), `--seed`, `--market`,
`--family`, `--path android-sms|ios-history`, `--jobs` worker processes,
`--json out.json` (summary, clusters, all unsafe cases, split manifest),
`--failures out.jsonl` (every unsafe case plus up to 2 rows per failure
cluster per worker), `--strict` (exit 1 on any WRONG/FALSE-POST/ERROR),
`--no-android-review`. A row's text depends on the generation settings
(`--neg 3` samples negative kinds, `--neg all` takes every kind), so replay a
case with the same settings, not by its id alone.
Keep outputs under `scripts/alert-lab/out/` (git-ignored).

The runner uses `scripts/universal-launch-eval/evaluate.cjs`'s own
`runCapturePath` from `--repo`, so the paths are exactly the launch eval's:
**android-sms** = `createLaunchAlertSession` `parse` (registered AE/SA sender →
launch grammar) or `parseUnproven`; **ios-history** =
`parseHistoricalMessageRecords`, senderless. Configuration mirrors the app:
the market's country and pinned ledger currency, best-effort posting on, no
FX rates.

## How to read the results

Per market × path: `ok/pos` booked with the right amount, currency, direction
and kind (a foreign purchase booked in the ledger currency counts as correct
only when the record keeps the exact original money and its stated rate);
`rev` not booked but offered in Review (iOS: a Review candidate; Android: the
app's own refusal policy, `inspectSourceFreeRefusedAlert`, decided `review`);
`miss` neither; `WRONG` booked with a wrong amount, currency, direction or
kind, plus invariance variants whose wrong booking differs from their base's,
plus runtime errors (e.g. iPhone History returning two records for one
message); `FP/neg` negatives that booked; `inv✗/n` invariance
variants whose decision or booked fields differ from their base. Then a
family breakdown, false posts per mutation kind, invariance violations per
mutation (`lost/gained/changed`), the top failure clusters (verdict | path |
language | family | layout, or the mutation) with one example and a
best-effort diagnosis from the worldwide event and the auto-post policy, and
the full list of unsafe cases.

Severity, in the launch brief's terms: a miss or Review is acceptable; WRONG
and FALSE-POST are never acceptable and are what the parser lanes fix first.
Soft mismatches (merchant, last4, date) are counted but are not unsafe.

## Template drift

`node scripts/alert-lab/run.cjs --drift K [--split …] [--n …] [--repo …]`
(`drift.cjs`) asks a different question: when an alert the parser already
books CORRECTLY drifts a little from its template, does it still book the
same money? For every correctly-booked positive on a path it derives K
label-preserving variants and reports **drift survival** (the share that
still book with identical amount, currency, direction and kind) per market ×
family × operator and path, the 15 lowest-survival operator × market pairs
with one before → after example, and every variant that books WRONG money
(must be 0; gated in the test, survival is not).

Operators, all in the alert's own language and within the market's real
conventions: re-order (`fields-reorder`, `date-first`, `tail-moved`), drop
optional parts (`drop-time`, `drop-date`, `drop-tail`, `drop-balance`),
restyle from the market's own inventory (`currency-style`, `number-format`
grouping on/off, `date-format`), bank name (`bank-prefix-add`,
`bank-prefix-remove`, `bank-suffix-add`), lexical (`synonym` from a
per-language table of direction-preserving swaps, `abbreviation`, `add-ref`
harmless reference field, `connector` ": " → " - " / " | " / newline, `typo`
in non-key words, `trailing-emoji`, `all-caps`, `title-case`,
`double-spaces`, `no-final-stop`, `smart-quotes`), and `combo` (2–3 of these).
Structural operators re-render from the composed slots, whose inventories are
already split, so they run in both halves; each lexical table entry is split
into DEV or HOLDOUT by its content.

## Long-input timing

Every graded parse is timed; the report lists the five slowest and how many
took over 50 ms. Separately, `lib/adversarial.cjs` builds 4 KB and 8 KB
adversarial bodies (thousands of digits, grouped digits, repeated sentences,
a huge merchant, Arabic repetition, a whitespace run, punctuation) and times
them on both paths in a child process (`lib/timing-child.cjs`) with a per-case
budget (`--adv-budget`, default 5000 ms): a runaway regex is killed and
reported as a timeout. Timings are wall-clock; the report prints the load
average because other work inflates them.

## The gate

`scripts/test/repair/alert-lab.test.cjs` (run by `scripts/test/run.sh`)
grades one fixed DEV sample (`gate.cjs`: n 1, 3 negatives drawn from the 36
kinds and 1 invariance variant per positive, both paths, ~5-10 s), and times
eight 4/8 KB adversarial bodies on both paths (< 2.5 s each; the whitespace-run
body that already times out on origin/main is reported by the runner, not
gated), and grades a drift sample (`DRIFT_GATE`: 4 variants per
correctly-booked positive) that must produce no WRONG booking and fails on any unsafe case that is
not in `known-unsafe.json`. That file documents the unsafe cases that exist
today; it is a ratchet: delete an entry when it is fixed (the test prints
which listed cases are now safe) and lower `KNOWN_UNSAFE_CEILING` in the
test (the file's length must equal the ceiling). Never add entries to make
the gate pass. Case keys are `path|hash(sender+body)`. The file records the
gate sample's `sampleHash`: editing any inventory changes the sample, and the
test then fails until the list is re-derived with
`node scripts/alert-lab/run.cjs --gate`, every case reviewed, and the new
hash recorded.

## Honest limitation

Generated text proves grammar generalisation and the safety controls: that
the parser books what the labels say and refuses the wordings that must not
book, across languages, layouts and formats it was not tuned on. It does not
prove coverage of any real bank: real banks use wordings, senders, encodings
and edge cases this lab has not imagined, and some phrasings here are
plausible rather than observed. Recall numbers from the lab are not launch
claims. Real, consented alerts (and the real-format check set) remain the
acceptance evidence for any market.
