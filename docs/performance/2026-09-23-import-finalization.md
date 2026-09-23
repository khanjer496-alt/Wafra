# Import finalization: preserve sorted transaction identity

Date: 2026-09-23. Source: local `wafra-local-ai/Wafra` worktree. No device measurement.

## Finding and change

The full import path normalized transfer links, always copied/sorted the normalized
array, then reconciled transfers again to stamp the durable receipt. The memo uses
array identity. Even when normalization changed nothing and dates were already
newest-first, the copy guaranteed a second complete graph computation.

Finalization now checks adjacent dates before sorting. An already sorted array is
returned unchanged. Unsorted arrays retain the previous stable sort, including
existing timestamp order within equal dates. Normalization remains before sorting;
account repair, deduplication, payment reconciliation and the final receipt call
retain their existing order. If normalization writes new matches, its returned
array differs from its graph input and the required second graph still runs.

## Reproduction and verification

`node --test scripts/test/repair/import-finalization-performance.test.cjs`

Run `bash scripts/test/build.sh` first so dependencies reflect the current source.
The test transpiles the checked-in import and transfer modules; other monetary
dependencies use the repository test build. It instruments entry to the actual
transfer graph computation without replacing monetary logic. The baseline changes
only the final sortedness-aware call back to the previous unconditional sort.
Before the source fix, the new unchanged-graph assertion failed with 2 versus 1.
Afterward all three correctness cases pass:

- Sorted finalization: one graph computation, full output equal to old behavior.
- New reciprocal links: two graph computations, output equal to old behavior;
  an ambiguous additional observation also retains legacy output.
- Unsorted history: complete output and stable date/timestamp ordering match.

Optional timing:

`WAFRA_IMPORT_BENCH=1 node --test scripts/test/repair/import-finalization-performance.test.cjs`

Synthetic history includes two bank accounts, dated SMS purchases and periodic
salary rows, varied amounts, and portable source keys. Five trials alternate old
and new order; source transpilation is outside the measured operation. These are
ordinary-history finalization timings, not transfer-dense worst-case estimates.

| Rows | Before median | After median | Reduction |
| --- | ---: | ---: | ---: |
| 15,000 | 100.38 ms | 69.43 ms | 30.8% |
| 30,000 | 205.27 ms | 151.80 ms | 26.0% |

Raw milliseconds:

- 15k before: 109.74, 109.49, 96.51, 93.89, 100.38
- 15k after: 66.56, 69.43, 70.12, 66.88, 80.43
- 30k before: 229.14, 200.79, 226.01, 205.27, 198.72
- 30k after: 160.77, 143.30, 152.56, 151.80, 143.80

The instrumented test uses VM/module boundaries; these figures are diagnostic
comparisons, not production-runtime speedup claims. The deterministic reduction
from two graph computations to one is the primary regression evidence.
No timing threshold is asserted. Host V8 performance does not prove Hermes,
SQLCipher write latency, responsiveness during finalization, or physical-device
capture. The remaining finalization pass is synchronous. Source-index rebuilding,
serialization scheduling and reducer architecture are outside this change.
