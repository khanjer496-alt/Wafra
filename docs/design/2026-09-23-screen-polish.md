# Current-app design polish · 23 September 2026

## Scope

Improves the existing Ledger & Light app, following a source inventory and a fresh browser walkthrough. This does not apply either experimental concept shown earlier in the conversation.

Starting source: `main` at `d95c3d892462b284e7524445d8c09005429cb0b3`, matching the remote main revision when work began. Existing untracked recovery material was preserved. No commit, push, deployment or store submission is part of this task.

## Changes

- Shared section headings use readable sentence-case hierarchy. Screen subtitles have their own line; sheet titles are stronger and sheet subtitles can wrap. The full close target remains available with quieter visual treatment.
- Text fields share persistent labels, an explicit focus border, error precedence and multiline alignment. Account, goal, date and trusted-device fields use this treatment.
- Home keeps its financial summary while reducing excess vertical spacing.
- Spending places the chart and legend beside each other when space permits. Exact amounts retain their cents; wide amounts and enlarged text move outside the donut. Period controls are consistent across its views.
- Transaction editing uses a compact identity row instead of repeating the large read-only summary. Long merchant names wrap, and destructive actions are visually secondary while retaining confirmation.
- Manual entry puts description after amount and replaces the tall category grid with a labeled chooser. Known-alert review exposes the captured institution, instrument, selected account and explicitly labeled alert date. Generic alert review shows only an explicitly captured merchant/date, the selected account, issuer uncertainty and a separate alert date. Ambiguous evidence controls remain editable; neither path invents a merchant or transaction date.
- Recurring-payment sheets use one vertical scroll area, preserve the bounded history preview and provide the merchant-history destination. Identity, amounts and actions adapt to enlarged text.
- Accounts has smaller section headers and less redundant explanation. Its complete balance disclaimer appears by the reported total. Goals and account controls are reachable earlier.
- Period navigation has 48px year controls, actual disabled states, visible date labels and concise date-format placeholders. Larger text gets a two-column month grid and stacked dates.
- Settings uses spacing and row separators instead of borders surrounding every heading. Pro, Home customization and imports remove repeated headings. Onboarding's three-bill example now says three bills in both languages.
- Recap footers separate currency from exact amounts and wrap on narrow/enlarged layouts. The final recap summary also allows full values to wrap. Bank avatars retain their fallback glyph until the current logo has decoded, avoiding empty loading tiles without changing logo resolution or privacy behavior.

No parser, monetary calculation, payment allocation, storage, billing, capture or trusted-device authorization logic was intentionally changed.

## Page and mini-page inventory

All of these surfaces were included in the source audit. Browser screenshots and interaction logs under `artifacts/design-polish-20260923/` distinguish rendered coverage from platform-only behavior.

| Journey | Pages and nested surfaces examined |
| --- | --- |
| Home | Summary, insight/assistant/activity/payment sections; period, transaction, bill and card-payment sheets; customization and recap |
| Spending | Categories, Activity and Trends; category history, limit editing, transaction history, period, merchant and foreign-currency destinations |
| Transactions | Search and filters; details, editing, category/account selection, remembered rules, delete confirmation; manual entry and review correction |
| Merchants/currency | Merchant list and detail, payer detail, currency groups, scoped transactions, period and transaction sheets |
| Bills/cards | Payment agenda filters; recurring and manual reminder details; history, new reminder, card/statement detail, credit-limit editing, account actions, bank/currency selection and confirmations |
| Accounts/goals | Balance coverage, account groups, archived accounts, add/manage account, bank selection, new goal, goal contribution, deletion confirmations and currency selection |
| Ask Wafra | Suggestions, question input, answers, coverage, findings, period context, evidence and nested transaction details |
| Review | Pending alert review, known/universal correction, dismiss/complete states; transfer review, ownership/counterpart confirmation, undo/retry; categorization and accuracy |
| Imports/setup | Paste/scan/history, progress/results/save and recovery; statement selection/password/review; iOS setup/details/privacy/restart and paged-history states |
| Preferences/support | Settings groups; appearance, language, currency, privacy, export scope and diagnostic sheets; feedback and its exact outbound report; parser-research gate and report states |
| Devices/Pro | Trusted-device setup, join, manage, rename/revoke/leave/delete confirmations; Pro trial/active/unavailable-price states and purchase/restore/manage controls |
| First run/recovery | Welcome, name/country, focus, tracking, delivery, intention, preview, capture and completion; lock/storage recovery source; missing-route recovery and Stats compatibility redirect |

