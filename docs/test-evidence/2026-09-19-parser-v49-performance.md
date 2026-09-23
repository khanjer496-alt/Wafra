# Parser v49 and history planning performance

Final review baseline: `origin/main` at `abb50ee48f9c2b9b747036de6a88903606a54e76`
(parser/backfill v48, including the salary repair published during this task).
The initial candidate was independently reviewed and tested in
`/Users/naserkhanjar/Wafra-parser-perf-20260919`. Publication preparation uses
`fix/parser-v49-performance`, based directly on the v48 commit, in
`/Users/naserkhanjar/Wafra-parser-v49-release-20260919`. All 12 implementation
and executable-test files were byte-compared with that reviewed candidate.

The canonical checkout was dirty and diverged from the fetched remote by one
local commit and more than 390 remote commits. It was preserved unchanged;
this worktree started directly from the initially fetched main revision.

## Changes

- Parser/backfill v49 distinguishes `AED.99` (99 fils) from the punctuated
  label `AED. 3,500.00` (350,000 fils). v47 inflated the former to 9,900 fils.
- The currency/number boundary is shared by extraction and full-token
  validation. Malformed grouping and excess precision cannot bypass refusal
  through label punctuation. Equivalent boundaries cover aliases, statement
  totals/minimums, outstanding balances and balance snapshots.
- A statement minimum larger than its explicit total becomes unknown. The
  failing original ADIB fixture contained inconsistent anonymized values;
  it is not evidence that a bank sent that contradiction. Re-reading a matching
  saved obligation repairs an impossible minimum without changing its total,
  payments, settlement date or valid known minimums.
- Added the missing Arabic labels for v47's Credit reversal and Invoice
  payment titles, found by the existing Arabic coverage test.
- Bank-name matching reuses compiled patterns. The cache holds grammar, not
  messages or inferred identities.
- Import planning reuses the source-identity index for an unchanged immutable
  transaction array. New/healed/restored arrays rebuild it. Collision order,
  timestamp validation and duplicate decisions are preserved. Weak keys allow
  retired snapshots and their indexes to be collected.

## Measurements

Node 22.22.3 on this Mac, synthetic/redacted fixtures only. These are host
measurements, not Hermes, physical-device or end-to-end import results.

| Exact-source history planning, 128-message page | Before median | After median |
| --- | ---: | ---: |
| 14,773 unchanged saved transactions | 14.473 ms | 0.331 ms |
| 50,000 unchanged saved transactions | 53.032 ms | 0.241 ms |

The comparison checked complete output equality. A deterministic regression
also checks that subsequent unchanged pages validate 128 incoming identities,
rather than validating all 14,773 saved identities again. Initial use and any
transaction-array change still pay the indexing cost. This optimization is
most useful for re-reads dominated by already imported messages; it does not
make a first import equally cheap.

The standalone parser benchmark compares the same production parser with and
without bank-pattern reuse over 10,000 messages from nine UAE fixtures.
Host-load variation was substantial, so no reliable whole-parser percentage
is claimed. Before incorporating the upstream salary update, an alternating v47/optimization-candidate comparison over the same 941
distinct fixtures repeated to 5,000 reads measured 1,688/1,455 ms,
1,056/892 ms and 1,092/1,154 ms respectively. Each run recognized 3,688 rows.
After incorporating the salary update, the final v49 invariant suite passed
all 34 checks, including 5,000 reads in 506 ms against its 1,500 ms threshold and
no individual fixture exceeding 25 ms. Earlier runs under concurrent host
load exceeded both timing limits; this variability is recorded, not hidden
by relaxing thresholds.

Neither benchmark includes native storage, scheduler delays, UI rendering or
total elapsed history-import time. Eliminating repeated bank-pattern
construction and full-ledger identity validation is covered by deterministic
regressions independently of host timing.

Reproduction after `bash scripts/test/build.sh`:

```sh
node --test scripts/test/repair/parser-bank-pattern-performance.test.cjs
node --test scripts/test/repair/import-plan-index-performance.test.cjs
node --test scripts/test/repair/card-minimum-repair.test.cjs
node scripts/test/repair/parser-speed-benchmark.cjs
```

Use Node 22.22.3 as pinned in `.nvmrc`. Timing tests report observations rather
than enforcing a machine-dependent speed threshold.

## Verification

Final shipping-module test build succeeded on Node 22.22.3. All 29 selected
parser, bank corpus, import planning, Arabic, performance configuration,
semantic interpretation, review, money, history and unit suites passed.
This includes 1,221 parser assertions, 1,338 bank-corpus assertions, 291 import
planner assertions and 1,024 semantic-matrix assertions, including the new
upstream salary cases. The final invariant corpus contains 955 distinct
fixtures; this is regression coverage, not a worldwide bank-coverage claim.

All 47 tests across nine targeted repair suites passed with test concurrency
one: the new index/pattern/minimum tests plus history paging/scheduling,
foreground priority, background history, storage and runtime diagnostics.

An independent read-only review covered the financial changes, cache
invalidation/privacy, upstream salary integration and bounded release claims.
Its amount-validation and persisted-minimum findings were fixed and verified.
The backfill-version configuration assertion was updated to 49 after the
upstream integration. No remaining blocking review finding was reported.

Final app/server typecheck passed. Targeted ESLint completed with zero errors
and three existing import-plan warnings (duplicate imports and array-type
style). `git diff --check origin/main` passed.

## Limits and release status

- Existing incorrect transaction amounts and statement totals are **not**
  automatically repaired by this change. Transaction healing currently has no
  amount update, and saved card statements lack the source identity needed
  for an unambiguous downward total correction. They require separate
  source-backed reconciliation. The backfill change repairs the supported
  same-total contradictory-minimum case; it must not be described as a full
  monetary re-audit.
- No Android device or running iOS simulator was connected. No device UI,
  frame rate, installed parser version or native performance claim is made.
- The initial candidate's full test runner stopped at missing generated iOS
  sources. Publication preparation generated those sources using Expo prebuild;
  subsequent release checks are recorded below.
- APK publication is separate from store submission, installation and physical
  device verification. No device installation or store submission is part of
  this release preparation.

## Publication preparation checks

The release checkout generated iOS sources successfully with no package changes.
The full runner passed its universal/invariant checks and all 394 native history
store assertions, then stopped at the local iOS app build because the CocoaPods
workspace does not exist. A separate run executed all 76 top-level JavaScript
suites (including invariants already run): 74 passed. The two macOS-only signed
Shortcut artifact checks failed in the installed Apple tool with "The file
doesn't exist" / "Apple rejected the signed Shortcut AEA". These iOS artifact
checks are unchanged by this Android parser release. They are not reported as
green or bypassed by editing the tests. The affected parser, accounting,
semantic, import, history, Arabic and performance suites all passed.
