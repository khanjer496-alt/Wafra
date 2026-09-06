# Android build 131 recovery — implementation evidence

Base: b96b25372e34ce797f449bd621c872561d94bd0b (Android 1.0.0 / 131).
Performance commit: 30a914d2bb4355c677cfdd049c634aa84c013801, draft PR #22.
Visual work is a separate stacked change, not a production release.

## What changed

Performance: indexed transfer matching with preserved nearest/tie rules; no redundant encrypted save for genuinely empty review stages; UI yield before import planning; optional unused-insight suppression and bounded Home activity selection. Parsing remains cooperative JavaScript, not a native worker. Parser grammar, currency validation, retention, encryption, purchase checks and database schema are unchanged.

Design: Home now uses a net-position spread with definition, paired income/spending facts, date-grouped activity before healthy capture status, and compact import/review controls. Interrupted history retains an explicit recovery action. Shared transaction rows separate merchant/amount, category/time and account identity, stack for larger text, and preserve inbound-transfer signs. The four tab routes and detail sheets remain. Full Bills/Wallet/Flow screen layouts have NOT been redesigned in this pass. The old Home component remains in source for reference and existing tests but the index route selects journal-home-screen.

## Completed local checks

- 31 source-executing behavioural/component-contract tests, zero failures or skips (Node 22.16.0, Linux). Native modules, React hooks and view primitives are explicitly stubbed; this does not prove native rendering or real SMS capture.
- Differential transfer matching across 400 seeded mixed ledgers and boundary/tie/archive/salary/refund tests.
- Empty-review, real-review, source-binding, pause/generation and failed-save acknowledgement tests.
- HTML component preview inspected at 320/390/1080 widths, both themes, English/Arabic, standard/130% text: 24 combinations, no horizontal overflow found. This is a lightweight HTML mapping of source structure, not an Expo export, actual Android screenshot or native acceptance test.

## Narrow synthetic benchmark

Median of three runs of equal-amount, date-fallback transfer matching:

| Rows | Build-131 reference | Indexed |
| --- | ---: | ---: |
| 1,000 | 29.433 ms | 1.808 ms |
| 5,000 | 685.953 ms | 7.177 ms |
| 10,000 | 2,839.558 ms | 16.462 ms |

This measures one calculation only, NOT SMS parser throughput, database writes, end-to-end imports, startup, or phone frame rate. Reproduce with `node scripts/test/repair/benchmark.cjs` after installing repository dependencies.

## GitHub checks already observed for performance PR #22

Run 34039951942: app/server typecheck, lint, root test suite, relay tests and Worker dry run passed. Native iOS job was skipped by its existing path gate. Browser E2E failed on Home wording/obligation checks and timed out locating the Flow tab; those failures are not waived. No baseline browser run has established whether they predate this repair.

Run 34039952144: new behavioural regressions and synthetic benchmark passed; evidence artifact uploaded.

## Release gates still open

- Full CI on the final visual commit, including a passing browser route/interaction audit.
- Actual native Android release screenshots in both themes, Arabic and larger text.
- APK build and signing/upgrade verification before distribution.
- Same-device/same-inbox comparison of time to first result, complete import duration, retained transaction accuracy, navigation during import, and interrupted-import resume.

No phone data, permissions, existing Git branches, main, published APK, or production deployment was changed. There is no claim that all causes of the user's slowdown or parser misses have been resolved.
