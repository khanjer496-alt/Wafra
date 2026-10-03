# Integrated E redesign release candidate — in progress

The user authorized finishing the full redesign (including onboarding), adding visible graph values and subscription logos to widgets, testing, building the final APK and submitting TestFlight. Publication still follows AGENTS.md's explicit commit/push authorization rule.

## Source

Review checkout: `/Users/naserkhanjar/.codex/worktrees/wafra-redesign-release/Wafra`.
Detached baseline `11cf455c` is the saved merge of `claude/redesign-rest` with PR118. Original checkout `/Users/naserkhanjar/Wafra` and all Claude worktrees remain intact. `origin/main` was `c7b6f1b8` when checked.

Integrated without creating commits:
- Saved E design and onboarding (`fc689816` is an ancestor).
- Recovered uncommitted Accuracy, Widgets, Android pin bridge and Home hint from `e-remaining`.
- PR118 follow-up `951c352d`; reconciled stated-time/v55 work is under review.
- Saved reminders/lock/crash changes from `reminders-lock-crash-v2`, with discovered privacy and date-window fixes.
- Remaining iPhone setup flows, exact graph figures and annual recap detail, widget service logos and exact seven-day total.

The separate unfinished parser-AI/learned-format experiment in `parser-ai-wire-v2` has not been imported. Its staged and unstaged changes remain in its original worktree.

## Evidence so far (not a release claim)

- App TypeScript check passes; whole-tree lint had 0 errors and 19 warnings.
- Setup UX: 281 passed; setup/notification presentation: 16 passed.
- Widget implementation: 39 focused checks; later parent widget/history checks: 30 passed.
- Native widget extension simulator build succeeded with logo asset catalogue; Android widget resources linked and Kotlin renderer/providers compiled against SDK36.
- Reminder regression checks: 35 passed. Native notification store harness: 33 cases passed. App-lock22 and contracts306 passed.
- E browser route sweep: 40/41 after correcting stale E selectors. Remaining assertion revealed missing explicit web ARIA selected/pressed state; source is fixed, awaiting re-export/rerun.
- Full integrated test suite, final browser acceptance, signed APK and TestFlight availability are not yet complete.

## Local validation paths

- Current web preview: http://localhost:8148 (`/private/tmp/wafra-redesign-web`). Re-export after final source changes.
- Mockup gallery/download: `/Users/naserkhanjar/Wafra/docs/design/mockups-2026-09-26/` and http://localhost:8147.
- Tool logs: `/private/tmp/wafra-release-*.log`, `/private/tmp/wafra-e2e-redesign*.log`, `/private/tmp/wafra-widget-*.log`.
- Kotlin compiler (official archive SHA256 checked): `/private/tmp/wafra-kotlin/kotlinc/bin/kotlinc`; Java at `/opt/homebrew/opt/openjdk/bin`.
- Use Node `/opt/homebrew/opt/node@22/bin` (22.22.3); system Node is26.
- Physical Android phone is not attached; only emulator5556 was seen. No iOS simulator was booted. Do not call simulator or host results physical-device proof.
- Global EAS CLI21.7 is too old; `npx --yes eas-cli@23.2.0` works. Latest EAS-hosted entries are old; recent successful iOS releases used GitHub macOS local builds. Latest successful iOS workflow inspected:36104874896, including verified IPA and TestFlight submission.
- Regenerating an existing iOS project hit apple-targets' `removeFromProject` error. Preserved generated directory at `/private/tmp/wafra-redesign-ios-prebuild-preserved`; a fresh prebuild succeeded. No product-source dependency workaround made.

## Remaining delivery gates

Complete independent reviews and all tests; re-export final source; exercise onboarding/EN-AR/dark/large text and widgets; review exact candidate diff. Obtain concrete authorization for commits/main publication if not already explicitly granted in the conversation, then run canonical CI/build-apk/ios-testflight workflows on the verified source. Check signing/source hash, download APK, test installation on the available emulator, and check actual App Store Connect processing/group availability. Report physical-device gaps separately.

Phone notification warning: the rich original Android notification concept has more visual details/actions than current OS-native title/body banners. Do not describe the mockup as fully implemented. In-app capture toasts are implemented and App-Lock aware. No new notification financial actions have been added.

## Later verification and corrections

