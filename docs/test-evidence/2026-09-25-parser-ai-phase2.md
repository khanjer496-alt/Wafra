# Parser AI — phase 2 (2026-09-25/26)

Metrics only; no message text. Harness: `scripts/parser-ai/`. Every model reading is scored
through the shipped deterministic gate `gateAiAlert` (`src/lib/ai-alert-extractor.ts`) with
language gates forced open for measurement. In the app every language gate is OFF and
auto-post is OFF. "Hybrid" = current rules first, AI post only where rules did not post.
Private UAE rows are scored with the sender dropped (the shipped reader never runs for AE/SA);
they measure model agreement only.

## Data (A)

- `synth/generate-v2.cjs` + `lexicon.cjs`: 11 languages × 18 events, **≥31 templates per
  language × event** (8,730 templates, 22,298 rows) from 9 authors: sentence, formal,
  field-list, pipe, key=value, terse DR/CR, emoji, mixed-script (AR/Hinglish with English
  labels), and `push` (app-notification cards), which is **held out entirely**. Direction
  cues are marked in every language. Gulf spellings (درهم, د.إ, Dhs/DHS, ريال, ر.س, رس, SR,
  QR, RO, BD) and QA/OM/BH users are covered. Balance and available-limit figures appear as
  BAL distractors. Splits are by template family (train 4,838 / dev 1,164 / test 1,893
  templates) plus the held-out author (835).
- **Public real samples (I):** 188 alerts published on the web, 18 countries, evaluation
  only.
  - 23 are redistributable (bank and regulator pages, one MIT repo) and are committed in
    `scripts/test/fixtures/public-real-samples.js` with their URLs.
  - 165 stay local-only because the source licence is missing or unclear, or they are
    complaint/news pastes. They load through `PARSER_AI_PUBLIC_LOCAL`.
  - No ZA samples. ES/FR/DE/MX/GB are mostly scam texts, which serve as negatives.

## Zero-shot LLMs (J)

Apple M1 with 8 GB.

- **Apple Foundation Models:** the framework is present on macOS 26.1 but reports
  `deviceNotEligible` (M1), so it was not measurable here.
- **Setup:** llama.cpp with Metal, JSON-schema output, zero-shot, temperature 0.
- **Sets:** 250-row stratified sample of the phase-1 held-out synthetic test (`syn`), all 353
  repo fixtures (`repo`), all 188 public real samples (`pub`), and a 250-row private UAE
  sample (`uae`). Qwen2.5-3B was run on 150 rows per set.

| Model (Q4_K_M) | Size | Peak RSS | p50 latency | syn AI recall / FP | repo AI / FP | pub AI / FP / posted precision | pub hybrid recall | Direction right when read (repo / pub) |
|---|---|---|---|---|---|---|---|---|
| Qwen2.5-1.5B | 1.12 GB | 0.5–1.2 GB | 2.2–4.5 s | 38.0% / 0 | 51.8% / 0 | 40.3% / 2.9% / 92.0% | 56.3% | 65% / 53% |
| Gemma-3-1B | 0.81 GB | 1.0 GB | 2.2 s | 45.1% / 0 | 34.0% / 0.6% | 37.8% / 1.5% / 93.5% | 55.5% | 45% / 51% |
| Qwen3-1.7B (no thinking) | 1.11 GB | 1.4 GB | 2.5–3.8 s | 52.1% / 0 | 64.5% / 1.9% | 59.7% / 2.9% / 89.0% | 69.8% | 90% / 89% |
| Qwen2.5-3B (150 rows) | 2.10 GB | 2.2 GB | 3.0–3.7 s | 44.2% / 0 | 51.4% / 0 | 45.4% / 3.8% / 87.0% | 66.0% | 80% / 68% |
| **Tagger v1 (31.6 MB int8)** | 32.7 MB | ~60 MB | **8–15 ms** | 32.6% / 0 | 16.2% / 0 | 7.6% / 0 / 100% | 28.6% | 97% / 91% |
| Rules today | — | — | <1 ms | 14.1% (full 3,150: 13.9%) | 63.5% / 0 | 25.2% / 1.5% / 90.3% | — | — |

- **Amounts:** when the gate grounds an LLM amount it is right 90–100% of the time.
- **Weak field:** LLM *direction* is the weak field. Under 1.7B it is close to a coin flip; on
  the private UAE sample the LLMs read direction right on only 26–61% of rows.
- **False posts:** the gate holds them to 0–1.9% on synthetic and repo data, but not on real
  public text (1.5–3.8%).
- **Qwen3-1.7B** is the best small LLM.
  - It is +16 points of hybrid recall on public real samples versus the tagger.
  - It costs 1.1 GB and about 3 s per alert on an M1.
  - It does not meet the 0.3% false-post bar on real text.

## Tagger v1 (B)

- **Model:** pruned multilingual-E5-small (22.9k-piece vocabulary), a word-level BIO head
  (AMT CUR MER DATE BAL CUE_DEBIT CUE_CREDIT CUE_NONPOST), and status/family/direction heads,
  with direction loss ×1.5. The Ask intent and slot heads are in the same graph.
- **Training:** 9,000 v2 train rows plus 4,854 Ask questions, 3 epochs, 56 minutes on MPS.
- **Calibration:** per-head temperatures fitted on dev.
- **Export:** ONNX int8, 31.6 MB. Latency is 8 ms p50 / 13 ms p95 on one CPU thread.
- **Tokenizer parity:** JS `@huggingface/tokenizers` versus Python matches on all 11,740
  distinct eval words (0 mismatches). The word splitter's parity is pinned by a test.
