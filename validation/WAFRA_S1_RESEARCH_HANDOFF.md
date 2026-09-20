# Wafra Local Semantic Parser Research Handoff

Updated: 2026-09-20

## Scope

Research only. Do **not** merge this branch into `main` and do not integrate a model into production until the acceptance gates below are met.

The original experiment started by evaluating `trycua/cua` / CUA-S1 as a possible fully local parser for Wafra bank SMS and notifications. The released CUA-S1 forms checkpoint is not a free-form extractor: it scores supplied candidates. The useful idea is therefore the tiny local scoring architecture, not the pretrained form-filling knowledge.

The current target architecture is:

```
raw SMS / notification
  -> deterministic normalization + exact candidate extraction
  -> local semantic understanding (family / direction / posting status)
  -> local amount-role selection
  -> deterministic financial safety gate
  -> auto-import | review | refuse
```

Ask Wafra should consume only structured local rationale from this pipeline. Raw SMS, account/card identifiers, and ledger authority must stay local.

## Important: experimental results are NOT production claims

Many early numbers came from reconstructed/synthetic Wafra fixtures and augmentation. Treat them as directional only.

Observed experiments:

1. Stock CUA-S1 is unsuitable as a direct parser. It only ranks candidates.
2. A very tiny ~28K-parameter from-scratch scorer was too weak on held-out markets (family accuracy roughly 25% in the first experiment).
3. A larger ~268K byte model on reconstructed global fixtures was much better in one market-held-out experiment (roughly 90% family/status range), showing that local semantic ML is technically viable.
4. A separate amount-role experiment correctly selected the transaction amount over balance/limit/minimum-due decoys in the controlled held-out fixture test (28/28). Revalidate this independently.
5. Safety-gated fixture experiments showed that zero unsafe imports can be obtained by abstaining, but coverage collapses as wording becomes genuinely novel. Do not optimize raw accuracy at the expense of unsafe imports.
6. A canonical multilingual concept normalizer can be excellent when the wording is already in its vocabulary, but ablation showed that incomplete lexicon coverage causes large coverage loss. It cannot be the global solution by itself.
7. Hand-written Arabic concept normalization was externally stress-tested against the public ArBanking77 Saudi dialect test subset. On 626 high-risk utterances it achieved only:
   - exact family+state: 48.24%
   - family: 72.20%
   - state: 49.52%
   This is strong evidence that hand-written synonym tables are insufficient.
8. After expanding the Arabic rules using Saudi examples, untouched dialect results were still poor:
   - Moroccan: exact 32.53%, family 57.53%, state 33.97% (624 target utterances)
   - Palestinian: exact 42.07%, family 65.93%, state 44.30% (675 target utterances)
   - Tunisian available target subset: exact 28.13%, family 75.00%, state 34.38% (64 utterances)
   Therefore: **do not ship a handcrafted multilingual lexicon as the primary semantic engine.**

External research dataset:
- `SinaLab/ArBanking77`
- Public Arabic Banking77 adaptation with MSA + Palestinian training data and Saudi/Moroccan/Tunisian dialect test sets.
- High-risk intents used in the external stress test:
  - pending cash withdrawal
  - declined cash withdrawal
  - pending card payment
  - request refund
  - declined transfer
  - refund not showing
  - declined card payment
  - pending transfer
  - transaction charged twice
  - reverted card payment
  - transfer fee charged
  - receiving money
  - failed transfer

## Current hypothesis

The best path is no longer “CUA-S1 alone” or “regex vs AI”.

Use a hybrid:

```
deterministic exact extraction
    |
    +-- known high-certainty financial concepts / blockers
    |
compact banking-domain semantic model
    |
amount-role model
    |
optional compact pretrained multilingual fallback for genuinely OOD wording
    |
deterministic consensus + safety gate
    |
auto-import / review / refuse
```

A pretrained multilingual fallback is attractive because from-scratch tiny models cannot infer completely unseen synonyms. Research candidates included pruned/distilled multilingual MiniLM variants (~18–22M parameters before quantization). Actual checkpoint benchmarking was NOT completed because the prior sandbox could not download Hugging Face Xet-hosted weights. Do not claim those models were benchmarked.

## Next experiment — highest priority

