# On-device bank-alert AI: implementation and qualification

12 October 2026. The owner chose on-device inference only. This task adds a
guarded Review fallback to the existing platform-model bridge; it does not
establish bank-wide parsing or a launch-ready portable model.

## Implemented behavior

Unfamiliar ignored/unrecognized alerts and unknown-family generic Review can
use an already-ready Apple Foundation Models or Gemini Nano model while the
source is still available. Android inbox/delivery/notification scans, iOS live
capture and Messages History use the same source contract and fact merge.

The model selects a deterministic money ID, proposes a family and copies exact
merchant/date quotations. It cannot emit amount values, currency, direction,
completion or card/account identity. Source readers keep those facts. Known
fields remain authoritative, except a field-specific account-owner/lifecycle
exclusion can correct a misbound date/payee. Unknown or ambiguous facts stay
unresolved. Every result remains Review and requires confirmation.

Full-source controls exclude authentication, statement/balance/card-payment
events, failed/pending/future activity, promotional/lure wording, competing
principals and money without bank context. Balances, limits, secondary fees,
due dates, support text, issuer headings and account-profile fields cannot be
nominated as a principal, payee or transaction date.

There is one inference attempt per complete scan/drain/import session, a
2.5-second deadline covering availability and generation, and cancellation,
generation/opt-out and original identity/duplicate/ACK checks. Native failure,
invalid output or language/device unavailability preserves deterministic
handling. Historical ledger repair disables AI; AE/SA routes keep their
existing behavior. Raw source and prompts remain ephemeral on the device.
Stored Review drops coordinates and arbitrary diagnostics, retaining only the
closed provenance codes `ai-proposed` and `source-profile-field-excluded`.

The platform reader does not call the removed E5 runtime or legacy
`gateAiAlert` posting path. No AI posting language gate was opened. No cloud
provider, API key, portable runtime or automatic model download was added.
Parser version remains 67 and backfill version remains 50.

## Fresh verification

- Universal runner: **15/15 suites, 533 assertions**, all passing.
- Focused AI: **57 source-contract, 13 reader, 23 iOS capture, 10 Android
  capture and 15 native-facade tests**, all passing (118 total).
- Facade plus notification suite: **39/39**, all passing, overlapping the
  15 facade checks above.
- Normal shipping-source test build and full app/server typecheck passed.
- Twelve related parser/import/Review suites passed, including parser
  **1,752/0**, bank corpus **1,338/0**, import plan **390/0**, historical import
  **178/0**, Android Review **153/0**, best-effort policy **526/0** and template
  certification **76/0**. Fresh contracts: **304/0**.
- Swift module typecheck passed at iOS15.1 and iOS26.0 in Swift5 and Swift6
  modes. Host engine tests passed; live generation was explicitly skipped
  because the Mac reported `deviceNotEligible`.
- Kotlin2.1.20 compiled module source against real ML Kit Prompt1.0.0-beta2
  and Common1.0.0-beta3 classes with compile-only Expo/Android framework stubs.
  This is not a Gradle build, signed artifact or device inference test.
- Independent source/capture review reports no open code findings. It found
  and rechecked profile-date merging, persisted provenance, whole-session
  bounds and prepared-schema validation through the real JavaScript facade.

Local evidence is under
`artifacts/datasets/research/bank-coverage-round10/ai/`, including
`independent-review.safe.json`, source hashes, typed native logs, model
manifests and `related-gate.safe.json`. No commit, push, PR or publication was
performed. Five unrelated billing paths changed during evaluation; this task
did not edit or revert them. The preservation record distinguishes those
changes from the intentional AI changes to the preexisting dirty tree.

## Actual local model experiment

Both models ran through localhost-only llama.cpp and the shipping source
contract. Model weights came from pinned official Qwen releases and were
verified by exact size/SHA-256. Neither model is installed in the app. Task
servers were stopped and temporary weights released after evaluation; pinned
manifests, download helper and results remain available for reproduction.

The final source screen contained **112 distinct bodies**, of which **27**
passed preparation. It combines the frozen literal world oracle, prior public
evaluation sources and round10 material. Provenance includes templates,
developer fixtures and fragments. It is a usefulness screen, not independent
received-message accuracy or coverage of a representative market. The frozen
oracle branch uses conservative neutral calendar context; the other branches
use source-country date policy. Source-country context does not establish a
recipient's country or ownership. Model outputs without field gold cannot be
counted as correct. Canonical merchant labels are excluded from literal-quote
scoring unless they occur exactly in source.

| Local model | Calls | Accepted Review | Added information | Wrong proposed families with labels | Median / p95 |
| --- | ---: | ---: | --- | --- | --- |
| Qwen3-0.6B Q8_0 | 27 | 6 | 2 proposed families; 0 new merchants/dates | 1 of 2 | 802 / 1,383 ms |
| Qwen2.5-1.5B Instruct Q4_K_M | 27 | 6 | 0 new families/merchants/dates | No labelled proposals | 1,174 / 1,729 ms |

The small model mislabeled a bill payment as a transfer. The larger model
added no information. Both **failed usefulness qualification**. Acceptance
only means source-contract validation succeeded; unchanged baseline fields
are not new AI benefit. No automatic ledger-write capability exists in this
experiment. Source hashes stayed unchanged during both final runs.

The host Apple framework reported available language identifiers without
Arabic, and the device was ineligible. No Apple/Gemini phone generation was
observed. Host Qwen timings do not predict iPhone/Android latency or memory.

### Follow-up: limits of the usefulness screen

The follow-up audit in
`artifacts/datasets/research/ondevice-solution-round11/diagnosis/` found that
this screen had **zero independently labelled missing-merchant or missing-date
opportunities**. Of20 missing dates,18 had no full source year; only one
calendar candidate passed the unchanged ownership/calendar contract. Many
bank-labelled research rows also failed the production bank-context preflight.
The screen therefore cannot establish that local AI cannot solve extraction.
The models remain unqualified, and isolated Qwen3 family proposals still
included semantic errors. Whole-object rejection also hid some individually
source-valid proposals. A separate controlled candidate-ID experiment tests
selection with a universal abstention value and source-only candidate menus;
it does not loosen production guards or change the frozen results above.

## Remaining qualification and practical route

The current feature can be evaluated on eligible platform-model phones. A
portable Arabic/older-device solution remains open. A compact multilingual
extraction model should be trained and evaluated on source-labelled roles,
with held-out banks/template families and separate authentication, pending,
decline, statement, balance and scam controls. Confidence must come from
source validation and measured held-out results, not model self-reporting.

One promising complementary route is explicit local teaching: a person
confirms fields in their own bank's alerts, and Wafra stores redacted structural
rules for later Review prefills. The existing learned-format functions are
**not connected to Review confirmation**. That requires a separate privacy
design because current Review intentionally does not retain the raw SMS.
Neither training nor personal learning is delivered by this integration.

Real-device inference, latency, memory and unsupported-language behavior,
signed build/CI and market-specific independent held-out evidence remain open.
Worldwide storefront availability and worldwide bank parsing remain separate
claims.

Primary technical sources: [Apple Foundation Models](https://developer.apple.com/documentation/foundationmodels),
[ML Kit Prompt API](https://developers.google.com/ml-kit/genai/prompt/android),
[Qwen3 official model](https://huggingface.co/Qwen/Qwen3-0.6B-GGUF),
[Qwen2.5 official model](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF).