## Verification

Read the SDK 55 reference before React Native edits: <https://docs.expo.dev/versions/v55.0.0/>.

- App and server TypeScript checks pass. Full repository ESLint reports zero errors and 18 existing warnings; focused checks cover subsequent edits.
- 140 existing presentation/transaction/merchant/home/transfer regression tests pass.
- UI foundation and UI polish contracts pass; accessibility layout checks pass 58/58.
- General contracts: 303/303. Onboarding: 220/220. Trusted devices: 12/12. Feedback: 116/116. Routes: 52/52.
- The large-total donut regression preserves the exact amount and still checks aggregate-tail identity and slice selection.
- Recap checks pass 23/23, and the bank-logo resolver contract passes. Independent review also covered the recap money layout and logo loading-state change.
- Focused manual-entry probe confirms category selection closes the picker and saves AED 125.49 exactly. Review rendering makes no ledger mutation.
- Generic-review checks pass 28/28. The purchase fixture shows its captured merchant and account; an ambiguity probe confirms that unknown merchant/date evidence is not asserted as fact.
- Fresh demo-export browser suites pass: smoke 64/64; period 15/15; navigation 105/105; redesign 41/41; UI cleanup 44 screen renders and two filter flows. Navigation includes Arabic fit, live theme changes, merchant/category handoffs, exact-cent reconciliation, and sheet dismissal.
- After the last refinements, six real browser save flows pass across both themes: generic AED 89.50, registered USD 18.50 and manual Dining AED 37.25. Recap slides 2/5/8 pass 12 clipping checks across 390px/320px and both themes. The blocked-network bank image retains its card glyph.
- Ask Wafra's answer → evidence → nested transaction flow passes in both themes: AED 1,142.39 matches five supporting rows, and the selected Lulu Hypermarket transaction shows AED 251.36. Both the answer and nested mini-pages were visually checked after sheet transitions.
- Independent read-only review of the complete change and the later form/chart refinements found no actionable application regression. Obsolete tests for nested history scrolling, raw inputs and abbreviated large totals were updated without removing their behavior checks.

## Evidence boundaries

Browser captures use synthetic local demo data, with external requests blocked. They are actual Expo web renders, not product mockups or store screenshots. The web demo is enabled only for this local QA export.

The standard 320px route/theme sweep found no horizontal page overflow across 30 captures. A separate browser-only 200% text injection exposed overflow on the four main tabs in both themes. That stress technique does not update React Native's `fontScale`, so it is recorded as a browser text-stress limitation, not as a native Dynamic Type result. Native font-scaling layout branches are covered by component tests but still require device rendering.

No Android device was attached, and no configured iOS simulator device was available. Native keyboard behavior, VoiceOver/TalkBack, physical capture/import triggers, store checkout and native provider paywalls remain device-verification work. Service-dependent states were inspected in source or their available local/error presentation; this task did not create remote vaults, send feedback, import private statements or make purchases.

## Local review

Latest sample-data app preview: <http://localhost:8130>. It is served from the final Expo web export, not either earlier standalone concept. The service is local and lasts while its preview process runs.

The final tested tracked diff matches the working tree byte-for-byte at this checkpoint: SHA-256 `5e64206e4a4a16ff95f8d37191c6df21239fcf6209f753b18708b68f0c625092`. The audit document itself is an additional uncommitted file. Detailed route coverage, screenshots, fixture results and logs are retained under `artifacts/design-polish-20260923/`.
