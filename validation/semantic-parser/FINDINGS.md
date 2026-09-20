# Findings — local semantic parser on real ArBanking77 dialect holdouts

Seed `20260920`, mapping `2026-09-20.1`. Every number below came from a run
recorded in `results/`. Nothing here is integrated into the app, and no
acceptance gate is claimed as met.

## Summary

1. A compact model trained on real MSA+Palestinian data is **roughly twice as
   accurate** as the hand-written Arabic lexicon the previous round measured,
   on the same Saudi and Moroccan populations.
2. **Model size is not the constraint.** 64,429 parameters in 0.26 MB gets
   within 2 points of everything larger.
3. **Independent semantic agreement does not work as a safety mechanism.** Two
   models trained on the same corpus agree 99.9–100% of the time at high
   confidence, including on every case where the first one is confidently
   wrong.
4. **Dialect shift costs about 15 points of joint accuracy per step**, and no
   representation choice recovers more than ~1.2 of them.
5. **Thresholds tuned in-domain do not hold out-of-domain.** The confidence
   gate that gives 65.6% safe coverage with zero unsafe imports on validation
   gives 27.0% coverage and **3 unsafe imports** on Saudi.
6. The deterministic layer is what actually produces zero unsafe imports —
   and on real bank-alert formats it reaches **0 unsafe / 0 decoy picks /
   95.0% exact coverage**.

The architecture this supports is **deterministic-first**: exact extraction
authorizes an import, and the semantic model narrows and routes. That is close
to the handoff's hybrid, with one half of the proposed safety design removed
because it was measured and does not work.

## 1. The data is real and the holdouts are clean

`SinaLab/ArBanking77`, from the git checkout. The Hugging Face mirror carries
only ~1k-row sample CSVs and **no dialect test sets at all**, which is most
likely what the previous round hit.

Normalized exact overlap with the training split: val 0.00%, MSA 0.00%,
PAL 0.00%, Saudi 0.03% (1 row), Moroccan 0.06% (2 rows), Tunisian 0.00%.

The high-risk subset sizes reproduce the handoff's recorded populations
exactly — Saudi 626, Moroccan 624, Palestinian 675, Tunisian 64 — so the
comparison below is against the same utterances, not a re-scoped set.

## 2. Trained model vs. hand-written lexicon

High-risk subset, family / state / exact family+state. Lexicon numbers are
from `WAFRA_S1_RESEARCH_HANDOFF.md`; the model is `char-ngram-linear`
(`results/benchmark-main.json`).

| split | n | hand-written lexicon | trained char n-gram linear |
|---|---|---|---|
| Saudi | 626 | 72.20 / 49.52 / 48.24 | **83.07 / 80.35 / 76.68** |
| Moroccan | 624 | 57.53 / 33.97 / 32.53 | **75.96 / 70.67 / 66.35** |
| Tunisian | 64 | 75.00 / 34.38 / 28.13 | 29.69 / 48.44 / 26.56 |

Exact family+state roughly doubles on Saudi and Moroccan. **Handoff item 8 is
confirmed and extended**: a hand-written lexicon should not be the primary
semantic engine, and now there is a measured alternative that beats it.

Tunisian is bad either way. It is also the weakest evidence here: 64 high-risk
rows, and only 27 of the 77 intents appear in that test set at all.

## 3. Size and latency are not the constraint

Full test sets, `results/benchmark-main.json`.

| model | params | artifact | batch-1 p50 | Saudi joint (high-risk) |
|---|---|---|---|---|
| char-ngram-linear | — | 3.42 MB (int8 est.) | 1.13 ms | 76.68% |
| char-CNN | 396,685 | 1.59 MB | 1.90 ms | 77.32% |
| **char-CNN tiny** | **64,429** | **0.26 MB** | **1.00 ms** | **75.24%** |
| char-ngram-centroid | — | 12.76 MB | 10.24 ms | 63.90% |

A quarter-megabyte model gives up about 2 points against anything larger. If
this architecture ever ships, model size is not what will stop it.

## 4. Independent agreement is not a safety mechanism

The handoff proposed requiring deterministic evidence **and/or** independent
semantic agreement. The second half was measured
(`results/model-agreement-analysis.md`).

Pooled over all five test splits: for every case where the primary model is
wrong about `(family, state)` while reporting confidence ≥ 0.90, does a second
model disagree?

