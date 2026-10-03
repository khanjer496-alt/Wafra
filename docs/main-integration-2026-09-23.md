# Canonical main integration — 23 September 2026

## Source reconciliation

The canonical checkout is `/Users/naserkhanjar/Wafra`. It began at local `main` commit `5bb28e279b104af38664432107bc0dcc0920859e`, one local commit ahead and 516 commits behind `origin/main` (`e560a07e311a6e97c862216a45660c8a4af5097d`). The local commit's statement-transfer behavior is already represented by newer upstream implementations.

A non-committing merge resolved the three conflicts in server statement imports, server import tests and `src/lib/import-plan.ts` toward the reviewed upstream versions. Other merged paths already match upstream. Before task changes, the staged tree exactly matched the upstream tree `0d8e521c313ccf4ca2944d403e33bf1e3ad317e9`. No history was reset or rebased; the local commit remains available as the first merge parent and in a verified Git bundle.

The task worktree's verified AI integration, Android code-performance fixes and Arabic parser safety changes are copied into normal source/test/documentation paths in this checkout. No model weights or private runtime credentials are included. The failed instruction-model candidates remain disabled.

## Preserved unfinished work

Before integration, 654 changed/untracked entries were inventoried under the private local directory `.git/integration-preservation/20260923T114438Z/`. Regular files have exact copies and SHA-256 verification; symlinks preserve their targets; four directory entries remain in place. The snapshot also contains binary working/index patches, reference inventory and a verified `local-main.bundle`.

`set-aside.json` identifies 20 tracked drafts, five untracked paths colliding with upstream, and three standalone executable drafts. The unfinished consent-gated PostHog work is preserved here, including dependencies, UI, Store, privacy and analytics adapter changes. It is not enabled or included in this integration. Feedback implementation drafts already subsumed upstream were also preserved. Unique non-conflicting research, evidence, handoffs, skills and nested worktrees remain in place.

The old generated iOS directory was separately copied and hash-verified before regenerating it. The obsolete server dependency symlink was replaced with dependencies installed from the current server lockfile; its preserved checkout target was not modified. Root dependencies were also installed from the current lockfile. No package versions were changed by this task.

Do not restore the whole old draft over the current app. Recover a specific unfinished feature from the snapshot, reconcile its changes against current source, and test it independently.

## Verification and publication boundary

The prior task worktree passed the full app/server/native host suite. Integration is being verified again in the canonical checkout, with new Ask regressions included. Exact final commands and results will be appended below.

The owner explicitly authorized committing the prepared merge to local `main`. This integration commit completes that local merge. No push, device installation, OTA, relay deployment or store release was authorized.

## Ask Wafra changes

The existing planner now understands explicit ISO calendar months, explicit numeric calendar years, ordinary cardinal rankings (for example, “which three merchants”), past-tense income arrival/recording language, and references to the selected UI reporting period. Existing Arabic aliases also accept Arabic question punctuation. Salary-day reporting periods remain distinct from explicit calendar dates.

The complete question still passes deterministic merchant/category/date/filter validation. Invalid dates, unsupported amount/location conditions, unknown entities, requests to add or record financial data, conflicting periods, repeated selected-period endpoints and conflicting ranking counts request clarification. Financial answers continue to use the ledger executor; no tested GGUF model is enabled.

Twelve new regressions include two issues caught by independent review: a repeated selected-period comparison losing its second endpoint, and an explicit year accidentally using salary-day boundaries. Both are fixed.

The reused 48-question diagnostic improves from 4 to 14 matched supported requests out of 32 (13 of 16 English and one of 16 Arabic/mixed). This is an already-seen diagnostic set with merchant names seeded from expected labels, not a general accuracy estimate. Fifteen of 16 contract-help requests clarify; the remaining OR-merchants query is supported by the actual app's plural merchant filter and exceeds the narrower model contract. Full bilingual/general-purpose interpretation remains unfinished. Before/after outputs are under `docs/test-evidence/2026-09-23-ask-planner-{before,after}.json`.

The lint configuration now excludes `.worktrees/` and generated `artifacts/`, matching the existing exclusion for `.claude/worktrees/`. Previously canonical lint traversed preserved repositories and compiled bundles. Active source remains included; this narrow change received independent review.

## Final canonical verification

All checks ran against the canonical checkout after copying the fixes and installing its current lockfiles:

- `npm run typecheck`: pass (app and server).
- `npm run lint`: zero errors, 18 existing warnings.
- All 79 `scripts/test/*.test.js` app suites: pass after a fresh `scripts/test/build.sh` compilation.
- Repair/workflow/journey test command from the normal runner: 1,320 passed, zero failed/skipped.
- `node --test scripts/universal-test/*.test.cjs`: 279 passed.
- `npm --prefix server test`: pass.
- Numeric-input regressions: 24 passed; onboarding actions: 31 passed.
- Twelve new Ask date/constraint regressions and the existing Ask suite: pass.
- Independent review: preservation and upstream equivalence verified; Ask findings resolved; lint exclusions reviewed.
- Task delta `git diff --cached --check origin/main`: pass; no unresolved merge entries. The whole merge compared with the stale local HEAD reports six pre-existing upstream EOF-whitespace notices; those unrelated lines were not reformatted.

Canonical verification did not rerun the full native Swift/build gate. That gate passed in the prior worktree; this continuation changed the pure TypeScript Ask planner/normalizer and lint scope. Native files were regenerated locally for source-contract checks. No physical phone or simulator was tested or installed.

Logs and final file hashes are stored locally under ignored `artifacts/main-integration-20260923/`. The committed change set includes upstream history through the merge plus the explicitly listed task files. Other preserved/untracked drafts are excluded. Nothing was pushed or deployed.
