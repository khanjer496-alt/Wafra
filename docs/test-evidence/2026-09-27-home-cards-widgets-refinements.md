# Device-feedback refinements — 27 September 2026

The owner reported overlapping payment logos, an empty native upcoming widget despite detected subscriptions, unclear Home/Spending hierarchy, limited Home customization, and cards that only opened statements. They also requested a working Left in budgets shortcut.

## Changes

- Bills replaces proportional logo pins with separate dated payment tiles. Every visible tile retains its date while scrolling.
- Widgets use cooperative subscription detection and the complete 30-day payment window. Incomplete imports retain a previous valid snapshot; cancellation and privacy invalidation prevent stale writes. Annual bills in the next month are included, and their detail/payment actions retain the selected due-month occurrence.
- Home leads with the selected spending total. Daily values keep exact amounts, short weekdays and equal-width tracks. The lower actions, insight and capture panels share the E design; insight content cannot be relabelled with a different reporting period while recomputing.
- Customize Home controls ten sections, including greeting/pattern, overview, Today/budget figures, week and capture. Sections can cross between the band and sheet, hide, persist and reset. Legacy choices survive migration. Save errors are visible, and native Back/swipe waits for pending saves. Navigation and important active recovery notices remain reachable.
- Spending keeps one period label and total across Categories, Compare and Calendar. Custom ranges have daily detail; long ranges/year/all use bounded month paging. Calendar rows follow the displayed month. The budget shortcut selects budgeted categories, while non-month scopes continue to show all spending.
- Cards open account-scoped recorded activity, credits/refunds, canonical card payments and factual details. Full history is virtualized with the same account/period and deduplication. Credit statements remain a separate action. Existing settlement allocation and financial authority are unchanged.

## Verification before installers

- Frontend and server type checking pass. ESLint has no errors (18 existing warnings).
- All 86 app suites have passed, including focused reruns after updating obsolete source contracts and regenerating test outputs. The import timing invariant passes in isolation; it exceeded its limit under concurrent build/test load.
- Complete interaction regression run: 2,412 passing, zero failures.
- Browser smoke: 65 passing, zero failures.
- Navigation sweep: 110 functional checks passed; the one viewport check treated intentional horizontal payment scrolling as clipping. The check now reveals and verifies every tile; the strengthened 316-assertion period/tile suite passes and the complete navigation rerun continues.
- Spending period/detail journeys: 4 language/theme/text-size cases, 316 assertions, zero runtime errors.
- Whole-Home layout journeys: 5 cases, 218 assertions, including Arabic 320px at 3.1x text, complete million-size figures, hiding optional capture prompts/pattern, persistence and reset.
- Card activity browser journeys: 2 cases, 56 assertions, including canonical repayments, all 63 virtualized rows, period changes, transaction detail, debit and unknown-balance cases.
- Home cashflow/budget navigation: 8 English/Arabic, light/dark, 320/390px cases pass.
- Independent reviews covered payment/date/privacy behavior, storage races, navigation guards, and large-text layouts. Targeted widget and annual-bill regressions, card allocation compatibility, and Home preference migration tests pass.

## Native and release boundaries

Build 349 is the previous signed baseline. Its isolated Android emulator confirmed the original graph-update and RTL-widget fixes. A later synthetic Spotify recurrence reproduced the owner's widget omission: Bills displayed the renewal while the actual launcher widget did not. That fixture is preserved for an in-place successor APK install.

During preparation on 349, an attempted manual card purchase encountered a blank app view and did not persist. Host probes found no unknown-card-specific save/reducer defect. The successor must verify immediate row creation, delayed durability, relaunch, and repeated Add opening, with JS logs as well as native crash logs.

The initial local full test command also started an unnecessary iOS app compilation on the host's older Xcode. That owned build was stopped; 394 Swift history host assertions had passed. Full supported-Xcode app/intent metadata validation is performed by CI and the signed iOS workflow. Browser tests and host assertions are not physical-device SMS, biometric, haptic or purchase evidence.

Run-specific APK/IPA paths, source revisions, signatures, native successor results and TestFlight processing are recorded in the generated local release status file under `artifacts/releases/`. Installer and TestFlight completion must be verified separately from the source checks above.

