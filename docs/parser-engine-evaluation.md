# Evaluating a parsing engine before it ships

Wafra reads bank SMS and notifications with rules: `src/lib/sms-parser.ts`
(AE/SA ledger) and `src/lib/alert-semantics.ts` (all markets). The recurring
proposal is to replace or supplement them with a model running on the phone.

This page is the evidence step that has to come first. It records what the
shipped rules actually score today, what a candidate has to beat, and what the
remaining failures are made of — because a parser gap and a categorisation gap
need different fixes and only one of them is a parsing problem.

Run the harness with:

```
npm run bench:parser                                   # the shipped rules
npm run bench:parser -- --engine ./my-candidate.mjs    # a candidate
npm run bench:parser -- --engine ./my-candidate.mjs \
  --baseline scripts/parser-benchmark/baseline-rules.json
```

## The engine contract

A candidate is an ES module exporting any of:

| Export | Signature | Scored by |
| --- | --- | --- |
| `name`, `description` | strings | labelling the report |
| `parseLedger` | `(message, { market, sender, observedAt }) => ParsedSms \| null` | ledger, divergence, latency |
| `reviewAlert` | `(message, market, { sender }) => AlertReview \| null` | global |

A section whose method is missing is reported as **not implemented**, never as
a zero. A candidate that only classifies categories must not be made to look
like one that reads every amount wrong.

`scripts/parser-benchmark/engines/rules.mjs` is the baseline engine. It wraps
nothing: `parseLedger` is `parseSms` and `reviewAlert` is `inspectMarketAlert`,
so a number it scores is a number the app scores.

## What the harness measures

Four measurements, deliberately not collapsed into one percentage.

1. **Labelled AE/SA ledger rows** — 11 rows from
   `scripts/test/fixtures/uae-bank-formats.js` and `saudi-bank-formats.js`,
   compared field by field against their `expect` blocks (kind, type, amount,
   currency, merchant, date, card, reference, transfer hint, balance snapshot,
   due day, minimum due, category). A field the fixture does not pin is not
   scored — scoring an absent expectation rewards guessing.
2. **Labelled global alert rows** — 188 rows from `global-alert-formats.js`,
   compared on decision, status, family, direction, currency, minor units, and
   institution identification.
3. **Divergence over the unlabelled corpus** — the 961 distinct in-repo
   messages (`scripts/test/corpus-messages.cjs`), which have no ground truth.
   This is *not* scored as accuracy. It is scored as disagreement with the
   shipped rules, split by what the disagreement costs a user:

   | Bucket | What it means |
   | --- | --- |
   | `posts-where-rules-refuse` | money the app would show that it does not show today |
   | `refuses-where-rules-post` | transactions that would disappear |
   | `different-money` | same message, different amount/currency/direction/kind |
   | `different-merchant-or-date` | same money, different label or day |

   The first bucket is the one that decides whether a candidate is shippable.
   A marketing SMS reading as an AED 250 purchase is worse than no reading.
4. **Latency**, against the budgets the import path already promises: 25 ms per
   message and under 1,500 ms for a 5,000-message import.

## Baseline: the shipped rules

Recorded in `scripts/parser-benchmark/baseline-rules.json`.

| Section | Result |
| --- | --- |
| Labelled AE/SA ledger | 121/121 pinned fields over 11 rows — 100% |
| Labelled global alerts | 1128/1128 pinned fields over 188 rows — 100%, institution 100% |
| Divergence | 961/961 agreement with itself, 0 in every bucket |
| Latency | p50 0.23 ms, p95 0.40 ms, max 1.0 ms; 5,000 messages in ~1.07 s |

Latency is machine-dependent and is therefore not pinned in the committed
baseline.

A naive engine — one that finds a currency amount and posts it, which is the
shape of any extractor without refusal knowledge — scores 54.5% on the
labelled ledger rows and, more importantly, **174 `posts-where-rules-refuse`
rows out of 961**. Those 174 are promotional offers, OTP messages, declined
transactions and bank-redacted figures such as `AED ····0710.00`. This is the
failure mode a candidate has to be measured against, and it is invisible in an
accuracy percentage.

## What the remaining failures are actually made of

Over the same 961 messages the shipped rules produce:

```
  parsed                       703
    category resolved          445
    'other' on purpose         141   (brokerage, card settlement, own transfer)
    'other' by fall-through    117   <-- categorisation gap
  refused                      258
    refused with a reason       85   (declined 30, security-challenge 29,
                                      preauthorisation 14, pending 8,
                                      card-lifecycle 3, returned-unpaid 1)
    refused silently           173
      ...of which money-shaped  96
```

The 96 money-shaped silent refusals look like the parsing gap and mostly are
not. Reading them: promotional copy (`GET 2 FOR 1! Spend AED250 …`), telco
credit offers, OTPs that name a purchase amount, future-dated notices
(`will be deposited … tomorrow`), and figures the bank itself redacted. Each
of those is a **deliberate** refusal. A model that "fixed" them would be
inventing money.

The 117 fall-throughs are 75 distinct merchant names, and they split roughly:

- **Card-only descriptors** (`Card •4821`, nine of them) — the message names no
  merchant. Nothing can categorise these.
- **Generic banking labels** — `Bank transfer`, `Outward remittance`,
  `Bill payment`, `Card purchase`, `Refund`, `Insurance premium`. Already
  correct as `other`, or fixable with a rule.
- **Person names** — `Ahmed Khalid`, `Mohammed Ali`, `Prasert On-puttha`. P2P
  transfers; `other` is the right answer.
