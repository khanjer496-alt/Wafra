# Local AI evaluation — 23 September 2026

The stronger, frozen 96-case comparison is recorded in [qualification v2](local-ai-qualification-v2.md). All three tested instruction-model configurations failed; no GGUF model was enabled in the app.

## What was actually run

`/opt/homebrew/opt/node@22/bin/node scripts/local-ai/evaluate-e5.cjs` ran the actual shipped INT8 ONNX graph, hash-verified tokenizer and tokenizer configuration on macOS arm64 with ONNX Runtime Node 1.24.3. The graph is 34,825,743 bytes, SHA-256 `70fd5ee627d2392c1f201c4045ca1c37991db28e80eab3401ebc34b540c4f9a1`. Model/tokenizer bytes download only from the existing public Wafra release. No personal data was uploaded or used.

The encoder mirrors native preprocessing: trim, 1,000 characters, tokenizer with type IDs, first 128 tokens, attention-masked mean pooling into Float32 values, L2 normalization. It adds no E5 query prefix because production adds none. Production TypeScript retrieval, max-per-prototype aggregation, confidence gates and linear head run through the existing loader, not a replacement scoring implementation. Host ORT uses one thread; this is not device latency, battery, memory, or native bridge qualification.

Labels in `scripts/test/fixtures/local-ai-held-out.json` were authored before inference and independently of parser outputs. These 46 synthetic cases were not used to tune thresholds or train the head. They are a small diagnostic set, not a representative blind benchmark or authentic worldwide bank corpus. Constraint-rich assistant labels require abstention by the default-only semantic tool compiler; they do not imply the app's richer deterministic planner cannot answer them. Parser strings are pre-redacted semantic snippets, so reported head errors are before deterministic eligibility/status gates.

## Artifact preprocessing parity

Read-only inspection of the historical `Documents/Wafra/docs/experiments/local-multilingual-encoder/package-runtime-artifacts.py` identified the exact shipped Ask source phrases in `benchmark-config.json`. That generator uses raw text, max 128 tokens, masked mean pooling and L2 normalization. Ten exact shipped anchor phrases are preserved separately in `local-ai-anchor-parity.json`, solely as a preprocessing diagnostic. All ten retrieve the correct prototype; cosine is 0.995691–0.998178. Adding `query: ` reduces similarity on all ten (0.972938–0.989694). There is no evidence of a missing-prefix mismatch. The small residual difference could involve dynamic INT8 batch versus single-row execution; this was not isolated. Do not add a prefix without regenerating and qualifying all vectors/heads. These anchor scores are not held-out accuracy.

## Results

| Path | Cases | Accepted | Correct accepted | Incorrect accepted | Abstained | Supported top-1 accuracy before gate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Ask prototype retriever | 24 | 1 | 1 | 0 | 23 | 11/14 (78.6%) |
| Parser canonical centroids | 22 | 0 | 0 | 0 | 22 | 8/17 (47.1%) |
| Parser public linear head | 22 | 8 | 4 | 4 | 14 | Not measured before head gate |
| Review strict head + canonical agreement | 22 | 0 | 0 | 0 | 22 | Not applicable |

Ask accepted coverage is 1/14 supported questions (7.1%); it abstained on all ten constrained/out-of-scope cases. Its one acceptance was English subscription phrasing; no Arabic or mixed case passed. Zero false accepts in this tiny sample is not proof of safety. Parser head accepted precision is 4/8 (50%), with 4/17 supported inputs correctly accepted (23.5% recall). Four of five unsafe/non-posting inputs were abstained by the head; pending purchase was labeled purchase with probability 0.785. Existing deterministic pending gates must remain authoritative.

The other head errors were recurring subscription → fee (0.617), card statement → transfer (0.614), card repayment → transfer (0.717). Softmax probabilities are not demonstrated calibrated correctness. The conservative centroid path rejected these ambiguous vectors. Raw rows, candidate scores/margins, head outputs, artifact hashes and host timings are saved in `docs/test-evidence/2026-09-23-local-ai-model-evaluation.json`.

The new Review runtime requires learned-head and canonical-gate agreement from the same embedding. On these inputs its agreement stage accepts **0/22**; deterministic eligibility and supported-family restrictions can only reduce that number. This is conservative but demonstrates no useful recovery on this pack. The report records the shared decision-stage calculation; it does not claim to exercise native UI or full event eligibility.

