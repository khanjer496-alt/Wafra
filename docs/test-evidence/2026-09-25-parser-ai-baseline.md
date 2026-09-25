# Parser AI — phase 1 baseline and feasibility (2026-09-25)

Measured before building anything. Metrics only; no message text is recorded.
Full numbers: `2026-09-25-parser-ai-baseline.json`. Harness: `scripts/parser-ai/`.

## What was measured

- **Current pipeline** = `createLaunchAlertSession` called the way `historical-import.ts`
  calls it (AE/SA or unrouted → `parse`, foreign issuer/route → `parseUnproven`), best-effort
  auto-post ON, ledger pinned to the user's local currency, a rate-1 FX stub (a missing cached
  rate is never the reason for a refusal). Plus the structured reader `inspectUniversalBankEvent`
  (feeds Review) for per-field extraction.
- **Repo fixtures (353 rows)**: global-alert-formats, public-alert-evidence, UAE/Saudi formats,
  universal-evidence independent/public/round-2 holdout, local-ai-bank-v2. Labels = each
  fixture's TRUE expectation (never its `knownGap`).
- **Synthetic held-out (3,150 rows)**: `synth/generate.cjs`, 323 templates, 11 languages
  (en, ar, es, pt, fr, de, it, nl, tr, id, hi-Latin), 31 countries, symbol ambiguity ($, Rs, R,
  N, درهم), decimal-comma / space / apostrophe / lakh / Arabic-Indic / zero-decimal IDR number
  styles, 17 date formats, hard negatives (OTP, pending, declined, promo, balance, statement,
  request, scheduled) and noisy footers ("never share your OTP"). **Split by template family**
  (105 test templates never seen in training) and merchant/person/biller names split likewise.
- Metrics: auto-post recall (should-post rows posted), false-post rate (non-posting rows posted),
  posted precision (amount + currency + direction all right), end-to-end row accuracy, and
  extraction accuracy per field.

## 1. Current parser

| Set | n | recall | false-post | precision | end-to-end | status | amount | merchant | date |
|---|---|---|---|---|---|---|---|---|---|
| Repo fixtures | 353 | 63.5% | 3.2% (5) | 95.4% | 77.9% | 84.1% | 83.5% | 84.6% | 83.3% |
| Synthetic held-out | 3,150 | **13.9%** | 0.12% (1) | 98.5% | 33.5% | 26.8% | 76.8% | 11.3% | 82.5% |

- It is **safe but narrow**: almost never posts a non-posting alert, and what it posts is right
  (amount 100% on correct posts), but on unseen wording it posts only 1 in 7 real movements.
- Recall by language (synthetic): en 28%, ar 40%, id 17%, it 13%, de 11%, es 10%, fr 10%,
  **pt 0%, nl 0%, tr 0%, hi-Latin 0%**. By country: AE 81%, SA 83%, IE 78%; IN 3%, ZA 5%,
  MX 7%, BR/PT/NL/TR 0%.
- Dominant refusal: `posting-status-unresolved` (1,616 of 1,989 misses) — completion vocabulary
  (Pix recebido, havale, abgehoben, "credit hue", "Pur", "DR/CR" field lists) is absent. Family
  is the weakest field: transfer 0.6%, salary 0%, bill-payment 0% extraction accuracy.
- Known hard case: a posted alert with a "never share your OTP" footer is read as authentication.
- The 5 repo false posts are all AE-country `local-ai-bank-v2` synthetic rows with no sender
  (statement, pending Arabic purchase, two multi-event rows, a corrected-amount row) posted by
  the mature Gulf grammar — worth a focused sms-parser review.

## 2. Private real-UAE benchmark (owner export, weak labels)

30,213 messages; 14,685 joined uniquely to ledger rows by capture timestamp. The ledger is an
earlier parser's output plus owner edits, so this is regression/acceptance, not independent truth.

- Current parser vs ledger: recall 99.5%, amount 100%, direction 98.4%, category 95.4%
  (largest drift: 460 rows now `loan` that the ledger has as `shopping`), merchant 78.8% strict,
  transfer flag 79.9% (the ledger flag is also set by later transfer reconciliation).
- Weak negatives (unjoined money-bearing with clear cues): promo 1,342, declined 275, OTP 242 —
  **0 posted**. Of 3,994 other unjoined money-bearing messages, 58 would now be posted.
- UAE is solved by rules; any AI must not regress it (see hybrid below).

## 3. Model feasibility probe

