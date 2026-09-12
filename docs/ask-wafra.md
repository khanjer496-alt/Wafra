# Ask Wafra

Ask Wafra is an English-first, local way to explore the transactions recorded in
Wafra. Additional localization is deferred. The assistant uses the ledger's
stored currency and decimal precision; it does not assume a particular country
or convert amounts merely because the user changes their market preference.

## Supported questions

- Spending and income totals, including salary and business income.
- One or more exact merchants, categories, or named live accounts, with explicit
  exclusions. Values within a dimension are combined; different dimensions
  intersect. Excluding a category removes only that portion of a split receipt.
- Category and merchant comparisons, top merchants/categories, largest
  purchases, and daily spending averages.
- Recorded cash outflow, with funding dates and accounts preserved for paired
  payment alerts.
- Overall upcoming payments and active subscription estimates.
- A conservative current reporting-month pace estimate when observed history
  is sufficiently established and recent.
- Spending-change drivers by category and merchant, including purchase counts,
  with separate current/prior evidence and exact guided drilldowns.
- Recurring charge changes, unusual purchases and possible duplicate candidates
  using conservative local checks. Findings never change or delete records.
- Recorded-history coverage: observed dates, record/account counts and import
  status. Inactive dates do not prove missing imports; completed imports do not
  establish complete financial coverage.

The period selected on Home or Spending is the default. Users can change it in
Ask, name a month/year, use relative periods, or specify an unambiguous date range
such as `2026-09-01 to 2026-09-05`. Explicit named calendar months are calendar
months; relative reporting months and years respect the configured month start
day. Implicit comparisons use matching elapsed windows. Explicit comparisons
retain the requested periods and their order.

Follow-ups such as “Exclude rent” and “Compare the same dates” retain the current
filters. “Show those transactions” opens the
records behind the preceding financial answer. Entry points on Spending and
merchant pages carry their period and exact quoted merchant/category question.

## Answer and evidence contract

Financial figures are calculated locally by shared ledger functions. A language
model is not connected to the feature. The future interpretation boundary is
validated separately and does not accept unsupported filters or extra fields.

Answers identify their dates and scope and qualify totals as recorded activity.
Missing imports can affect totals, comparisons, and forecasts; observed history
does not prove complete bank coverage. Unsupported conditions, ambiguous
merchant names, unknown accounts, and unrecognized restrictions ask for
clarification rather than silently returning broader spending.

“View transactions” uses executor-owned IDs and exact contributions kept in
local memory. Category evidence shows the included portion of a split; opening
the record shows the full original transaction. Comparison and income-minus-
spending answers expose separate groups. Cash-out evidence explains effective
funding dates/accounts when they differ from the source alert. Long result sets
are paged in groups of 20 without dropping their remaining records.

Edits/imports and day changes mark old financial answers stale. Refresh keeps
their resolved absolute period, recalculates from current records and the current
clock, and updates the evidence. Erase/restore invalidates the entire session,
including a pending entrypoint question. Conversations are not persisted.

## Deliberate limits

Ask does not currently provide affordability recommendations, balances, arbitrary
amount/location filters, daily income averages,
or filtered/historical subscription forecasts. Asymmetric requests such as
“income minus dining spending” require clarification. It does not predict
unrecorded income or claim all bank activity was captured.

Pattern checks use comparable whole charges for the same merchant/account and
compatible instrument. Foreign-currency metadata and split receipts are excluded.
Recurring changes need three or five stable prior charges and a regular cadence;
the change threshold is 10%. Unusual purchases need five to 29 earlier charges
within 180 days and a conservative median/deviation threshold. Possible duplicates
need compatible captured bank-alert identity or closely matching recorded times;
manual entry times and date-only equal purchases are insufficient. These are
review candidates, not fraud findings or proof of a merchant price change. The
screen presents up to three findings with source records and known limitations.

The Home entry remains optional. New/default Home layouts put due payments first;
existing custom order and hidden widgets remain unchanged. The input stays in a
footer outside the conversation scroll area, grows for longer questions, and new
answers scroll into view. Twelve recent turns are retained per session with an
explicit notice if earlier turns are omitted.

## Verification

Focused financial and boundary tests are in `scripts/test/wafra-assistant.test.js`
and `scripts/test/repair/assistant-*.test.cjs`. The first-tap submission regression
remains in `scripts/test/repair/launch-polish.test.cjs`.

`scripts/e2e/e2e-assistant.mjs` exercises English mobile web with synthetic data,
blocked external requests, light/dark themes, narrow screens, transaction
evidence, and contextual navigation. It is registered in `scripts/e2e/run.sh`.
Web tests and hook-boundary tests do not establish native keyboard behavior.
`scripts/e2e/e2e-assistant-analysis.mjs` covers the local analysis and finding-level
review workflows with synthetic data, including filters, exclusions and coverage.
