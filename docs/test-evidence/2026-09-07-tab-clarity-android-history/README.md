# Clearer tabs and Android history import

Date: 7 September 2026. Screenshots use the app's synthetic demo ledger, not a user's bank data.

## Implemented

Home has one spending summary, an income row, two upcoming payments and at most five recent transactions. Account balances remain in Accounts. Duplicate shortcut tiles and balance/net summary cards were removed; Add, Settings, complete Activity, Bills and capture recovery remain accessible.

Spending shows every category's percentage of the selected period's total spending. Filtering budgeted/unbudgeted categories does not change the denominator. Budget usage is separately labelled. Zero and tiny shares, Arabic, dark mode and large-text rendering are covered.

Bills groups subscriptions separately from utilities/telecom, card payments, loans and other reminders. Only detected subscription identity assigns the subscription group. Existing confirmed/estimated, paid/overdue and date semantics and payment confirmation callbacks remain intact.

Android history has a bounded foreground service and a matching Headless JS lifetime around the existing coordinator, not a second store or parser. The service has a generic notification with Pause, no raw financial payload, a 20-minute backstop, non-sticky lifecycle, foreground/permission startup checks and token-scoped cleanup. Existing encrypted page checkpoints and duplicate protection remain in place. Explicit Resume now works when progress is already paused. Older installed binaries fall back to foreground-only operation.

Foreground parsing retains its 8 ms / 64-row cooperative budget. Off-screen parsing allows 32 ms / 256 rows, returning to the smaller budget when the app becomes active. A deterministic 950-row scheduling test preserves every result and reduces timer yields from 14 to 3. This is not a device throughput benchmark or off-thread parsing claim.

## Verification

- App and Worker TypeScript checks and repository ESLint passed. Generated `builds/` snapshots are excluded without excluding shipping source.
- `node --test scripts/test/repair/*.test.cjs scripts/test/workflows/*.test.cjs`: 161 passed, zero failed.
- Updated Playwright route/interaction sweep: 41 passed, zero failed, including 320/430 px Home and Spending, all tabs in light/dark mode and no JavaScript page errors. See `browser-results.json` and screenshots.
- All 71 legacy app test files were executed. The two initial failures were obsolete static assertions for the previous flat bill grouping and foreground-only scheduling expression. Their updated assertions passed on recheck; 288 contract assertions, the UI-preservation contract and 24 numeric-input regressions passed.
- The actual Android module compiled with `:sms-reader:compileDebugKotlin` under Expo SDK 55 / React Native 0.83.10, compile SDK 36 and JDK 17. The final compile succeeded. Native compilation caught and resolved the direct React dependency and Expo's generic Context typing. See `native-kotlin.log`.
- The full `npm test` command is not reported as green: it passed 348 native Swift history-store assertions, then stopped because the local `ios/Wafra.xcworkspace` was missing. Remaining app checks were run separately as described above.

## Remaining device acceptance

No connected physical Android device was available, and this task did not produce or install a new APK. The service requires a fresh native binary; a web/OTA-only change is insufficient. Test a large inbox while switching apps and locking the screen, notification Pause, Resume, permission revocation and restart from a saved checkpoint. Confirm no duplicated or missing transactions and measure actual device throughput before claiming a speedup. Force-stop/process-kill recovery must be distinguished from ordinary backgrounding.

No independent worker review was available. No commit, push or release command was issued by this task; a concurrent integration session created commit `db2158e` while verification was still underway. Final native/test fixes and this evidence were added afterward.