## Build 350 widget follow-up: untouched paused import

The preserved synthetic emulator fixture contained two manual Spotify expenses (USD 9.99 on 27 August and 26 September), groceries (USD 12.34 on 27 September), and a manual Netflix reminder (USD 9.99 due 28 September). The exported state had no dismissed/cancelled subscriptions, but its history import was paused with zero scanned, zero found, and a null cursor.

Replaying that exact exported state with the cooperative detector correctly predicts Spotify on 26 October. Native Bills All also shows the renewal; a fresh launch directly into Next 30 days shows both payments after eight seconds idle. The initial capture preceded its existing four-second first-analysis delay. No recurrence-algorithm regression was demonstrated, and that detector/delay is unchanged.

The widget guard treated even the untouched paused job as partial imported history, retaining the older launcher snapshot indefinitely. The corrected shared guard allows only paused/zero-scanned/zero-found/null-cursor jobs to update. Running, failed, partially scanned/found, or non-null-cursor jobs remain blocked. The Widgets preview notice and native snapshot producer use the same predicate.

Validation: 45 focused widget sync/preview/upcoming tests pass, including the guard matrix, English/Arabic preview/pinning state, and exact-money Spotify/Netflix recurrence. An additional local replay of the actual synthetic export produces USD 12.34 Today, Netflix 28 September USD 9.99 (not estimated), and Spotify 26 October USD 9.99 (estimated), with bundled logo IDs. Type checking, scoped lint and diff checks pass. Local evidence: `/private/tmp/wafra-apk350-device-qa/` and `/private/tmp/wafra-widget-untouched-tests.log`. This source correction still requires a successor native build; it is not proof that the installed build 350 has the fix. The separately observed native Add/save rendering failure remains a separate release gate.

## Build 350 transaction Save investigation

Saving a USD 22 Groceries purchase from Transactions to QACredit destroyed the Android React host while leaving the process alive. Fabric reported a child already attached to its parent during a remove/reinsert, followed by the screen's removal in the same mount batch. The failed views' 342/429 by 105 pixel dimensions match the pre-save Groceries/Entertainment suggestion chips. Saving changes the frequency ranking from Entertainment first to Groceries first.

A controlled retry used the same route, account, description and amount, changing only the category to already-first Entertainment. It returned to Transactions with the recorded USD 22 row and the same process ID. A cold relaunch retained the row in QACredit activity, and its detail showed the correct account/category/date/amount. That control supports the suggestion reorder during screen dismissal as the trigger; it does not itself prove a corrected installer.

Add now ranks the opening ledger for the lifetime of that entry. Direction changes still rerank, and a fresh entry uses the latest saved history. A source-render regression failed before the correction and passes afterward, checking both stable order during Save/navigation and updated ranks on the next entry (10 focused tests passing, including cold hydration). A successor signed APK must still repeat the original rank-changing Save and prove relaunch durability. Evidence: `13-purchase-account`, `14-after-purchase-save`, `36-control-before-save`, `37-control-after-save`, and `full-logcat.txt` under `/private/tmp/wafra-apk350-device-qa/`.

The subsequent interaction run completed 2,416 tests: 2,415 passed and one unchanged ledger-repair scaling check failed under concurrent host load. Its complete nine-test suite passed when run alone. The additional cold-hydration case was added after that broad run started and passes in the final ten-test Add suite. Final frontend/server type checking, scoped lint, and the independent 49-test review pass. These host checks do not replace successor installer validation.

CI's earlier navigation run had 110 passes and one first-heading reachability miss on Data and help, while all subsequent controls on that page worked. The test now waits up to four seconds for the same heading hit-test, preserving all 111 assertions and logging geometry on timeout. A targeted browser check verifies transient covering content clears, while permanent covers and missing headings still fail. A readiness race is the working explanation; the exact CI miss did not reproduce locally.

The complete navigation rerun passed all 111 checks with zero page errors, including Data and help readiness, full control sweeps, RTL, payment-tile fit, and live theme changes. The Android original fixture is restored for successor installer testing.