- **Operating point:** chosen on dev as the loosest grid point with zero false posts
  (threshold 0.97).

| Held-out set | Rules recall | AI post recall | AI false posts | AI posted fully correct | Hybrid recall | Prefill: rules-missed rows read | Prefill amount+currency right | Prefill direction right |
|---|---|---|---|---|---|---|---|---|
| v2 unseen templates (3,786) | 6.0% | 26.8% | **0.07%** (1) | **99.84%** | 31.3% | 89.9% | 99.9% | 98.1% |
| v2 held-out author (1,670) | 5.2% | 14.9% | 0 | 100% | 19.9% | 79.4% | 100% | 99.5% |
| Phase-1 templates (3,150) | 13.9% | 32.6% | 0 | 100% | 42.3% | 85.9% | 99.9% | 94.9% |
| Repo fixtures (353) | 63.5% | 16.2% | 0 | 100% | 67.5% | 76.4% | 100% | 98.2% |
| Public real (188) | 25.2% | 7.6% | 0 | 100% | 28.6% | 42.7% | 100% | 86.8% |

- **Target check:** on held-out templates the target of ≤0.3% false posts and ≥98% fully
  correct posted rows is met. Coverage at that operating point is 27% (unseen templates) and
  15% (unseen author).
- **Looser threshold (0.90):** coverage rises to 48% / 37%, but false posts rise to 0.36% on
  unseen templates.
- **Real text:** the tagger generalises poorly (7.6% AI recall on public samples) because it
  was trained on synthetic data only.
- **Private UAE agreement (16,544 rows):** the gate would read 70.7% of should-post rows, with
  amount+currency agreeing 100% and direction 97.2%. AI false posts on UAE weak negatives: 0.
- **Ask (F), test split (1,070):**
  - The rules understand 14.7% (English only). At intentP ≥ 0.95 the model reaches 53.4%
    intent and 48.3% slots, with 1.5% wrong tool and 100% out-of-scope refused.
  - At ≥ 0.8 the model reaches 64.8% with 3.6% wrong tool.
  - The rules' own wrong-tool rate is 0.3%, so the ship-gate ("no more wrong tools than
    today") is **not met**, and Ask stays unwired.

## Verifier (G)

`ai-alert-verifier.ts`, default thresholds 0.995 / 0.97 / 0.99.

- **Injected errors on synthetic:**
  - Amount and currency errors are caught 93–94% of the time, direction errors 18%, and
    non-posting-as-posted 0%.
  - False flags on correct readings are 0.08%.
- **Real data:**
  - On private UAE (14,611 rules-posted rows) it flags 0.24% (all direction), and **none of
    the 235 rule/ledger disagreements**.
  - On repo, public and synthetic rule posts it flags 0 and catches none of the known false
    posts.
- **Looser thresholds (0.9 / 0.9 / 0.95):** 94% of non-posting and 79% of direction errors
  are caught on synthetic, but the UAE flag rate rises to 1.2% with 0% flag precision.
- **Verdict:** keep it OFF.

## Learned formats (H)

`learned-alert-formats.ts`; synthetic, per template.

- **After 1 confirmation:** Review prefill on 21% (v1) / 43% (v2) of later same-template
  messages, 100% field precision.
- **After 2 confirmations:** auto-post on 8% / 24%, prefill+post coverage 34% / 62%, 100%
  precision.
- **False matches:** 0 across 1.4M+ comparisons against non-posting messages.
- **Why coverage is low:** v1's randomised bank prefixes and footers create new "shapes".
  Exact-shape repeats match 99–100%.
- **Status:** not wired into Review/Settings yet.

## Categories (D)

Brand table, applied only after every rule returned "unresolved" and only for an explicit
non-AE/SA market.

- **691-merchant set:** 35.8% → 93.3%. This is not a clean holdout, because the table author
  saw the set.
- **New 810-descriptor set:** 23.1% → 79.5%, with precision-when-resolved 91.7%.
- **Look-alike errors:** 11.2% false categorisation on deliberate look-alikes of
  country-gated short names, and 0 on plain unknown merchants.
- **Unchanged:** zero changes to rows the rules already categorised, and AE/SA are
  unchanged.

## Corpus identity (flags OFF, no model)

`corpus-snapshot.cjs` compared origin/main 46c4d2ca with this branch over 25,691 rows:

- repo fixtures, phase-1 test, v2 test and author, public real, and private UAE;
- **25,691 identical, 0 changed** (15,289 posted on both);
- the Review-prefill path is inert without a downloaded model, so no ledger rows are added.

## Recommendation for "any SMS"

1. **Rules** first. They are authoritative and unchanged for AE/SA.
2. **Per-user learned formats** (H): deterministic, 100% precise, closes the long tail per
   user after 1–2 confirmations. This is the highest-precision path to "UAE-level" accuracy
   for an unknown bank.
3. **Platform LLM** where available: Apple Foundation Models on A17 Pro/M-class devices,
   Gemini Nano on Android. Use it as a **Review prefill only**, through the same gate; its
   direction must be cue-backed. A 1–2B open model is too large (1–2 GB) and slow (~3 s) to
   bundle.
4. **Tagger** (32.7 MB, 10 ms) as the fallback prefill everywhere. Auto-post stays OFF until
   a language passes ≥500 labelled real messages.
5. **Next data step:** consented real samples. Synthetic-only training reaches 99.8%
   precision on synthetic but only 7.6% recall on real public alerts.
