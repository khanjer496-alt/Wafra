# Local AI qualification v2 — 23 September 2026

**Integration update:** these changes have since been copied into the canonical checkout. See [the main integration record](main-integration-2026-09-23.md) for preservation, current validation and commit status. Earlier worktree statements below describe the evaluation snapshot.

## Decision

None of the three tested instruction-model configurations qualifies for app integration. The strongest candidate selects the supported Ask tool correctly in 31 of 32 cases, but only 23 of 32 complete requests match all expected arguments. It silently drops unsupported constraints and gets relative dates wrong. Bank extraction also confuses incoming transfers, card repayments and verification messages with purchases. Keep financial execution deterministic and the current semantic Review path advisory-only.

This is a bounded synthetic feasibility comparison, not a worldwide-bank benchmark or phone performance test. No new GGUF runtime was added to the app, no personal data was used, and no source was published. Existing Android performance fixes remain in the task worktree.

## Frozen protocol and provenance

Two independently authored fixture files were frozen before inference: 48 bank messages (26 supported, 22 required abstentions) and 48 Ask questions (32 supported, 16 required help responses). Bank languages are English, Arabic, mixed, French, Spanish and German; Ask covers English, Arabic and mixed questions. The reference date is 2026-09-23. Source files and exact model revisions, sizes and SHA-256 hashes are in `scripts/local-ai/candidates-v2.json` and `scripts/test/fixtures/local-ai-{bank,ask}-v2.json`.

- Bank fixture SHA-256: `48ed63f642e0b8de708c82dffc6165a7022761a200e9c7d97ce183318619c711`.
- Ask fixture SHA-256: `61fd0baae952dadc3dfa827695da6b23fe7cbf3b347cc5fce1ac1147710fc131`.
- Frozen prompt/contract helper SHA-256: `8bb947074c7729409e5208ad93818af7099b9dc58f4d4ec65296e06b1a6ddb88`.

Qwen3-0.6B Q8 is the official Qwen GGUF control. Qwen3.5-2B Q4_K_M and Qwen3-4B-Instruct-2507 Q4_K_M are pinned Unsloth quantizations of Qwen base models. Model files were size/hash verified before execution. The 4B candidate was selected after examining the 2B result; prompts, labels and scoring were unchanged. This adaptive comparison must not be described as independent production qualification.

All runs used llama.cpp 10360 (`48d22e295`) on this Mac: one slot, 2,048-token context, two CPU threads, thinking disabled, temperature zero, seed 23, 320 maximum output tokens and JSON-schema output. Prompt reuse was disabled; all 288 responses report zero cached tokens. Each candidate ran sequentially on authenticated localhost, then its server was stopped. No phone, emulator, native bridge, cold startup, battery or thermal measurements were performed.

The independent validator checks exact keys, explicit JSON nulls, enums, literal source spans, whole numeric spans, dates and allowed per-tool arguments. Ask outputs also compile through the actual production request validator. These checks establish shape and limited grounding, not semantic truth. The bank checks do not execute the app's final import certification or write transactions.

## Results

Exact supported match includes every expected field. The candidate gate requires at least 95% supported exactness and zero wrong accepted outputs, solely to proceed to larger evaluation. All candidates fail both domains.

| Candidate | Bank exact supported | Bank negative candidates surviving guards | Ask exact supported | Ask unsupported requests surviving guards |
| --- | ---: | ---: | ---: | ---: |
| Qwen3 0.6B Q8 control | 0/26 | 0/22 | 2/32 | 3/16 |
| Qwen3.5 2B Q4 | 11/26 | 2/22 | 8/32 | 7/16 |
| Qwen3 4B Instruct Q4 | 16/26 | 2/22 | 23/32 | 10/16 |

The control's zero surviving bank negatives is not evidence of a useful safe classifier: none of its 48 bank outputs passes the contract. All models produced syntactically valid JSON throughout. The 2B model chose abstention on 19 of 22 bank negatives, but 18 retained forbidden fields; these are protocol failures rather than positive posting claims.

| Candidate | Bank P50 / P95 | Ask P50 / P95 | Highest sampled server RSS |
| --- | ---: | ---: | ---: |
| 0.6B Q8 | 1,136 / 1,463 ms | 1,218 / 1,530 ms | 955 MiB |
| 2B Q4 | 3,072 / 3,745 ms | 3,257 / 3,829 ms | 1,405 MiB |
| 4B Q4 | 4,291 / 4,980 ms | 5,100 / 6,117 ms | 1,805 MiB |

These are warm host request timings including local HTTP. RSS was sampled every 500 ms and is neither true peak memory nor phone RAM. Quantized weight files are approximately 639 MB, 1,281 MB and 2,497 MB respectively; host RSS is not download size.

Material 4B errors include an incoming transfer and card repayment classified as purchases, a Spanish purchase marked credit, a German withdrawal classified as a fee, accepting only one movement from a two-movement message, and treating a French verification code as a purchase. Ask errors include “last month” mapped to 2025-09 or 2026-03 and unsupported payment/deletion/location/amount/refund/OR constraints approximated by ordinary queries.

Not every exact mismatch is materially wrong: two “last year” outputs use a full 2025 date range rather than the canonical year identifier. Those can be equivalent for calendar periods, though salary-period semantics may differ. The failed decision does not depend on these representation differences.

