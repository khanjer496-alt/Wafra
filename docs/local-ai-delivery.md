# Local AI delivery — 23 September 2026

**Integration update:** these changes have since been copied into the canonical checkout. See [the main integration record](main-integration-2026-09-23.md) for preservation, current validation and commit status. Earlier worktree statements below describe the evaluation snapshot.

The stronger, frozen 96-case comparison is recorded in [qualification v2](local-ai-qualification-v2.md). All three tested instruction-model configurations failed; no GGUF model was enabled in the app.

## Result

The Ask Wafra integration fixes, guarded Review-advisory path and native
inference scheduling are implemented locally. Broader bank parsing and general
Ask interpretation remain unqualified: actual E5 and small Qwen instruction-model
probes failed the usefulness/accuracy checks. Their outputs were not granted
posting authority, and Qwen was not added to the app.

All 79 app suites and 1,308 repair/workflow/journey tests passed, together with
the applicable server/native gates and numeric/onboarding checks. Typecheck
passes; lint has zero errors and 18 existing warnings. Browser acceptance and
the exact verification scope are recorded in
[the integration evidence](test-evidence/2026-09-23-local-ai-integration.md).
[The model evaluation](local-ai-evaluation.md) contains reproducible commands,
actual outputs, failure analysis and the next qualification requirements.

Work remains uncommitted in the attached task worktree. No source was published
and no device was installed; the canonical dirty checkout is unchanged.

## Intended behavior

Bank alerts that need review can receive a local, explicitly advisory event-type
suggestion. Ask Wafra can interpret more fresh questions without losing their
constraints or returning a response from an erased/replaced ledger. Financial
values, posting status, ownership, duplicate handling and calculations remain
controlled by the existing deterministic parser, validators and executor.

This work extends the E5 encoder already integrated on `origin/main` at
`e560a07e`. E5 is an embedding model: it does not generate answers or extract
arbitrary bank fields. Broader instruction-model support requires its own
measured evaluation; worldwide bank coverage is not a claim of this change.

## Implementation and verification plan

1. Preserve the canonical checkout unchanged. It contains a local-only commit
   and unfinished changes, and is 516 commits behind the inspected remote.
   Use the isolated task worktree created from the current remote revision.
2. Fix Ask Wafra context selection, asynchronous response validity and runtime
   readiness feedback. Ground question-specific constraints with existing
   parsing and validation; request clarification rather than silently replacing
   constraints with prototype defaults.
3. Compute source-free parser advisories while an original alert is available.
   Keep them separate from saved review facts and posting decisions. Existing
   source-free records remain manually reviewable when inference is impossible.
4. Serialize native inference and prioritize interactive questions over queued
   background diagnostics. Keep inference queues bounded and cancellable.
5. Run the exact pinned model against an authored holdout set, report coverage,
   abstention and incorrect acceptance separately, and distinguish synthetic
   examples from real bank evidence. Do not tune and then claim the same set
   as an unseen qualification set.
6. Run typecheck, lint, focused regressions, repository tests and available UI
   checks. Obtain independent read-only review and resolve actionable findings.
7. Document device-only gates: download verification, offline reuse, real inbox
   latency/CPU/RAM, concurrent Ask responsiveness, real alerts and iOS runtime.

## Publication and integration

No commit, push, release or deployment is implicit. Changes remain reviewable
in normal source/test paths in this task worktree. Reconciliation with the
dirty canonical checkout must preserve and review its distinct work before
integration; never reset, stash or overwrite it to make it appear up to date.

## Required evidence for broader AI claims

- Parser: independently labeled messages from unseen banks/languages, hard
  negatives, several money values, pending/failed/reversed states, false posting
  rate, review rate and exact amount/currency/direction correctness.
- Ask Wafra: correct supported tool and every argument, rejected unsupported
  requests, dates/entities/exclusions, independent questions versus follow-ups,
  ledger replacement during inference and evidence-backed numeric answers.
- Runtime: actual device cold/warm latency, peak memory, download size,
  cancellation, offline behavior, background/foreground transitions and crash
  history. Host ONNX timing is not phone timing.

The result of each gate belongs in the accompanying evaluation/evidence files;
an unmeasured gate must remain explicitly open.
