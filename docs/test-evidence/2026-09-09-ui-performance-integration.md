# Ledger & Light UI / performance integration — 9 September 2026

## Source and scope

Integrated the reviewed UI change set onto main at
`ca14f20f3e9de58e1041b0c36f5c850f86ef7d96`, including the newly shipped
inference of transfer ownership from independently observed accounts.
During publication, main advanced to
`f8527a22422cf0b136a7a8b36c955d4b65656c61` with iOS date-binding scripts.
That commit was merged unchanged, and the combined regression sweep was rerun.
The parser, accounting helpers, native modules, dependency versions and build
configuration are unchanged by this integration. Main's newer compact transfer
review notice was retained rather than replaced by the older local draft.

Transaction search is separate from the memoized results. Filter edits remain
in an isolated draft until Show results; Close discards the draft. Secondary
filter groups mount on expansion, actions stay in a fixed footer, and the full
ledger remains virtualized. Spending Activity eagerly previews eight entries
without changing full-period totals or the full-ledger link. Closed sheets
avoid native view trees. Detail reconciliation reuses unchanged financial
inputs, while changes to accounts or transactions invalidate it.

Home uses compact responsive Money in / Net figures. Row metadata, merchant
pages and shared headings are less repetitive. Settings now separates
Preferences, Imports, Privacy, Data and Help; export consent and the existing
write handlers are preserved. Accounts and goal forms keep their actions in
fixed footers. Android system-bar clearance is reserved in the viewport.
The approved Ledger & Light palette, fonts, logo and accounting distinctions
remain unchanged.

## Completed checks on the integrated checkout

- Approved-design guard: passed.
- App and server TypeScript: passed.
- Full repository ESLint: passed.
- Compiled the current shipping modules using scripts/test/build.sh.
- Repair / workflow / iOS-journey regressions: 595 passed, 0 failed after the final merge.
- Eleven targeted original contract suites: all passed (accessibility, money,
  accounting, dashboard, preservation, layout and performance configuration).
- Fresh Expo web export from the integrated checkout: passed.
- Diagnostic export: English/dark/390px and Arabic/light/320px passed, with
  explicit preparation and sharing consent and full synthetic-ledger coverage.
- Transaction UI: four viewport cases passed, including a 420px-high viewport.
- UI audit: 22 routes in two themes (44 render checks), plus two filter
  draft/apply/cancel and fixed-footer flows passed.
- Home: eight English/Arabic, light/dark, 320/390px cases passed with exact money.
- Transfer review: four English/Arabic and light/dark browser scenarios passed,
  including decision persistence, real backup export and virtualized history.

Structural tests were updated to inspect the extracted filter component and
shared buttons; browser navigation now targets Data for backups and exports.
No assertion for financial correctness or consent was removed.

## Verification boundaries

Browser data is synthetic. Browser timing and constrained viewport tests are
not physical Android frame timing or native keyboard evidence. No native iOS
build, store submission, production OTA update or device installation is
claimed by this integration. The full macOS npm test native-build gate was not
rerun here; the existing native workspace/build prerequisites are separate
from the completed JavaScript and browser checks above.

The Android candidate is to be built with the existing main-branch GitHub APK
workflow and persistent signing secrets. Verify the produced APK certificate
against the installed application before installation; do not use the
incompatible EAS signer or uninstall the existing ledger to bypass signing.

The original dirty checkout and its unreadable Git index were left intact.
Only this reviewed change set was integrated through a clean main checkout;
unrelated local iOS drafts and diagnostic/source exports were not published.

## Build and final validation follow-up

GitHub Android build 145 (run 34352941460) completed successfully from
`8f91a0bc791160597123ecf9366633fde50aa3b5`. The APK is non-debuggable,
ARM64, package app.wafra.android, version 1.0.0 (145), minSdk 24 / targetSdk 36.
APK SHA-256: `7060892f3ad3aff20403c4d3364040919421991d331d278a6a82f4ba3bdc45f2`.
Its v2 signature verifies with the expected installed-app certificate
`782b21c38c20f60425b171255718df54629c2909f3273c53e81d31fdbe3b446b`.
The embedded bundle contains the new transaction-filter-sheet and search
-toolbar markers. No device installation was performed.

The complete GitHub browser job for this source passed. The first GitHub check
job found an outdated routes assertion: it matched the new Privacy navigation
label rather than the actual Privacy section header. The final JavaScript
sweep also identified an old expectation that shared buttons do not wrap by
default. Both test-only assertions now follow the current implementation, and
two English/Arabic behavioral tests verify that notification controls remain
in Imports rather than Privacy or Data without mutating settings.

After these test-only corrections, all 71 original JavaScript suites passed
sequentially with generated iOS contract fixtures, and all 597 repair/workflow/
iOS-journey cases passed. This is not a native iOS build. The app source,
assets, native modules, build configuration and lockfile are identical to
build 145; this verification-only follow-up does not require a replacement APK.