| primary | secondary | confident and wrong | caught | catch rate |
|---|---|---|---|---|
| linear | charcnn | 17 | 0 | 0.0% |
| linear | charcnn-tiny | 17 | 0 | 0.0% |
| linear | centroid | 17 | 1 | 5.9% |
| charcnn | centroid | 47 | 17 | 36.2% |
| charcnn-tiny | centroid | 39 | 11 | 28.2% |

These are not the same model — overall `(family, state)` agreement between
linear and charcnn falls from 94.2% on MSA to 56.1% on Tunisian. But at
confidence ≥ 0.90 they agree 99.9–100%, **including on all 17 cases where the
primary is confidently wrong**.

Models trained on the same corpus share their blind spots. When wording falls
outside what training covered, both fail, and both fail confidently. End to
end, the agreement policy is indistinguishable from confidence alone: Saudi
coverage 26.8% vs 27.0%, 3 unsafe auto-imports in both.

Genuine independence has to come from a different *kind* of evidence.

## 5. Gate policies on the sealed dialects

All thresholds selected on MSA+PAL val under one objective — zero unsafe
imports first, then maximum coverage (`results/gate-policies-main.json`).
Primary is `linear`.

| policy | val coverage | Saudi unsafe | Saudi coverage | Moroccan unsafe | Moroccan coverage |
|---|---|---|---|---|---|
| A confidence only | 65.6% | **3** | 27.0% | 0 | 19.5% |
| B deterministic veto | 36.8% | **0** | 15.6% | 0 | 10.5% |
| C independent agreement | 65.6% | **3** | 26.8% | 0 | 19.5% |
| D hybrid (B + C) | 36.8% | **0** | 15.6% | 0 | 10.5% |
| G agreement, different architecture | 34.8% | **0** | 14.6% | 0 | 10.3% |
| E ensemble + hybrid | 42.4% | **3** | 23.8% | **7** | 14.8% |
| F deterministic evidence required | 0.7% | **0** | 0.2% | 0 | 0.2% |

Readings:

- **B = D.** The deterministic veto does all the work in the hybrid; adding
  agreement changes nothing (see §4).
- **Averaging probabilities makes safety worse.** The ensemble produces 7
  unsafe auto-imports on Moroccan — more than any single model. Correlated
  errors become *more* confident when pooled. Do not ensemble for safety.
- **In-domain tuning does not transfer.** Policy A is clean on val at 65.6%
  coverage and produces 3 unsafe imports on Saudi at 27.0%. A threshold is a
  property of the distribution it was fitted on.
- **Policy F is the honest one.** Requiring an exactly extracted amount whose
  role is unambiguous refuses essentially all 15,534 dialect utterances. That
  is correct: none of them is a bank alert. It is also the only policy whose
  safety does not depend on the semantic model being right.
- Palestinian still shows 1 unsafe under B/D/G. Even the veto is not
  categorically safe.

**No configuration reaches the acceptance gate.** The target is 0 unsafe at
≥90% coverage. The best zero-unsafe policy reaches 15.6% on Saudi.

## 6. Calibration degrades exactly with dialect distance

`results/benchmark-main.json`, char-ngram-linear, full test sets.

| split | ECE | Brier | confidence ≥ 0.90 and wrong |
|---|---|---|---|
| MSA | 0.141 | 0.090 | 5 / 3,574 |
| PAL | 0.154 | 0.104 | 2 / 3,807 |
| Saudi | 0.212 | 0.180 | 7 / 3,580 |
| Moroccan | 0.254 | 0.222 | 3 / 3,574 |
| Tunisian | 0.233 | 0.241 | 0 / 999 |

Expected calibration error nearly doubles from MSA to Moroccan, and
confidently-wrong predictions occur on every held-out dialect. The char-CNN is
better calibrated overall (ECE 0.104 MSA) but produces *more* confident errors
(18 on Saudi).

**Handoff item: confirmed.** Confidence cannot be the only safety mechanism,
and a raw probability should not be shown to a user.

## 7. How much of the gap is representation?

Tuning for dialect robustness has nowhere honest to look: MSA+PAL val is the
same two dialects the model trained on, and using the sealed sets would end
their usefulness. `Banking77_full_corpus.csv` keeps the MSA and Palestinian
rendering of each source question in separate columns, so the training pool
splits into 10,729 MSA and 10,820 Palestinian rows (17 unmatched). Fit on one,
measure on the other — entirely inside the fitting pool
(`results/dialect-shift-dev-v1.json`).

