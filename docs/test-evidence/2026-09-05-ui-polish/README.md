# Product and interface redesign — September 5, 2026

The user requested an overhaul of what the app shows and how it works, beyond
visual polish. These changes are prepared for the combined parser release;
this report does not establish a final APK, TestFlight build, or publication.

## Product decisions

- Home leads with recorded spending. Income and net cashflow remain secondary;
  missing income alerts no longer produce a debt-looking headline. Spending,
  income, and the period selector retain their existing navigation.
- Home excludes detected recurring forecasts from its obligation list. Dated
  card statements and saved reminders remain actionable. Urgent/overdue items
  appear before recent activity, and other upcoming payments appear after it.
  The previous combined money totals are removed.
- Flow presents spending composition and category limits before historical
  cashflow. The six-month chart, selected-month explanation, accessible
  alternatives, and detailed insights remain available.
- Bills initially prioritises open statements, showing the earliest deadline
  and remaining amount. Explicit segment choices persist. Mark paid opens the
  existing confirmation; it does not directly change the ledger.
- Recurring rows show the last actual charge, labelled as an estimated charge
  for scheduled predictions or a last charge for observed/unscheduled history.
  Annual and weekly charges are not replaced by their monthly equivalents.
  The separate monthly planning estimate keeps its established calculation.
- Wallet groups its overview facts and gives each instrument a clear identity
  and full-width amount. Duplicate card-count navigation and Home's duplicate
  insight widget are removed; their useful destinations remain reachable.

## Interface fixes

The overview has a distinct money panel; repeated explanations and navigation
blocks are reduced. Transactions combines search and filtering. Choice sheets
show selected options clearly. Credit-limit saving uses the shared footer.

Native checks exposed and fixed clipped Arabic titles, an iOS initial scroll
origin beneath the status bar, and a long-sheet wrapper that pushed actions
off-screen. Sheet height now accounts for the keyboard; content can shrink and
scroll while the footer stays visible. Existing dismissal, confirmation,
capture, and privacy callbacks are preserved.

## Verification

- Root TypeScript and scoped ESLint passed.
- UI foundation, screen preservation, and screen-section contracts passed.
- All 54 accessibility-layout checks passed. Changed assertions now protect
  the remaining actions and separate confirmation target rather than requiring
  removed labels or duplicate controls.
- `home-presentation.test.js` executes the actual production policies and a
  minimal rendering of Hero. It covers missing income, expense/income routes,
  preserved period action, forecast exclusion, obligation priority, unchanged
  amounts, annual/weekly charge amounts, and non-predictive payment history.
- Independent read-only reviews covered the redesign, financial presentation,
  contrast, layout changes, and tests. Findings were fixed: selected option
  description contrast and all Wallet large-text fact styles.
- iPhone 17 simulator, iOS 26.1: viewed all four redesigned tabs in English and
  Arabic, light and dark. These use the app's existing sample ledger, seeded
  only after confirming the simulator ledger had no accounts or transactions.
- Native Mark paid opened confirmation; Cancel preserved the displayed unpaid
  amount. Wallet still opened card details. Long card details exposed their
  footer, and credit-limit Save stayed above the keyboard.
- Native Flow preserved its scrolled position during a real theme change; the
  same section remained at the same measured position before and after.
- The simulator's text-size control did not confirm a changed size. No native
  iOS large-size pass is claimed; the layout contracts and review do not replace
  that check. Android verification of the redesigned source remains part of
  the final APK run owned by the integration task.

Screenshots are actual simulator captures. The four-tab light/dark English and
Arabic files show the redesign; focused confirmation/footer captures document
interaction checks and may retain earlier explanatory copy. The physical
iPhone and its real ledger were not modified.

`source-snapshot.json` records the 11 UI files matching the fixed Metro preview
snapshot. Parser/categorization integration continued separately. Rebuild from
the final combined source before updating download links or publishing Git.
