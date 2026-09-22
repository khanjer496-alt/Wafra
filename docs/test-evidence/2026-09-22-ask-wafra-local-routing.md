# Ask Wafra local intent routing — first held-out measurement

Date: 2026-09-22
Branch: `claude/sms-notification-parser-model-rs8603`
Encoder: `e5-arb-32768@e1b3907e6c83#int8-70fd5ee627d2`, the pinned
`local-ai-e5-v1` release artifacts, SHA-256 verified against the constants in
`src/lib/local-semantic-runtime.native.ts`
Reproduce: `npm run eval:assistant-routing -- --model <dir>`

The encoder ran under `onnxruntime-web` on x86 rather than
`onnxruntime-react-native` on the phone. Same graph and the same INT8 weights,
but the arithmetic is not bit-identical, so treat scores as good to about 1e-3.
Latency here (~12 ms) is not a device figure; build 332 measured the device
runtime separately.

## What was measured

Two corpora, both held out by construction, and the evaluation asserts the
holdout before it scores anything:

| corpus | rows | |
| --- | --- | --- |
| in scope | 75 | 22 tools, English / Arabic / Arabizi, worded differently from every anchor |
| out of scope | 52 | must not route; 32 of them adversarial, in a financial register |

Scoring an index against the anchors it was built from measures nothing — every
anchor is its own nearest neighbour at cosine 1.0. `assistant-routing-eval.mjs`
therefore compares the held-out rows against `assistant-anchors.js` and exits
non-zero if a single one leaked.

It runs the shipping path, not a model of it: the real deterministic planner
decides first, `chooseLocalSemanticAssistantPlan` is consulted only where the
planner fell back to plain help, `LOCAL_SEMANTIC_REGISTRY` resolves the
prototype, `isAssistantToolRequest` validates the compiled request, and
`executeAssistantTool` produces the answer.

## Result

```
  index                     211 prototypes over 22 intents
  gate                      score >= 0.72, margin >= 0.04

In scope (75)
  answered deterministically, correct tool        2
  reached the local model                        62  (82.7%)
    routed, correct tool                          8
    routed, WRONG tool                            0
    refused -> clarification                     54

Out of scope (52)
  refused (correct)                              37  (71.2%)
  ROUTED (wrong)                                  0
```

**0 wrong routes and 0 out-of-scope routes.** That is the number that decides
anything: a refusal costs the user a rephrase, while a wrong tool spends their
attention on a correct calculation of something they never asked about, and
reads like an answer.

The 2/75 deterministic figure is not the app's accuracy. This corpus was written
to be awkward for the rules on purpose — that is what makes it a measurement of
the fallback. `scripts/test/wafra-assistant.test.js` covers ordinary phrasing.

## The two gates are nothing alike

`minimumScore` is inert and cannot be made useful:

| | min | median | max |
| --- | --- | --- | --- |
| in scope | 0.817 | 0.910 | 0.987 |
| out of scope | 0.816 | 0.897 | 0.938 |

The distributions overlap almost entirely. "what is the weather in dubai
tomorrow" scores 0.87 against a financial intent, and the worst out-of-scope
score (0.938) is higher than the best in-scope one is low (0.817), so any
threshold above 0.817 discards correct routes without blocking one wrong route.
It stays at 0.72 as a floor against a degenerate vector, not as a relevance test.

`minimumMargin` does all the work. Ungated top-1 is only 32/57; the margin
discards very nearly the set the retriever gets wrong:

| margin | routed | correct | wrong | out-of-scope leaks |
| --- | --- | --- | --- | --- |
| 0.08 | 2 | 2 | 0 | 0 |
| 0.05 | 4 | 4 | 0 | 0 |
| **0.04** | **9** | **9** | **0** | **0** |
| 0.03 | 11 | 11 | 0 | 0 |
| 0.02 | 15 | 15 | 0 | 2 |
| 0.01 | 28 | 22 | 6 | 5 |
| 0.00 | 57 | 32 | 25 | 35 |

(Sweep run on a smaller ledger fixture than the end-to-end table, which changes
which rows the deterministic planner answers first; the shape is what matters.)

So the margin is not a confidence score. It asks whether the nearest two intents
are distinguishable at all, and on this corpus that tracks correctness closely.

**0.08 was calibrated for ten registered intents.** At twenty-two the space is
denser and 0.08 routes almost nothing, so the index expansion is worth nothing
without the threshold change and the threshold change is unjustified without the
index. They are one change.