Train a compact banking-domain character/subword model on **real ArBanking77 MSA/Palestinian training utterances**, then evaluate untouched on:
- Saudi
- Moroccan
- Tunisian

Do not tune against those test dialects.

The GitHub connector previously returned blank content for the large MSA/PAL training CSV through one fetch path. Work around this using a local clone/download, GitHub raw/blob access, or another environment. Do not silently replace the real training set with synthetic text.

Compare at least:
1. char n-gram linear classifier / prototype baseline
2. small byte/char neural classifier
3. compact pretrained multilingual encoder if weights can be obtained
4. hybrid deterministic blockers + semantic model

Measure:
- family accuracy
- posting/state accuracy
- joint family+state accuracy
- calibration
- unsafe auto-imports
- safe auto-import coverage
- per-dialect performance
- model bytes
- batch-1 CPU latency

## Safety / acceptance gates

Production auto-import is not allowed until a genuinely untouched real-world holdout demonstrates:

- unsafe auto-imports: **0**
- amount-role safety: effectively 100% on balance/limit/statement/minimum-due decoy set
- direction/status accuracy: target >=99%
- family accuracy: target >=97–98%
- safe automatic coverage: target >=90%
- no regression versus current deterministic parser

Anything uncertain must go to review.

Do not use a confidence threshold as the only safety mechanism. Earlier experiments produced overconfident wrong classifications. Require deterministic evidence and/or independent agreement.

## Wafra integration surfaces already present

Read before designing integration:

- `src/lib/wafra-assistant.ts`
- `src/lib/wafra-assistant-ai.ts`
- `src/lib/alert-review-tray.ts`
- `src/lib/unparsed-launch-alert.ts`
- `src/lib/parser-research.ts`
- `src/lib/parser-research-contract.ts`
- `src/components/assistant-evidence-sheet.tsx`
- `src/components/assistant-findings.tsx`

Ask Wafra already has the right security boundary: external interpretation/explanation models do not receive raw SMS, arbitrary ledger rows, transaction IDs, account/card IDs, or authority to calculate financial figures.

Future local parser rationale should look like structured facts only, for example:

```ts
{
  outcome: 'auto-import' | 'review' | 'refuse',
  family: 'purchase' | 'transfer' | 'salary' | 'refund' | 'fee' | 'utility' |
          'recurring-payment' | 'cash-withdrawal' | 'statement' | 'balance' |
          'authentication' | 'unknown',
  direction: 'debit' | 'credit' | 'none',
  postingStatus: 'posted' | 'failed' | 'future' | 'informational' | 'unknown',
  selectedAmountIndex?: number,
  confidenceBand: 'high' | 'medium' | 'low',
  evidence: string[],
  safetyBlockers: string[],
  semanticSource: 'deterministic' | 'local-model' | 'multilingual-fallback'
}
```

Ask Wafra may explain those structured facts, e.g. “Wafra recognized refund wording and an incoming credit; the other amount was an available balance.” It must not ask a cloud LLM to re-parse raw SMS.

## UX direction

Polished behavior:
- confident safe case: import silently; transaction detail can expose “Understood automatically”
- uncertain case: review card with the proposed amount/type and simple choices
- refused non-posting case: explain why it was not added (declined, future, balance, statement, OTP)
- Ask Wafra can answer “Why did you count this as salary?”, “Why wasn’t this imported?”, and guide correction through existing local correction plans
- no raw probability percentages in user-facing UI
- corrections can become local template rules immediately; privacy-safe sanitized parser templates can support future training/research

## Existing file on this branch

`validation/cua-s1-wafra-benchmark.py` is the original zero-shot CUA-S1 benchmark harness. It predates the later research and should not be mistaken for the final proposed architecture.

## Rules for the next agent

- Research branch only until explicitly authorized otherwise.
- Do not merge or modify `main`.
- Preserve current deterministic parser as the safety baseline.
- Prefer real external holdouts over increasingly elaborate synthetic fixtures.
- Do not report a benchmark as completed unless it actually executed.
- Save scripts, exact splits/seeds, model configs and result JSON so experiments are reproducible.
- The immediate unfinished task is the ArBanking77 train-on-MSA/PAL -> test-on-Saudi/Moroccan/Tunisian experiment.