- **Opaque POS descriptors** — `CXIANGHUI01L`, `Shathi Al Madeenah Tr`,
  `Al Nujom Al Thabeiah S`, `Fo Sharjah Corni`. Truncated and transliterated;
  the category is not recoverable from the string.
- **Genuinely knowable brands** — `Ziina`, `Emaar Properties`, `Paypal`,
  `Opensooq`, `Phuket Delight`, `Aromaya`, `Phoneinn`. Roughly 20–25 names.

Only the last group is a real gap, it is a *knowledge* gap rather than a
parsing gap, and a merchant lookup table closes it without a model.

## What this means for a model proposal

The evidence says the extraction layer is not where the remaining loss is, and
that the dangerous direction is a candidate that reads *more* messages rather
than fewer. Any proposal should therefore be evaluated on:

- `posts-where-rules-refuse` at or near zero on the 961-message corpus;
- no regression on the 1,249 pinned fields across the two labelled corpora;
- p95 and max inside the 25 ms budget, measured on target hardware rather than
  a laptop, and 5,000 messages inside 1,500 ms;
- bundle size and cold-start cost, which this harness does not measure and
  which decide whether an on-device runtime is viable in an Expo app at all;
- the privacy position in `AGENTS.md` — bank message bodies do not leave the
  device, which rules out a hosted model for the parsing path regardless of
  its accuracy.

A candidate that improves only the category label should be scored as such and
compared against the cheaper alternative (a merchant table), not against the
parser.

### Measured: CUA-S1 (`trycua/cua`)

Asked and answered with numbers rather than argument. The released
`cua-ai/cua-s1-forms` checkpoint (706,048 parameters, 2.8 MB, 224-token
context) was scored zero-shot on the same 188 labelled global alert rows used
above. Reproduce with `validation/cua-s1-wafra-benchmark.py` on the
`research/cua-s1-wafra-benchmark` branch. Note that the CI run of the paired
domain-adaptation script fails before it trains: the Hugging Face repo ships
`cua-s1-forms.safetensors`, while `cua-s1-wafra-finetune.py` hands the
directory to `load_checkpoint`, which looks for `model.safetensors`. Pass the
`.safetensors` file directly. The benchmark script above is unaffected — its
`discover_checkpoint` helper resolves the real filename.

| Field | Choices | CUA-S1 zero-shot | Shipped rules |
| --- | --- | --- | --- |
| decision | 2 | 91/188 — **48.4%** | 100% |
| status | 5 | 19/188 — **10.1%** | 100% |
| family | 11 | 16/188 — **8.5%** | 100% |
| direction | 3 | 54/188 — **28.7%** | 100% |

`decision` is a two-way choice, so 48.4% is below chance. Mean confidence on
that field was 0.885 and it was wrong with high confidence on **83 of 188** —
a calibration failure, not just an accuracy one. An engine that is confidently
wrong is worse than one that abstains, because the review tray cannot tell
which rows to doubt.

Amount disambiguation scored 0/0: of 188 messages, 72 produced no amount
candidate and 116 produced exactly one, so there was never a choice to make.
That is the architectural point. CUA-S1 scores a fixed list of options against
a context — it selects, it does not extract. Every amount, currency, merchant
and date in a Wafra alert would still have to be found by the regex layer
before the model could rank anything, which leaves the model unable to address
the part of the parser that carries money.

CPU latency was fine (median 2.5 ms, p95 2.8 ms). Latency was never the
problem.

### Why `trycua/cua` was never a fit

Independent of the scores: `trycua/cua` is a computer-use agent framework —
cloud Linux desktops, a desktop driver for macOS/Windows/Linux, and local
macOS VMs on Apple Silicon. CUA-S1 is its family of small **System 1** models
for bounded decisions over structured *interface* elements, driven from
screenshots and UI trees, in Python. There is no mobile target, nothing that
runs inside a React Native app, and no text-extraction model for message
bodies. Running it would put a desktop or cloud VM in the loop, which also
breaks the on-device privacy position.

### Other runtimes considered

| Option | Verdict |
| --- | --- |
| **Locally AI** | A consumer iOS/macOS app for chatting with local models. No SDK, nothing embeddable in Wafra. |
| **LocalAI** (localai.io) | A self-hosted OpenAI-compatible *server*. Runs on a machine, not inside a phone app; calling it means bank message bodies leave the device. |
| **classifier.dev / Jev** | Hosted Cloudflare Worker, classification only — no extraction. Useful the way Jev was already used here (offline, to harden rules and generate a merchant table), not as a runtime dependency. |
| **Gemma 4 E2B** | The only viable on-device candidate. Edge-optimised, LiteRT-LM builds exist, fits a phone where E4B does not. |

### The latency ceiling for any on-device LLM

The shipped rules read 5,000 messages in ~1.07 s — 0.21 ms each. An on-device
LLM needs roughly 0.5–2 s per message, which turns the same import into 40
minutes to 3 hours. No amount of accuracy fixes a three-order-of-magnitude
regression on the import path.

This is a constraint on *where* a model can sit, not on whether one is worth
having. A model cannot be the import-path parser. It can run in the background
over the ~375 messages the rules leave unresolved (258 refused plus 117
uncategorised), which at 1 s each is a single ~6-minute pass.

If an on-device model is still wanted, the runtime question (ExecuTorch, ONNX
Runtime Mobile, MediaPipe/LiteRT-LM, llama.cpp via a native module, or Apple's
on-device Foundation Models on iOS 26+) is a separate decision from the
accuracy question, and this harness answers only the second.
