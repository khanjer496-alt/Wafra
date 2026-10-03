# Local AI integration evidence — 23 September 2026

Base: `e560a07e311a6e97c862216a45660c8a4af5097d` (`origin/main` at inspection).
Changes are uncommitted in `/Users/naserkhanjar/.codex/worktrees/wafra-local-ai/Wafra`.
The dirty canonical checkout and its local-only commit were preserved.

## Implemented

- Ask Wafra distinguishes independent questions from contextual follow-ups.
  The existing obligation planner keeps the selected card for “How much did I
  pay?”, “How much is left?” and demonstrative references. Two-card regression
  cases protect this behavior.
- Bounded question aliases retain the complete date/entity/filter suffix for
  the existing planner. A semantic candidate must be grounded against the full
  question; unsupported constraints produce clarification and executable
  suggestions instead of silently substituting defaults.
- A ledger generation change during inference discards the stale result.
  Native UI displays model preparation/availability status. An eligible new
  question can start non-blocking preparation/retry after a failed startup
  download, under the existing backoff; cold questions are not encoded.
- New eligible Review admissions can receive an asynchronous family advisory.
  The source is redacted before enqueue, source facts must match the saved
  event, both prediction heads must agree, and the user still uses the existing
  confirmation. The session-only cache is bounded and clears on ledger reset.
  It does not persist raw source or change posting/money/status/direction.
- Native inference is serialized with interactive priority and cancellation.

## Verification

- Typecheck passes for app and server.
- ESLint: zero errors, 18 warnings in unchanged files.
- Focused local-AI/Ask session regressions: **79 passed, zero failed** before
  adding cold-retry coverage. The subsequent screen/native-wrapper run passed
  **34/34**, independently repeated by the reviewer.
- Fresh exported-web Ask Wafra acceptance: **29 passed** at 320/390 px, both
  light/dark themes, including evidence/refresh, corrections and card settlement.
- Fresh exported-web universal Review acceptance: **15 passed, zero failed**.
- Visually inspected the compact light composer and dark evidence sheet.
- Independent read-only review found a card-follow-up context regression. It
  was corrected; the reviewer reran 30 relevant tests and reported no remaining
  actionable findings in the correction.
- Full `npm test` initially encountered a timing failure during concurrent web
  compilation (1,581 ms against 1,500 ms). Its isolated rerun passed at 424 ms.
- Native history-store assertions: **394 passed, zero failed**. The initial
  subsequent app build needed the missing CocoaPods workspace. `pod-install`
  completed successfully. The iOS app build, extracted App Intents contract and
  EN/AR resource checks passed, followed by the native live-capture bridge
  (53 assertions), resource checks (78) and queue signal (16).
- The monolithic `npm test` then stopped at the localization contract because
  Review's new sentences were inline. Moving the unchanged text into the
  existing EN/AR copy catalog corrected this: **303/303 contracts passed** and
  **29/29 Review regressions passed**. A database harness dependency was also
  updated to exercise the real advisory cache: **247/247 passed**, including
  ledger-replacement invalidation. All **79 app suites** subsequently passed
  on a freshly compiled test build. This record does not describe that earlier
  monolithic invocation as a clean pass.
- Final repair/workflow/iOS-journey run: **1,267 passed, zero failed**; numeric
  input regressions: **24 passed**; onboarding actions: **31 passed**. The three
  server suites had also completed successfully in the monolithic run before
  its localization-contract stop. All applicable stages have therefore been
  exercised, with the failing app stages rerun after their fixes.

Browser evidence is in `artifacts/local-ai-ui/`; the generated demo export is
in `dist/local-ai-web/`. These are local ignored artifacts, not published app
builds. UI and wiring tests use synthetic data; tests with injected model
responses prove control flow, not model quality.

## Model qualification

The actual-model results are deliberately separate from wiring tests:

- E5 Ask gate accepted 1/24 synthetic questions; strict Review agreement
  accepted 0/22 snippets. The public head alone accepted eight and was wrong on
  four. No threshold was relaxed.
- A pinned local Qwen3-0.6B Q8 probe produced 34 valid JSON responses, but no
  exact field matches under that configuration. Its material errors included
  an OTP treated as a posted fee and a changed decimal amount. The prompt also
  had a documented empty-string ambiguity. It was not integrated into the app.

See [the evaluation and reproduction instructions](../local-ai-evaluation.md).
These are small authored synthetic probes, not real-bank or phone proof.

## Still required for the original product goal

Broad bank parsing and general conversational interpretation are **not
qualified** by this work. The guarded Review path currently demonstrates no
useful recovery on the measured set. A stronger/appropriately trained candidate
needs a larger unseen corpus with source-grounded exact fields and unsupported
question rejection before native integration.

Physical Android inbox latency/CPU/RAM and concurrent Ask responsiveness, a real
bank alert, iOS on-device inference, and interruption/offline tests remain open.
No physical Android device was attached during this work. No commit, push,
release, store submission or device installation was performed.
