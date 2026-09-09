# Ledger & Light UI / performance integration — 9 September 2026

## Source and scope

Integrated the reviewed UI change set onto main at
`ca14f20f3e9de58e1041b0c36f5c850f86ef7d96`, including the newly shipped
inference of transfer ownership from independently observed accounts.
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
- Repair / workflow / iOS-journey regressions: 588 passed, 0 failed.
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