**Promotion decision:** do not lower thresholds or promote the public head to visible/user-actionable advice on this evidence. Keep deterministic posting and financial-field validation authoritative. Review suggestions require a separately qualified classifier; AI cannot infer the missing amount, ownership, currency or posting status. This model is an embedding encoder, not a general bank-field extractor or conversational generator.

## Reproduction

With the repository's ordinary dependencies installed, install host-only tooling outside the app:

```sh
/opt/homebrew/opt/node@22/bin/npm install --prefix /tmp/wafra-local-ai-eval onnxruntime-node@1.24.3 --no-audit --no-fund
/opt/homebrew/opt/node@22/bin/node scripts/local-ai/evaluate-e5.cjs
```

Set `WAFRA_EVAL_CACHE` to use another tooling/cache directory, and optionally pass a report output path. Every run checks all three downloaded artifacts against exact sizes and SHA-256. App package/lock files are unaffected. To compare future revisions, keep these labels fixed and use a new truly unseen test set for final qualification after tuning.

## Local instruction-model feasibility

These are candidates for an offline experiment, not integrated or qualified app features. Primary documentation was checked on 23 September 2026.

| Candidate | Footprint / license | Integration and limits |
| --- | --- | --- |
| Qwen3-0.6B, quantized GGUF + llama.cpp | 0.6B parameters, Apache 2.0; ideal 4-bit weights alone roughly 300 MB by arithmetic, **not** a measured artifact/RAM budget. KV cache, quantization metadata, buffers and tokenizer increase it. | Official card documents multilingual support, non-thinking mode and llama.cpp support. Start with bounded non-thinking schema output and short context. Small size does not establish accurate Arabic extraction. [Model card](https://huggingface.co/Qwen/Qwen3-0.6B) |
| Gemma 3n E2B + LiteRT-LM | Effective 2B execution, larger total weights; Google describes approximately 2 GB dynamic footprint with selective parameter loading. Download size and peak app RAM still require exact-artifact measurement. Gemma Terms apply, including redistribution notices/restrictions. | Designed for mobile; Kotlin/C++ APIs stable, Swift early preview in current runtime docs. That asymmetry makes simultaneous Android/iOS integration a separate qualification project. [Overview](https://ai.google.dev/gemma/docs/gemma-3n), [memory explanation](https://developers.googleblog.com/introducing-gemma-3n/), [terms](https://ai.google.dev/gemma/terms), [runtime](https://github.com/google-ai-edge/LiteRT-LM) |

llama.cpp supports grammar-constrained output and a subset of JSON Schema. This constrains syntax, not factual correctness, and unsupported schema features may be skipped. Keep the app's independent schema validator, evidence spans and allow-listed tools. [Primary grammar documentation](https://github.com/ggml-org/llama.cpp/blob/master/grammars/README.md).

The next useful experiment is Qwen3-0.6B with pinned artifact/hash, schema-constrained intent/arguments and bank-field spans, evaluated against these cases plus a substantially larger untouched corpus. Reject unsupported constraints instead of silently substituting defaults. Never let generated arithmetic or prose replace ledger execution. For parser output require copied source spans, exact currency/decimal/date validation, explicit pending/declined/OTP rejection and human review for ambiguous ownership. Device acceptance must measure cold/warm P50/P95, cancellation, peak RSS, thermal behavior, background eviction and interrupted downloads on the minimum supported Android and iPhone. No claim of “any bank” follows from either candidate's language list.

## Actual bounded Qwen instruction-model probe

An actual second experiment ran locally on the Mac using installed `llama.cpp 10360 (48d22e295)`, official `Qwen/Qwen3-0.6B-GGUF` Q8 artifact pinned to revision `23749fefcc72300e3a2ad315e1317431b06b590a`. Download was 639,446,688 bytes (609.8 MiB), slightly above the initial approximate 600 MB budget. SHA-256 matched the repository LFS object: `9465e63a22add5354d9bb4b99e90117043c7124007664907259bd16d043bb031`. No app dependency or native integration changed. Inference was localhost only; the server was stopped afterward.

`probe-qwen.cjs` reused all 24 frozen Ask texts, with separately fixed explicit argument expectations for the four constrained-but-supported examples. Ten independently authored bank-field examples included English, Arabic, mixed text and five OTP/pending/declined/offer/failed-transfer negatives. Each request used JSON-schema constrained output, temperature zero, seed 23, thinking disabled, 220 output-token cap and 2048-token context. No few-shot examples or task-specific tuning were supplied. The result is a bounded zero-shot feasibility diagnostic, not a claim about the best attainable performance of this model.

| Measure | Ask (24) | Bank extraction (10) |
| --- | ---: | ---: |
| Valid JSON | 24 | 10 |
| Exact all-field match | 0 | 0 |
| Correct primary label (Ask tool; bank status+family) | 11 | 4 |
| False accepts on required-abstention inputs | 5 of 6 | 1 of 5 |
| Warm request P50 / P95 | 823 / 1019 ms | 796 / 982 ms |

Exact matching penalizes missing/default fields as well as material errors. Several outputs wrote the literal word `empty` instead of an empty merchant string. The prompt itself said “merchant empty if absent” without an explicit JSON `""` example, which is ambiguous and contributed to this strict-match failure. The frozen prompt was not retuned after seeing results. This configuration failed; this is not a definitive limit on the model’s capability. Material failures were also clear: an OTP was interpreted as a posted fee, Arabic `45.50` became `4550`, a merchant was translated instead of copied, and financial predictions/actions were often mapped to ordinary tools. JSON grammar successfully controlled syntax but did not protect meaning. Prompt refinement and tuning might improve this; those possibilities do not qualify this configuration for financial use.

The sampled server RSS during inference was 924,368 KiB (902.7 MiB); this is one sample, **not peak memory**. The process used default host acceleration, two CPU threads and one slot. Timings include local HTTP and cached prompt reuse; cold model load, mobile performance, thermal behavior and battery were not measured. Raw outputs, expectations and per-case timings are in `2026-09-23-local-ai-model-evaluation-qwen.json`.

Reproduce with the exact pinned file and hash (the shell SHA check must print `OK`):

```sh
mkdir -p /tmp/wafra-local-ai-eval
curl -fL --retry 2 'https://huggingface.co/Qwen/Qwen3-0.6B-GGUF/resolve/23749fefcc72300e3a2ad315e1317431b06b590a/Qwen3-0.6B-Q8_0.gguf' -o /tmp/wafra-local-ai-eval/Qwen3-0.6B-Q8_0.gguf
printf '%s  %s\n' '9465e63a22add5354d9bb4b99e90117043c7124007664907259bd16d043bb031' '/tmp/wafra-local-ai-eval/Qwen3-0.6B-Q8_0.gguf' | shasum -a 256 -c -
llama-server -m /tmp/wafra-local-ai-eval/Qwen3-0.6B-Q8_0.gguf --host 127.0.0.1 --port 18791 -c 2048 -np 1 -t 2 --reasoning off
# In a second terminal, from the repository:
/opt/homebrew/opt/node@22/bin/node scripts/local-ai/probe-qwen.cjs
```

The script streams verification of the pinned file size/hash and checks `/v1/models` reports exactly the matching file path or basename before inference. A mismatch fails closed. This is a local server association check, not cryptographic attestation of loaded weights: use a dedicated server with the exact `-m` path and no model alias. The original recorded run’s launch log confirmed that exact file was loaded; its evidence remains unchanged. `WAFRA_QWEN_MODEL` overrides the local verification path. Every fetch has a 30-second timeout. By default each new run writes a timestamped report under `/tmp/wafra-local-ai-eval`; optionally pass a new output path as the first argument. Exclusive creation refuses to overwrite an existing report. Source metadata: [official pinned repository](https://huggingface.co/Qwen/Qwen3-0.6B-GGUF/tree/23749fefcc72300e3a2ad315e1317431b06b590a).

**Decision:** this small instruction-model configuration does not solve broad parsing or Ask interpretation safely. Keep it out of the app. A future comparison should use a stronger candidate or explicitly trained extractor, retain independent validation of source spans/amounts/status, and establish quality on a larger untouched corpus before spending effort on native integration.
