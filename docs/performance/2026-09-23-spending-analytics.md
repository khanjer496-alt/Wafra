# Spending category history: bounded host verification

The Android Spending category detail calls `categoryTrend` synchronously when a category opens (`src/app/(tabs)/flow.tsx`). The previous projection scanned every ledger row separately for each of six displayed months. The implementation now creates the same ordered month buckets and accumulates them in one ledger pass. No cache, scheduling, navigation, or other analytics functions changed.

## Reproduction and correctness

Run `node --test scripts/test/repair/category-trend-performance.test.cjs` from the repository root. The harness transpiles current checked-in analytics, ledger, format, period and split source. The active currency is an explicit test boundary; this is host algorithm evidence, not Android frame timing.

The new operation-count assertions failed before the change: 15,000 transactions caused 90,000 transaction-date reads and 30,000 caused 180,000. After the change these are respectively 15,000 and 30,000. The fixture spans years of dated SMS transactions across 44 accounts and 800 merchants. There are no timing thresholds in the regression tests.

The same suite compares results against the previous six-pass algorithm for salary start days 1, 25 and 28; empty and shuffled ledgers; 0, 1, 6 and 12 month windows; category splits; hidden accounts; internal and flagged transfers; income; and dates outside the requested window. The prior invalid `endKey` error remains covered. Each bucket still accumulates matching rows in input order, preserving numerical addition order. No transaction is mutated.

## Optional timing

Run `WAFRA_TREND_TIMING=1 node --test scripts/test/repair/category-trend-performance.test.cjs` without concurrent CPU benchmarks. It prints separate plain-row timings for the retained six-pass reference and current source after operation-count validation. These single host samples support the operation counts; they do not establish phone responsiveness or the cost of chart rendering.

One isolated run on 23 September 2026 (Node, direct-TypeScript VM harness):

| Ledger rows | Six-pass reference | Current one-pass source | Date reads before → after |
| --- | --- | --- | --- |
| 15,000 | 88.599 ms | 18.768 ms | 90,000 → 15,000 |
| 30,000 | 178.786 ms | 30.886 ms | 180,000 → 30,000 |

These absolute timings include the harness's VM/module boundary costs; the retained reference executes in the test context and calls the actual ledger helpers across that boundary. Consequently the timing ratio is not a production speedup claim. The deterministic sixfold reduction in ledger date reads is the primary regression evidence. The final focused run passed all three tests. Android UI/frame performance remains unmeasured in this work.