Multilingual E5-small (same backbone as the app's E5 work) vocabulary-pruned to 22,905
pieces (top-20k + training-split pieces; test text never consulted), token-tagging head
(AMT, CUR, MER, DATE, BAL, debit/credit/non-posting cues) + status/family/direction heads.
Trained on the synthetic train split only: 5,088 rows, 4 epochs, **4.6 min** on this Mac (MPS).
Exported ONNX, dynamic int8: **30.9 MB** (fp32 121 MB), 30.4M params, **8.9 ms p50 /
13.7 ms p95** per alert on one CPU thread (mean 39 tokens). Scored from the int8 model.

Verification gate (deterministic): AMT span must parse with the currency's exponent; CUR span
must map to one ISO code (shared symbols only through the user's country); status completed;
direction consistent with family; single amount; plus the existing `hasNonCompletedWording`
guard ("modelGuard"). "Hybrid" = rules first, model only for what rules did not post.

| Set | Variant | recall | false-post | precision | end-to-end |
|---|---|---|---|---|---|
| Synthetic held-out | rules | 13.9% | 0.12% | 98.5% | 33.5% |
| | modelGuard | 72.1% | 1.43% | 81.5% | 69.5% |
| | hybrid | **74.8%** | 1.55% | 82.5% | 68.4% |
| | model + cue gate (strict) | 46.5% | 0% | 85.0% | 55.5% |
| Repo fixtures (other authors) | rules | 63.5% | 3.2% | 95.4% | 77.9% |
| | hybrid | **87.3%** | 3.9% | 94.4% | **89.8%** |
| Real UAE (weak) | rules | 99.5% | 0% | 98.4% | 98.1% |
| | modelGuard alone | 47.3% | 0% | 99.2% | 52.9% |
| | hybrid | 99.5% | 0% | 98.4% | 98.1% |

Extraction on synthetic held-out (model vs rules): status 85% vs 27%, amount 89% vs 77%,
merchant 83% vs 11%, date 98% vs 82%, family 56% vs 13%.

Where the model is wrong: **direction/family on unseen credit wording** (whole templates flip:
tr refund, pt/ar/en transfer-in, salary in en/es/fr) — precision TR 30%, NG 24%. On real UAE it
refuses rather than errs: 4,131 currency/amount unverified (Gulf spellings not in the tiny
synthetic set) and 3,234 competing amounts (balance tagged as amount). Posted rows remain 99%
precise. Both are data-coverage failures, not capacity failures.

## 4. Category classifier

691 labelled merchant descriptors (21 countries + global brands, 17 categories),
5-fold CV grouped by brand. Rules (`categorizeMerchant`): accuracy 35.8%, coverage 40.5%,
precision when resolved 87.9% (AE 98%, SA 88%, most EU/LatAm/Africa 5–25%). Char n-gram
logistic regression: 35.5% (unseen brand names carry no n-gram signal); rules-then-model
hybrid 53.0%. Brand knowledge — not a small classifier — is the gap.

## 5. Recommendation

**Yes, AI extraction plausibly beats the rules outside AE/SA** — 5× recall on unseen templates,
+24 pts recall on independently authored fixtures, within the size (31 MB) and latency (<15 ms)
budget — **but not yet shippable**: false-post 1.4–1.6% and precision 82% on held-out templates
exceed the bar (target ≤0.3% false-post, ≥98% posted precision). Ship only as the hybrid, with
rules authoritative for AE/SA and everything they already post.

Phase 2 plan:
1. **Data (the main gap).** ≥30 templates per language × event from many authors (not one
   generator); add Gulf spellings, field-list styles, multi-amount alerts (balance/limit decoys),
   credit-wording variety. Keep template-family and author holdouts. Teacher-label real-shaped
   public samples with a platform LLM, human-verify.
2. **Model.** Keep pruned E5-small (share tokenizer/encoder artifact with the E5 runtime:
   one ~31 MB download), BIO tagger + heads; add a BAL/LIMIT role head and calibrated
   confidences; distil to 6 layers if latency matters (est. ~20 MB, ~5 ms).
3. **Integration.** Call after `session.parse`/`parseUnproven` return null in
   `launch-alert-parser.ts` (the `parseUniversalPostedEvent` seam), never for AE/SA
   sender/route; model spans feed a `UniversalBankEvent`, then the unchanged
   `decideBestEffortAutoPost` + `hasNonCompletedWording` + a new cue-grounded direction check.
   Below threshold → Review prefilled with model fields (a large win on its own: status 85%,
   merchant 83%). Rows carry the `bestEffort` marker.
4. **Gate to ship:** on a held-out real benchmark per language, hybrid false-post ≤0.3%,
   posted precision ≥98%, AE/SA byte-identical, int8 ≤40 MB, p95 ≤25 ms on a mid Android.
5. **Categories:** a shipped brand→category table (top ~2–5k merchants per market, from public
   knowledge), platform-LLM fallback (Apple Foundation Models / Gemini Nano) for unknown
   brands, user-correction memory keyed by normalized merchant; the n-gram model only for
   descriptive names.
6. **Real benchmark, privately:** opt-in on-device evaluation — the phone runs rules and model
   in shadow and uploads only aggregate counters (posted/refused/agreement per field and
   language), never text; plus consented, locally redacted donor exports (like the owner's)
   scored on-device or on the owner's machine, never committed. Minimum: ~500 labelled alerts
   per launch language before enabling auto-post there.
