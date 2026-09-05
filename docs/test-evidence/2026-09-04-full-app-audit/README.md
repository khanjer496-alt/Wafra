# Full-app audit evidence

Audit began September 4; verification completed September 5, 2026 (Dubai).

See [the full report](../../full-app-audit-2026-09-04.md). Existing application changes were preserved. No findings were fixed in this audit.

## Fresh verification

| Check | Result |
| --- | --- |
| `npm run doctor` | 20/20 passed |
| `npm run typecheck` | App and server passed |
| `npm run lint` | 0 errors, 2 duplicate-import warnings in charts.tsx |
| `bash scripts/test/run.sh` | Exit 0: 67 app + 3 server + 2 native Swift suites |
| Native history/store | 348 passing assertions |
| Native live capture | Store 130, bridge 51, resources 78 passing assertions |
| Native application build | Clean iOS Simulator build; generated App Intents and Arabic resource checks passed |
| Fresh web smoke | 63 passed, 0 failed |
| Fresh web period | 13 passed, 0 failed |
| Fresh web persistence | 6 passed, 0 failed |
| Fresh web navigation | 65 passed, 0 failed, isolated rerun exit 0 |
| `node scripts/check-release-config.mjs` | Exit 1: 9 local configuration/documentation blockers, detailed in the report |

The web export used `E2E_DIST=/tmp/wafra-audit-web E2E_PORT=8136 BASE=http://localhost:8136 bash scripts/e2e/run.sh`. The first three suites passed; navigation hardcodes port 8126 and failed to connect before testing. The same export was then served with `node scripts/e2e/serve.mjs /tmp/wafra-audit-web 8126`, and `node scripts/e2e/e2e-navigation.mjs` passed. No source changes or duplicate export were needed for this workaround.

## Reproducible defects

[parser-probes.cjs](parser-probes.cjs) invokes the shipping modules compiled by the test harness and uses existing redacted/synthetic fixtures. After running the root test suite, run from any directory:

```sh
node /path/to/Wafra/docs/test-evidence/2026-09-04-full-app-audit/parser-probes.cjs
```

[parser-probes.json](parser-probes.json) records the audit output: AED amounts relabeled into USD/KWD plans, different salary direction between paste and shared interpretation, and immediate expiry of an old Android review discovery. Output includes structured fields and fixture provenance, not raw bank-message bodies. The script is an audit probe, not a new passing regression suite. Its rerun matched the saved JSON byte for byte.

## Visual and environment evidence

- [Home](home-web.png), [Flow](flow-web.png), [Bills](bills-web.png), and [Wallet](wallet-web.png): current-source SDK 55 web export at 390×844 with synthetic demo data; captured through Argent Chromium.
- [Installed iOS setup](ios-setup-installed-build.png): WafraClean iOS 26.1 simulator's pre-existing native app. Its source revision and native-module freshness were not established. It showed an unavailable install link and a history setup error; this is not evidence of a tested release candidate.
- [Environment snapshot](environment.json): environment-inspector result, preserved as returned. Its notes describe pre-test inspection; the completed checks above supersede its statements that execution had not yet been performed.

Native app build success does not establish physical Message automation, store purchase/restore, or comprehensive VoiceOver/Dynamic Type correctness. This session did not perform those tests. Existing physical-device evidence remains separately identified in the report.

Read-only reviewers independently checked parser, onboarding, and broader code findings and reviewed the report for unsupported claims. Corrections distinguish source-derived setup scenarios, reproduced helper/import-plan behavior, and observed UI.