| variant | MSA→PAL joint | PAL→MSA joint | in-dialect control |
|---|---|---|---|
| **fold + augment** | **0.8021** | **0.8276** | 0.9395 |
| fold orthography | 0.7994 | 0.8247 | 0.9330 |
| fold + char + word + augment | 0.7978 | 0.8172 | 0.9338 |
| fold, char 3–6 | 0.7924 | 0.8173 | 0.9338 |
| baseline char 2–5 | 0.7904 | 0.8180 | 0.9370 |
| fold + char + word | 0.7889 | 0.8106 | 0.9379 |
| char + word | 0.7763 | 0.8053 | 0.9338 |

Two things:

- **Word n-grams hurt transfer** (−1.41pt) while helping in-dialect accuracy.
  A word is a dialect-specific object; a character n-gram is less so.
- The gap being fought over is small. **In-dialect 0.9370 → one dialect step
  0.7904 is a 15-point fall**, between the two *closest* dialects, both in the
  same banking domain. The best representation choice recovers 1.2 of those 15
  points.

This is not a feature-engineering problem.

## 8. Deterministic extraction is where the safety actually is

199 rows from Wafra's own bank-alert fixture corpus across 14 markets —
privacy-safe near-real templates and standard-derived reconstructions, not
consented customer evidence (`results/amount-role-deterministic.json`).

| metric | result |
|---|---|
| amounts selected | 189 / 199 |
| **unsafe selections** | **0** |
| **decoy amounts picked** (balance / limit / statement / minimum-due) | **0** |
| exact amount + currency coverage | **95.0%** |
| decoy-present subset | 34 rows, 25 selected, 0 unsafe |
| latency | 0.08 ms mean, 0.19 ms max |

The 10 abstentions are 8 statement/minimum-due rows and 2 multi-currency FX
rows. All of those should abstain.

Getting here required real fixes, each caught by the corpus rather than
assumed:

- **Arabic-Indic decimal separators.** `١٢٫٣٤٥` KWD was read as 12.000.
- **Locale-aware grouping.** `14,671.30` is US, `1.240,60` is European,
  `1 240,60` uses a space. `12.345` in a three-decimal currency is 12.345, but
  `12,345` in one is genuinely ambiguous — that case now abstains rather than
  guessing.
- **Hamza-insensitive currency abbreviations.** `د.أ` was not matching JOD, so
  amounts came out 100× wrong.
- **Clause-scoped, nearest-marker role assignment.** A 42-character context
  window let *balance* from the next sentence mark a purchase amount.
- **Identifier digit masking.** `Card No XXXX4711 AED 76.50` was yielding
  4711.00 AED.
- **Multi-currency abstention.** An FX alert quotes billed and settled
  amounts; nothing in the body says which one the ledger uses.
- **Family-conditioned roles.** A fee alert's fee *is* the transaction; a
  purchase alert's fee line is not. This alone moved coverage from 73.9% to
  84.4%.

## What this means for the architecture

The handoff's hybrid was close. One change:

```
raw SMS / notification
  -> deterministic normalization + exact candidate extraction
  -> deterministic amount-role selection            <- authorizes
  -> local semantic model (family / direction / state)  <- narrows and routes
  -> auditable marker veto
  -> auto-import | review | refuse
```

The semantic model does not authorize an import. It chooses the family that
the amount-role rule is conditioned on, it routes non-posting events to
refuse, and it supplies the review card's proposal. An auto-import needs an
exactly extracted amount with an unambiguous role. Where that evidence is
absent, the answer is review — which is what should happen to genuinely novel
wording, and what §5 policy F does.

Drop "independent semantic agreement" from the safety design. It was measured
and it does not catch confident errors (§4). Keep the phrase "deterministic
financial evidence"; drop the "and/or".

## What is still not done

- **No consented real-world holdout.** Both corpora here are proxies:
  ArBanking77 is customer questions rather than bank alerts, and the Wafra
  fixtures are near-real templates. Neither can close the acceptance gate.
- **No comparison against the production deterministic parser.** "No
  regression versus current deterministic parser" is a stated gate and it has
  not been measured. It needs `scripts/test/build.sh` and a harness that runs
  `parseSms` over the same corpus.
- **Pretrained encoder results** — see `results/benchmark-robust.json` once
  that run lands.
- **Tunisian remains unexplained.** 64 high-risk rows is too little evidence
  to act on, and the trained model is worse than the lexicon on family there.
