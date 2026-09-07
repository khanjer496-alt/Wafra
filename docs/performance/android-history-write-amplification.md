# Android history import: bounded transaction-chunk writes

## Scope

The user reported very slow SMS history import in Ledger & Light APK 132. The baseline is commit `05f9f7ab12e79bd1fe1a7dd938ca472750452594`; the persistence module was also identical on the active restoration review branch before this change. This is a narrow storage optimization, not a redesign or parser replacement.

History is read newest-to-oldest. Each accepted older page appends transactions at the old end of the ledger. The normal oldest-first chunk layout is intentionally anchored at that end to make future incoming (newer) messages cheap. During history import, however, each append shifts the existing chunk boundaries and submits previously saved rows again to the encrypted storage adapter.

## Change and safety

Use the already-supported newest-first chunk layout while history is running, paused or failed. Complete chunks at the newest end remain stable when older history is appended. On completion, convert once back to the normal oldest-first layout, inside the same existing metadata-plus-chunks write. A status-only completion must also convert even if the transaction-array reference is unchanged.

The existing SQLCipher adapter, key handling, transaction boundary, failure cache invalidation, generation checks, load/reset queue, cursor and acknowledgment rules are unchanged. No new on-disk format is introduced: build 132 already reads both layout markers. Pausing, restarting or updating does not require clearing the ledger or intentionally restarting from the beginning. A failed write cannot declare an advanced cursor before the ledger is durable. Interleaved newer captures, edits, account reassignment and removals are tested for exact round-trip preservation.

Only `src/lib/ledger-persistence.ts` is changed in shipping app code. No parser, duplicate-resolution, categorization, amount calculation, native SMS access, permissions, UI or design files are changed. Existing tests are not removed or modified. Fourteen new executable tests include 100 seeded mixed history/live/edit/remove sequences, plus atomic-write failure and layout-conversion coverage.

## Reproducible measurement

Use the pinned Node 22.22.3 toolchain and locked dependencies:

```sh
git show 05f9f7ab12e79bd1fe1a7dd938ca472750452594:src/lib/ledger-persistence.ts > /tmp/wafra-history-before.ts
node --test scripts/test/repair/history-storage-performance.test.cjs
node scripts/test/repair/history-storage-benchmark.cjs --baseline /tmp/wafra-history-before.ts
```

The benchmark executes the actual before/after persistence modules against identical synthetic transaction arrays and an in-memory adapter. It counts transaction bytes and chunk entries submitted to storage, with 1,000-record pages and 400-record chunks. It includes final completion/conversion. Metadata write count remains unchanged; output hashes match exactly.

| Imported transactions | Chunk writes before / after | Transaction bytes before / after | Fewer transaction bytes |
| --- | ---: | ---: | ---: |
| 10,000 | 140 / 54 | 11,842,540 / 4,438,934 | 62.52% |
| 25,000 | 819 / 138 | 70,266,569 / 11,354,718 | 83.84% |
| 50,000 | 3,200 / 274 | 276,391,200 / 22,708,354 | 91.78% |

A separate 10,000-record run reopening persistence every 2,000 records also returns identical records/cursor and the same 140-to-54 chunk-write reduction.

**These are not measured phone speedups.** The benchmark does not execute the Android SMS provider, Hermes, SQLCipher, React rendering or the full parsing/reconciliation pipeline. CPU-only serialization timings remain broadly similar because rows are still compared conservatively; do not claim off-thread parsing or a 92% reduction in import duration. The number of bank transactions, rather than every personal SMS in the inbox, drives this write cost.

## Remaining acceptance

Measure the installed Android build on the same phone/inbox, observing time to first useful result, messages checked per second, page save duration and frame pacing. Use body-free counters/timings, never upload a raw inbox. Test a data-preserving update from build 132, a pause/resume and process restart. Do not clear app data or uninstall to work around a signing mismatch. Existing unrelated browser/iOS acceptance failures are not waived by this optimization.
