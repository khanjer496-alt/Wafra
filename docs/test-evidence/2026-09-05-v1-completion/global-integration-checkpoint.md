# Global integration checkpoint

This records the continuation after the older iOS51/Android23 artifacts. It is not a final release approval or evidence that these changes are installed on a physical phone.

## Verified in this continuation

- The root test runner includes the round-two global parser suites. A fresh run passed all seven suites and the existing parser performance invariants.
- App and server TypeScript checks passed after removing the server's type dependency on a React component. `IconName` now lives in `ui/icon.types.ts`, retains all 49 identifiers, and remains re-exported by `ui/icon.tsx`. Independent review confirmed no UI/native runtime dependency enters the shared server parser.
- Native history-store tests passed 348 checks. The actual Xcode build passed and verified the ten history intents and distinct English/Arabic 46-key resource tables in the app and nested bundle. Live-capture store/bridge/resource tests passed 130/51/78 checks; Debug and Release App Intent source checks also passed.
- New precision regressions demonstrated that AED 0.49 + 0.49 became zero, AED 0.51 + 0.51 became 2.00, and KWD 0.001 could disappear in dashboard/Wallet projections. The dashboard also rounded income using a hardcoded scale of 100.
- Dashboard income/spending/net, Flow category composition totals, and Wallet reliable balances/debt now retain exact minor units. The focused source suite passes 32 checks, including AED/KWD/JPY, pooled categories, small debt, unknown balances and archived-account exclusions. Independent review approved these three selector changes.

## Still pending

- Complete combined app/server/native verification after the later precision and design changes. The running gate compiled source before those later edits; do not attribute its compiled-module results to the final source snapshot.
- Final-brand UI verification. The expanded browser acceptance already passed 14/14 against a fresh export: French/Japanese purchases, Spanish and Arabic statements, explicit currency/date choices, Other income, category correction, reload, and refusal to add messages containing multiple principal events. Its log is `/tmp/wafra-round2-review-e2e.log`; this verifies synthetic browser flows, not native delivery or the final design.
- Matching exact money formatting in the UI, final new-brand verification in light/dark and English/Arabic, and final matching signed builds.
- Final physical iOS capture/history and Android upgrade checks. Existing Android23 synthetic SMS checks and physical build45 observations remain separate evidence.

Logs for this checkpoint: `/tmp/wafra-global-combined-final2.log`, `/tmp/wafra-global-final-typecheck2.log`, `/tmp/wafra-dashboard-precision-red.log`, `/tmp/wafra-wallet-precision-red.log`, and `/tmp/wafra-wallet-precision-green.log`.

The round-two original unseen result remains 2/24 parser and 4/8 categorization before fixes. The later passing exposed regression cases must not be described as an independent unseen score or worldwide automatic parsing coverage.

The combined run finished native and server checks, then stopped at five unit assertions because compiled modules still used the previous rounded display policy while the source tests had changed to exact amounts. All five failures show that old/new mismatch (four formatting cases and Wallet total). Rebuild and rerun the current app suites before reporting the integrated source green; do not waive the failures.

After a fresh rebuild, all 70 app suites ran. The first pass exposed obsolete rounded-display expectations, a test harness missing the real source-binding dependency, and contracts still reading the moved icon union. These were corrected while preserving their assertions. A diagnostic export defect was also fixed: figures now use the ledger currency/exponent instead of hardcoded AED and division by 100. Its report suite passes 36 checks, including KWD/JPY, and independent review found no runtime cycle or currency mismatch.

The next current-source run finished with 69 passing suites and one failing Cards copy assertion (`routes.test.js`, purpose subtitle changed during redesign). A simultaneous typecheck found the in-progress typography reference `TABULAR_FOR_WEIGHT` undefined. Both findings are assigned to the active UI owner; until resolved, the combined app is not green. Logs: `/tmp/wafra-current-app-gate2.log` and `/tmp/wafra-current-final-typecheck.log`.

Both remaining findings were subsequently corrected. The Cards test now checks the stored-card list, opening a card and its detail sheet, and passes 54 checks (`/tmp/wafra-current-routes-final2.log`). Thus all 70 app suites have passing current-source evidence through the 69-suite pass plus the focused corrected route suite, rather than a claimed single uninterrupted 70-suite run. The undefined typography mapping was fixed by its UI owner. The requested tab labels now read Spending/Accounts and الإنفاق/الحسابات, with unchanged route keys.

Fresh root and server TypeScript checks now pass (`/tmp/wafra-current-final-typecheck2.log`). Scoped core lint and changed-path whitespace checks pass. The integration source is handed back to the release/UI owner for final brand device QA and matching artifacts; this checkpoint does not authorize claiming a final signed release or physical SMS delivery.