A diagnostic ablation removed the JSON grammar from five already-failed 4B examples. All five still failed, including wrong direction, family, relative year and OR handling. This selected follow-up is diagnostic only, not another held-out accuracy estimate. Grammar is not the sole cause of the observed failures.

## Existing app baseline

The actual generic review parser and semantic advisory eligibility were exercised on the frozen 48 bank messages, using an unlisted sender and a counted retriever returning null. Nine of 26 positives have all compared core facts correct; 19 produce an event with the correct explicit amount, currency and exponent. Seven positives reach advisory retrieval. Twenty of 22 negatives were initially blocked; Arabic declined withdrawal and balance-only cases reached advisory eligibility. This identifies a safety gap at the advisory seam, not proof of automatic ledger posting.

The baseline excludes merchant/date/ownership correctness and final import certification. Missing generic context can block an event independently of whether the parser understands its status. Original evidence is preserved in the baseline report. Two bounded production fixes now recognize an explicit Arabic rejected cash-withdrawal clause and the `رصيد حسابك` account-balance label. The [post-fix baseline](test-evidence/2026-09-23-local-ai-v2-bank-baseline-arabic-safety.json) blocks all 22 negative cases; positive results remain unchanged. Five regression cases protect declined withdrawal, balance-only, posted withdrawal, purchase-plus-balance and conditional advice. The full universal parser suite passes 279 tests. The five new regressions are also wired into the normal universal-suite gate.

These fixes close the observed eligibility gaps. They do not expand the result into a claim of complete Arabic or worldwide coverage.

## Evidence and reproduction

- [0.6B control outputs](test-evidence/2026-09-23-local-ai-v2-qwen3-06b-control.json)
- [2B outputs](test-evidence/2026-09-23-local-ai-v2-qwen35-2b.json)
- [4B outputs](test-evidence/2026-09-23-local-ai-v2-qwen3-4b-instruct.json)
- [No-grammar diagnostic](test-evidence/2026-09-23-local-ai-v2-constraint-ablation.json)
- [Original deterministic app baseline](test-evidence/2026-09-23-local-ai-v2-bank-baseline.json)

Use the exact candidate manifest artifact and a dedicated `llama-server` on `127.0.0.1:18821`, with `-c 2048 -np 1 -t 2 -tb 2 -b 256 -ub 128 --cache-ram 0 --reasoning off --no-webui --api-key-file <private-file>`. Place the local key at `/tmp/wafra-local-ai-eval/qualification-v2-api-key` with mode 600, or set `WAFRA_QUALIFY_KEY_FILE`. Never commit or print it. Set `WAFRA_QUALIFY_CACHE` for a different model directory. Run with Node 22:

```sh
node scripts/local-ai/qualify-local-model.cjs qwen3-4b-instruct-q4km /tmp/new-qualification-report.json --preflight-only
node scripts/local-ai/qualify-local-model.cjs qwen3-4b-instruct-q4km /tmp/new-qualification-report.json
node --test scripts/test/repair/local-ai-qualification-contract.test.cjs
node scripts/local-ai/bank-baseline-v2.cjs /tmp/new-bank-baseline.json
```

The runner refuses to overwrite evidence and checkpoints each result. After the recorded runs, evidence handling was strengthened to retain HTTP failure bodies (key-redacted), verify process CLI settings and record the runner hash. This does not change the frozen prompt, scoring or recorded results. Historical reports lack the newly added runner hash and server-command fields; the later preflight cannot retroactively attest their settings. Separate launch logs support the recorded configuration. The successful hardened preflight and eight contract tests passed. Original server logs and recorded-run runner are retained in ignored `artifacts/local-ai-v2/`.

## Next implementation direction

Use local models for bounded intent proposals while deterministic code owns dates, entities, exclusions, status, money and calculations. A missing or unsupported constraint must request clarification. For bank coverage, repair proven parser/status gaps, then evaluate a task-trained classifier or extractor against a larger independently labeled corpus of unseen formats. This small set is now diagnostic material and must not be reused as an untouched qualification set after tuning. Do not spend on native GGUF integration until a candidate passes meaningful accuracy and usefulness checks.

## Final verification

After the two parser fixes, `npm test` passed: 79 app suites, three server suites, three native Swift suites, 1,308 repair/workflow/journey tests, 24 numeric checks and 31 onboarding-action tests. Native build/resource checks are host evidence, not device execution. The updated universal runner separately passed all seven declared suites, including the five new Arabic regressions; the broader universal test glob passed 279 tests.

Typecheck, targeted ESLint and `git diff --check` passed. Independent read-only review found no actionable parser regression or result inconsistency. A fresh baseline rerun exactly matched the post-fix rows. All 51 previously recorded integration/performance file hashes are unchanged. Final logs and additional source hashes are retained in ignored `artifacts/local-ai-v2/`.

Changes are uncommitted in `/Users/naserkhanjar/.codex/worktrees/wafra-local-ai/Wafra`, based on `e560a07e311a6e97c862216a45660c8a4af5097d`. The stale dirty canonical checkout remains preserved. No phone testing, commit, push, release or model integration was performed.
