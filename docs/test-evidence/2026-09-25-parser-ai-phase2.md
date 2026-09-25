# Parser AI — phase 2 (2026-09-25) — INTERIM

Metrics only; no message text. Harness: `scripts/parser-ai/`. Everything scored through the
shipped deterministic gate `src/lib/ai-alert-extractor.ts` (`gateAiAlert`), with language
gates forced open for measurement (in the app they are all OFF).

## J. Zero-shot LLM extraction (first results)

Machine: Apple M1, 8 GB. Apple Foundation Models: framework present on macOS 26.1 but
`deviceNotEligible` (M1) — not measurable here. LLMs via llama.cpp (Metal), JSON-schema
constrained, zero-shot, temperature 0. Sets: 250-row stratified sample of the phase-1
held-out synthetic test (`synthS`), all 353 repo fixtures (`repo`), 250-row stratified
private UAE sample (`uaeS`, sender dropped so the gate reads it; aggregates only).

| Model (Q4_K_M) | Size | Peak RSS | p50 / p95 latency | Set | AI-post recall | False posts | Posted precision | Hybrid recall (rules → AI) |
|---|---|---|---|---|---|---|---|---|
| Qwen2.5-1.5B-Instruct | 1.12 GB | 484 MB | 4.1–4.5 s / 5.9–6.6 s | synthS | 38.0% | 0 | 100% | 47.9% (rules 14.1%) |
| | | | | repo | 51.3% | 0 | 100% | 76.7% (rules 63.5%) |
| | | | 2.1 s / 4.0 s | uaeS | 12.6% | 0 | 100% | — |
| Gemma-3-1B-it | 0.81 GB | 1,055 MB | 2.2 s / 2.5 s | synthS | 45.1% | 0 | 100% | 52.1% |
| | | | | repo | 33.5% | 1 (0.64%) | 98.5% | 75.1% |
| | | | | uaeS | 28.6% | 1 (1.3%) | 98.0% | — |
| Qwen3-1.7B | 1.11 GB | 1,453 MB | — | all | first run failed: thinking mode consumed the token budget; re-run pending with thinking disabled |

Observations: the gate keeps LLM false posts at 0–1.3% but LLM **direction** is the weak
field (on rules-missed should-post rows the prefill direction is right only 44–55%); amounts
are right whenever grounded (100%). Latency is 2–6 s per alert on this Mac — ~300× the
31 MB tagger. A cue-lexicon bug found on the UAE set (`Cr` in "Cr Card"/"Cr limit" read as a
credit cue, 2,146 debit rows) is fixed.

## Corpus identity (flags OFF)

`corpus-snapshot.cjs` base (5d3b3039) vs head over 25,691 rows (repo fixtures, phase-1
synthetic test, v2 test + held-out author, public real samples, private UAE):
**25,691 identical, 0 changed.**

_Tagger (B), learned formats (H), public real set (I), verifier (G), Ask (F) and categories (D)
numbers follow in the final version of this file._
