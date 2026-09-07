# Transaction UI correction

Based on main 01c9ddda17d79558930457fecdd3f6357739aa55. No financial, parser, import, encryption, branding, dependency or release-configuration change.

- Entry details place Edit/Delete and Save/Cancel in the existing fixed sheet footer. Labels wrap and large-text actions stack. Delete still needs confirmation; invalid amounts cannot save.
- Search has a short visible label and placeholder, retains its accessible name, and expands to full width on narrow/scaled layouts. Opening a row/filter dismisses the search keyboard.
- Count/period, labelled net total, and exclusion explanations no longer compete for one horizontal row. Amount calculations and filters are unchanged.
- Noon One is an explicit display-only logo alias. Unknown composite merchant names remain unknown.
- Source no longer presents transaction.date as a filing timestamp. A separate Transaction date row uses the existing full date/time formatter.

Validation: original regression cases failed before edits. Corrected focused component checks, approved design guard, typecheck, lint, and full npm test passed. Real Expo/Chromium tests passed at 360x780, 390x844, 320x568 and 390x420. They hit-test both actions, check fixed footer position after scrolling, open editing and cancel it, verify placeholder fit, and check date labels. The short viewport is NOT a native keyboard test.

Physical Android/iOS rendering, actual system-keyboard and navigation-bar geometry, and a data-retaining installed-app upgrade remain unverified for this change. No APK, TestFlight, OTA or website publication was performed. Native storage and all financial safeguards remain unchanged. Add these ordinary source files to the combined release rather than rebuilding an older branch.
