# Round-2 parser regression and evaluation tools

Run `node scripts/universal-evidence-round2/run.cjs` from the repository root.
This uses the in-memory TypeScript loader and creates no shared build artifacts.

The fields, money and semantics suites repair the original evidence gaps;
the pipeline suite verifies confirmed ledger materialization. The holdout-prefixed
test suites were written **after exposure** and are development regressions.

`holdout.json` and `holdout-notes.md` were written by a separate agent that did
not inspect implementation or previous tests. Input SHA256 and implementation
freeze precede the immutable first execution. Do not edit those files to make
results pass. Reviewed contract adjustments live in `adjudications.json`.

`evaluate-holdout.cjs first` refuses to overwrite first-run evidence.
`evaluate-holdout.cjs after` evaluates the now-exposed set with documented
adjudications. A failing case returns a nonzero process exit.

Full findings, limitations, provenance, hashes and validation counts are in
`docs/test-evidence/universal-coverage-round2-2026-09-05/README.md`.
