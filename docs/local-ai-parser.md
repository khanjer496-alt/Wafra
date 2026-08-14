# Local AI parser evaluation

Status: internal shadow evaluation only. It is disabled in every ordinary and
store build by `EXPO_PUBLIC_WAFRA_LOCAL_AI_EVAL=0`.

## Why it is not the parser yet

A language model can help interpret unfamiliar wording, but it is not allowed
to invent accounting facts. Wafra's deterministic parser continues to own:

- whether money actually posted;
- amount and currency;
- debit versus credit;
- date, merchant, account and card identity;
- duplicate and payment-flow reconciliation;
- every ledger write.

The local model currently returns four closed enum fields: status, semantic
kind, direction and confidence. Its output has no amount, currency, date,
account, title, free-text explanation, transaction ID or import command. The
evaluation UI retains neither pasted source text nor model results after the
screen closes.

The generic Qwen2.5 0.5B and 1.5B instruction models were tested before this
runtime was added. Neither was reliable enough on salary, own-account
transfers, card purchases versus card payments, conditional promotional
income, Arabic bills and ATM activity. Consequently, installing the model does
not alter capture or the review tray. The useful next step is training and
evaluating a bank-alert-specific adapter, not granting a generic chat model
ledger authority.

The pinned 1.5B candidate was also run against the exact 16-case contract in
this change on 14 August 2026. It produced 8/16 exact classifications and two
safety failures: an external remittance was hidden as an own-account transfer,
and conditional promotional payout copy was treated as posted business income.
That measured failure is why the store profiles pin the feature off.

## Runtime and artifact

- Runtime: `llama.rn` 0.12.9 on iOS and Android.
- Candidate: official Qwen2.5-1.5B-Instruct GGUF Q4_K_M, Apache-2.0.
- Artifact URL is pinned to an immutable Hugging Face commit.
- Expected size and SHA-256 are pinned in `src/lib/local-ai-model.ts`.
- Download is explicit and stored under disposable app cache, never in the
  ledger database or its backup.
- SHA-256 is computed with bounded `FileHandle` chunks; a corrupt or incomplete
  model cannot load.
- Native llama logs are disabled, and the KV cache is cleared after every
  alert.
- Android evaluation uses the broad CPU path. iOS can use Metal. Experimental
  Android OpenCL/Hexagon paths are not enabled.

## iOS boundary

Local inference works on iOS. Inbox capture does not: Apple does not expose the
Messages database to ordinary apps. The model can analyze an alert only after
Wafra receives it through the existing Shortcut/relay or a manual import. The
relay architecture should continue to discard or seal source text according to
its existing privacy contract; adding a local model does not create new inbox
access.

## Promotion gate

The internal screen runs synthetic salary, business-income, purchase,
own/external transfer, credit-card payment, utility payment, due reminder,
refund, ATM, OTP, decline, conditional-income and balance-only cases across
multiple regions. Any false posting, missed posting, hidden debit, external
transfer classified as own, or purchase classified as card payment fails the
gate.

Passing this small benchmark does not enable capture. Promotion also requires:

1. a versioned bank-alert-tuned model or adapter;
2. a consented, redacted, held-out multilingual corpus;
3. zero safety-critical errors and measured category improvement;
4. signed iOS and Android device tests covering memory, thermal and latency;
5. a separate reviewed change that connects only safe suggestions to the
   existing explicit review flow.

The release-readiness gate rejects any production build that enables the
internal evaluator.

## Read-only assistant

The internal build also exposes an `Ask Wafra` screen. This is deliberately a
query interface, not an accounting agent:

1. The local model converts a question into one of five closed, read-only query
   plans: transaction search, period summary, cash-out explanation, saved bills
   or recurring commitments.
2. A strict schema rejects extra fields, write instructions, malformed dates
   and invalid money bounds.
3. Existing Wafra domain modules perform every filter, reconciliation and
   calculation. Model-generated financial values are never displayed.
4. Answers link to the exact local transaction rows used as evidence. They do
   not expose raw SMS bodies.
5. Questions, plans and answers live only in screen memory and are not added to
   encrypted app state, backups, feedback or analytics. The llama KV cache is
   cleared after each question.

If the model is absent or its plan fails validation, a deliberately narrow
deterministic router handles common queries such as a known merchant, salary,
cash out, bills and amount thresholds. This keeps the ledger useful without a
1.04 GB download while making ambiguous questions visibly narrower rather than
inventing an answer.

The assistant remains under the same internal evaluation flag as the parser
benchmark. A store release needs separate device latency/memory validation,
answer-quality evaluation and UI review before this flag can be enabled.
