# Verification of bounded fixes

Executed 2026-09-05 after the independent review fixes:

| Check | Result |
| --- | --- |
| Money regression tests | 34 passed |
| Non-posting regression tests | 33 passed |
| Evaluator tests | 5 passed |
| Existing universal suites | 6 of 6 passed; 323 checks |
| Independent review reproductions and controls | 14 of 14 passed; no remaining blockers in reviewed scope |
| Strict no-emit TypeScript, two changed production modules | 0 diagnostics |
| ESLint, two changed production modules | Passed |
| Scoped whitespace check | Passed |

The existing suite totals are fields 56, money 66, parser 50, confirmed import
51, pipeline 20, categorization 80. Import test count reflects the concurrent
integration task's provider identity update. An intermediate run failed seven
old identity expectations while that update was in progress; the final complete
run passed after its owner updated and verified the contract.

Failure-first evidence: the initial non-posting regression run passed 14 and
failed 12; independent review added decimal/cross-clause and numeric-advice
failures before their fixes. Final non-posting run passed all 33. Initial money
controls failed 26 of 28 before the principal-selection fix; the final suite
includes 34 cases, all passing. Original broad corpus results remain preserved
in baseline.json, with reviewed regrading in baseline-regraded.json.

Frozen production hashes:

- universal-parser.ts: `59f86c19fb0ff84cea1bf2c47d00dcda6a2e44499b278c37d92e6d8116904eda`
- universal-money.ts: `61d9ee01fd94a10a208c170a530a0628ce4eeced4af8458cebb922ce31f14ad1`

The broad coverage evaluation still exits with code 1 for the documented
unmet expectations. This is intentional and is not reported as a passing
worldwide coverage gate. No native device, full app release, or live message
delivery validation is claimed by this evidence package.
