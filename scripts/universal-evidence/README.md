# Universal evidence evaluation

Run `node evaluate.cjs --output /tmp/wafra-coverage.json` from this directory,
or `node scripts/universal-evidence/evaluate.cjs` from the repository root.
Any unmet assertion produces a nonzero exit. Do not weaken expectations to make
the broad coverage evaluation green.

`public-cases.json` contains short primary-provider examples with provenance.
`independent-cases.json` was authored without inspecting implementation or prior
tests. Neither is representative customer data. `structural-cases.cjs` generates
related formatting stress cases; count that group separately.

`adjudications.json` preserves explicit independent-review corrections without
changing original inputs. `evaluate.cjs` distinguishes exact matches, abstentions,
wrong fields, and explicit-confirmation refusal outcomes. `evaluator.test.cjs`
checks those distinctions. Missing money and source-status refusal are reported
separately so an unexercisable confirmation cannot inflate safety evidence.

`money-regressions.test.cjs` and `nonposting-regressions.test.cjs` are focused
failure-first regressions for the bounded fixes this evaluation discovered.

`report.cjs` writes the human-readable report and regrades saved baseline output
under the reviewed oracle. It never claims to re-execute the previous source.
Historical evidence lives in
`docs/test-evidence/universal-coverage-2026-09-05/`.

To extend the corpus, record expected semantics before running the parser. Keep
new unseen provider/language cases in a fresh evaluation round: after cases drive
a fix they are regression evidence, no longer a held-out accuracy sample. Review
new translations with native speakers before making language coverage claims.
