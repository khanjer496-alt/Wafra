# Combined session release: merchant drill-down and transaction UI

The owner requested the latest completed session updates on `main`, committed,
pushed and included in one new Android APK. The starting release source was
`01c9ddda17d79558930457fecdd3f6357739aa55` (Android build 136).

## Included work

- Merchant implementation `2ae77e86a771accf2141fb6a35f6531a048bff0f`: exact-name
  merchant totals, searchable directory, shared periods, bounded recent activity,
  separate merchant/transaction touch targets and explicit all-type Activity links.
- Transaction UI PR #27, through `12949f1fd5731d007b27e292047c3bc470a8716e`:
  fixed Edit/Delete and Save/Cancel footers, narrow-screen search, readable net and
  exclusion lines, separate source/date labels and the explicit Noon One logo alias.
- Build 136's In/Out/Net, parser version 34, retained-business-income repair and
  completed-purchase-refund correction remain unchanged. Ledger & Light colours,
  typography and launcher assets, import storage and native capture are preserved.

The old recovery/release worktrees were inspected and left intact. They are not
used as a replacement source for the new release. The completed merchant changes
were committed by their session while this audit was underway; no duplicate
merchant commit or competing release baseline was created.

## Integration repairs

The transaction and merchant changes merged together without dropping either
feature. Regression selectors now distinguish merchant navigation from individual
transaction details and follow the shorter visible search wording while checking
its full accessible label. The dedicated Android repair job now compiles its
shipping-module fixtures before executing accounting tests, rather than failing
with missing modules. Existing source checks were not removed. The normal test
runner also executes the iOS journey suite, and CI retains the new browser evidence.

## Verification before APK dispatch

Application/server typechecks, lint, the design guard, all 71 application test
files, numeric-input and server tests passed. The combined repair/workflow/iOS
journey suite passed 337 tests with zero failures or skipped tests.

Actual local-browser checks passed for transaction UI at four viewport sizes,
Home cashflow in eight language/theme/width cases, merchant directory in four
cases and direct merchant entry points in two cases. The initial integration run
caught outdated search selectors; the corrected direct-merchant checks passed.
Screenshots of the merchant view and fixed action footer were visually inspected.
Full post-merge CI and binary verification are recorded separately for the exact
APK source and artifact; this source note does not assert that a build exists.

## Scope

All exercised ledgers were synthetic. No private SMS, real ledger or physical
phone was accessed. Browser checks do not certify native keyboard geometry or
on-device performance. Incoming merchant payments remain separate from spending;
the app does not guess which credits are refunds. No TestFlight submission,
production OTA, website deployment or device installation is part of this merge.