- Final capture reconciliation focused checks: capture identity56, Kotlin113 (real store included), parser1407, import-plan350, Android review141 — all passed. Retains merchant/direction/body evidence before native dedupe, and protects edited titles without collapsing different purchases.
- Independent review found Daily Summary could resume a schedule after opt-out; fixed with consent generation plus serial native mutations. Eight actual-module race tests passed; independent reviewer found no new material issue.
- Native history host suite:394/0 (~5min, two10k-record fixtures). Its full script then failed at absent `ios/Wafra.xcworkspace`; supported-Xcode app compilation/metadata remains a cloud gate. Other native live capture/resource and queue-signal scripts passed; queue signal16/0 and resources156/0.
- Declared app-suite coverage checked:86 unique declared suites equal86 files/expected count. Batch passed83 first; remaining routes/accessibility/UI-contract failures asserted the obsolete conditional month-value list and were corrected/rechecked successfully. Numeric-input and onboarding-action suites passed. Universal round2:7/7; server tests passed.
- Complete interaction regression rerun:2317 passed,0 failed,0 skipped. Subsequent bounded Home/figure/transfer changes have separate focused/browser checks below.
- User noticed Home below weekly graph still used old order. Default now due/upcoming/activity/assistant/insight; monthly summary and widget hint moved lower; custom saved ordering preserved. Projected bills/subscriptions marked estimated, exact currency amounts retained, and activity has visible selected-period context. Home focused18/0; preferences passed.
- Browser exposed two actual bugs: million-scale Arabic BandFigure clipped at320px; fixed base-size fit and currency stacking (seven new regressions plus existing25 checks). Transfer classification save silently failed in compiled Metro output due default-argument shadowing; explicit save(selection) fixes it, focused34/0; unchanged browser test still to rerun on fresh export.
- Browser suite coverage through agent: diagnostic export EN/AR passed; UI-cleanup46routes+2filter flows; smoke65; transaction4; Homecashflow8 (pre-final Home-order export); merchantspending4; period15; Ask29; Ask analysis28; large15k ledger; persistence; universal review15; merchantlogo16. New final browser checks must use current export.
- Original onboarding browser acceptance was wholly pre-E (focus/tracking/alerts/intention). Agent `finish_capture_design` owns its replacement with actual E journey while preserving empty-ledger/no-fake-capture, EN/AR, reload/Back, large-text and reduced-motion assertions.

### Current runtime state

Latest source export in progress: `/private/tmp/wafra-release-final-web`, Metro cache isolated under `/private/tmp/wafra-release-final-metro`, log `/private/tmp/wafra-release-final-export.log`; serve8151 when complete. Older app previews8148/8149/8150 stay alive for running QA.8150 has first corrected Home hierarchy but predates later period-context/estimate/figure/transfer fixes. Mockup8147/download ZIP is separate from product source.
Final type/lint running into `/private/tmp/wafra-source-final-{typecheck,lint}.log`.
No commit or push made; detached baseline remains11cf455c. Canonical source dirt preserved.

## Local candidate gate complete

The final candidate at8152 passed onboarding4/4 (EN/AR,320px2x/3.1x, native-style font emulation, Reduce Motion, durable reload), smoke65/0, Homecashflow8/8, navigation111/0 (full control/sheet sweeps, exact financial drilldowns, Arabic/RTL, live theme switch), and final graph visuals16/16. Native-width million amount clipping is fixed; merchant entrypoints2/2 passed. Transfer review4/4 passed saving, correct3106-row backlog counts, a truly empty queue, real backup download equality, Undo and non-loss. Earlier route/design sweep41/41 passed.

Onboarding browser acceptance was rewritten for actual E steps, preserving strict ledger/capture/consent assertions. It exposed/fixed missing web checkbox state, an enabled free-finish button during a blocked transition, and Arabic large-text legal-link overflow. No delay workaround was added to acceptance.

All86 app suites have passing results (three stale graph-contract assertions were corrected and rerun); complete interaction suite2317/0, with subsequent bounded Home18, transfer34, figure32, finalgraph34 and onboarding source60 checks passing. Typecheck passed. Lint:0errors,18existing warnings. Independent reviews and git diff --check passed. Native host394/0; live resources156/0; queue signal16/0. Native widget extension and Android widget resources/Kotlin compile succeeded. Full native app/metadata validation awaits supported cloud CI; no physical-device result claimed.

Review gallery71 actual browser screenshots (synthetic data only): `/Users/naserkhanjar/Wafra/docs/design/release-preview-2026-09-27/`, localhost8153. Interactive source preview:8152. Code remains local, uncommitted, detached11cf455c. Next required user authorization is commit/integrate/push to main; APK/TestFlight builds were already requested, but repository rules separately require explicit Git publication approval.

## Publication handoff

The user followed the explicit commit/main-push/build approval question with “build latest APK”. Proceeding with that proposed publication path, prioritizing the Android installer. Before publication, all240 selected files matched the verified manifest byte-for-byte, frontend/server typecheck passed again, and staged diff checks passed. Dependency symlinks, Python caches and unrelated canonical marketing drafts are excluded.