**0.04 rather than 0.03** because of the headroom. The worst out-of-scope margin
observed is 0.027: `احذف كل معاملاتي` ("delete all my transactions") landing on
`money-review`, which is the vaguest intent and therefore the sink for any
imperative — `increase my credit limit` goes the same way at 0.018. Tripling the
out-of-scope corpus with 32 adversarial rows in a financial register ("can i
afford a car", "set me a budget for dining", "why is my balance wrong", "how
much did my friend spend") did not move that tail at all. 0.04 sits about half
again above a tail measured by trying to break it; 0.03 sat 0.003 above it. Two
routes are the price.

Nothing routed can move money or records. Every prototype maps to a read-only
tool in `ASSISTANT_TOOL_CATALOG` and the compiled request must pass
`isAssistantToolRequest`, so a leak is a wrong answer, never a wrong action.
`scripts/test/local-semantic-routing.test.js` pins that, the threshold values
and both gate boundaries, and runs in CI without the 35 MB encoder.

## Where the fallback actually earns its place

The anchors and the deterministic planner, 246 phrasings, counted by script:

| register | reaches the model | |
| --- | --- | --- |
| English | 76 / 157 | 48% |
| Arabic | 78 / 78 | **100%** |
| Arabizi | 11 / 11 | 100% (0 / 11 before the fix below) |

The deterministic planner reads **none** of the Arabic. That is where a
multilingual encoder is not competing with the rules — it is covering a register
the rules cannot read at all.

### Arabizi was structurally locked out, by one character

`planAssistantQuestion` refuses a question carrying an amount or a date it will
not guess about, and marks that clarification as understood-in-part rather than
unrecognised — so `isExactPlainHelp` correctly keeps it away from the model,
because routing it to a default-period tool would silently drop the constraint.

But Arabizi spells Arabic letters as digits: 2 for ء, 3 for ع, 5 for خ, 6 for ط,
7 for ح. So `dafa3t`, `in5asam` and `3ala` contain no number at all, and every
Arabizi question hit that guard and was held back from the one model that can
read it. Measured: `hal dafat el faatura` reached the model and
`hal dafa3t el faatura` did not.

The fix changes the eligibility flag only, and only when the digits were the
sole reason to refuse and every one of them was a letter. A token counts as
Arabizi when it is built solely from ASCII letters and those five digits and
holds at least one of each — so `aed500`, `card4110`, `2026`, `15 august` and
`top 3 merchants` all behave exactly as before, verified case by case. The
clarification text does not move.

This removes a lockout; it does not yet add an answer. All five newly eligible
Arabizi rows now refuse on low margin instead of never being seen, which is why
correct routes stayed at 8. Without it, every future improvement to Arabic and
Arabizi anchors would have been dead on arrival.

## Two defects the measurement found

**1 · The cash anchors pointed at the wrong tool.** Every phrasing in that group
asks about money taken out of an ATM — "how much cash did I withdraw",
"كم سحبت نقداً". That is the `cash-withdrawal` *category*, not the `cash-outflow`
tool, which totals everything that left the accounts including repayments and
transfers. Pointing them at `cash-outflow` returned a larger, unrelated number
with full confidence: the routing was certain and the arithmetic was right for a
question nobody asked, which is the one failure a confidence gate cannot catch.
Retargeted to `category-breakdown` with a fixed `cash-withdrawal` category. It
was never registered, so nothing shipped.

**2 · Three intents can never have a prototype**, and saying so is the point.
`merchant-breakdown`, `category-breakdown` in general, and `obligation-status`
all refuse without an argument naming a specific thing — a merchant, an
arbitrary category, a card or bill. A prototype id cannot carry one, and the only
ways out are both wrong: invent the argument, or drop it and answer a broader
question. They now live in `anchors.argumentDependent`, written down and
deliberately unencoded, and `local-semantic-routing.test.js` asserts they stay
out of both the index and the registry.

Their Arabic phrasings name real recorded merchants (كارفور, أمازون) and real
categories (الطعام, المواصلات) that the English-only planner cannot read. That
is a vocabulary gap in `wafra-assistant.ts`, and an embedding cannot close it,
because the missing piece is the span of text to look up, not the intent.

## Registry

11 assistant intents to 23; the index 58 prototypes over 10 ids to 211 over 22.
Every one of the 23 compiles a request the production validator accepts in all
four period modes, and produces an answer rather than an exception — asserted
in CI.

Two new argument policies, both fully code-determined:
`default-period-typical-baseline` supplies the `baseline` that
`historical-baseline` refuses without (the anchored phrasings all ask the same
one: "is this normal for me", "كم أصرف عادة"), and `cash-withdrawal-category`
supplies the single category a question names without any lookup.

## Limits

- 211 prototypes against the retriever's own ceiling of 256, above which
  `createLocalSemanticRetriever` throws at construction and Ask Wafra loses the
  model entirely rather than degrading. Room for roughly four more intents at
  current size. Pinned by test.
- The index asset grew from 252 KiB to 685 KiB, bundled.
- No device measurement of routing yet. Build 332 established that the encoder
  loads and runs on a real phone; these routes have not been exercised there.
- The out-of-scope tail rests on 37 rows that reach the retriever. It did not
  move when the corpus tripled, which is evidence, not proof.
