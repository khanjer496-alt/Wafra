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
