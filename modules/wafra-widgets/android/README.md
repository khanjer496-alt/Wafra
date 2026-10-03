# Wafra Android widgets

Three classic `AppWidgetProvider` widgets built with `RemoteViews` (no Glance
or Compose):

- **Today** (`TodayWidgetProvider`, 2x2): on Home's ink band, the exact total
  for the last 7 days, then today's spending as the band figure
  (currency code set smaller, tabular digits) and one line under it: what is
  left in budgets when they are set, otherwise today's payment count.
- **Coming up** (`UpcomingWidgetProvider`, 4x2): on Bills' ochre band, up to
  three upcoming bills (fewer when the widget is short), each with a bundled service logo (the title's initial
  when unknown; a calendar glyph when the title has no letter), a due word
  ("Today", "Tomorrow", the weekday within the coming week, otherwise
  "Mon 5 Oct") and the amount (`≈` when estimated).
- **Spending this month** (`SpendingWidgetProvider`, 4x2): on Spending's clay
  band, the month and its total, a share bar of the categories (three named in
  falling strength, the rest quiet) and the three largest with whole-unit
  amounts. The figures are the Spending tab's own for the live month
  (`summarizeMonth` + `spendingCategoryRows`, via `widgetMonthSpending`).
  A snapshot without a month (written by an older app) asks to open Wafra.

Today also draws the week as seven bars (today in mint, a zero day a thin
baseline), a corner of three pattern shapes, and a bar of how much of the
budgets is used (the over colour once any budget is past its limit). Coming up
heads its list with the listed bills' total (`≈` when any is an estimate), sets
each due word in a pill ("in 9 days" past the coming week), and shows a
calendar glyph over its empty state. Bars and share bars are white masks drawn
in `WidgetGraphics` and tinted by colour resources in the layout, so they
follow the launcher's light or dark mode.

Colours follow design language E (`docs/design/language-e.md`): `values/` and
`values-night/` carry the light and deepened dark bands from
`src/constants/theme.ts`. The widgets do not follow the wallpaper palette;
the band colour is the widget's identity. Service logos are copied unchanged
from `assets/merchants/`; the snapshot carries only an allowlisted `logoId`,
never a URL or path. No merchant lookup leaves the device. Unknown identities
and older snapshots without a logo id retain their initial fallback.

Tapping either widget opens the app.

## Sizes

Each widget renders one layout per height breakpoint
(`WafraWidgets.TODAY_FULL_MIN_HEIGHT_DP` and the `UPCOMING_*` constants), so
a short widget leaves content out instead of clipping it:

- **Today** shows the seven-day total from 152dp of height; below that the
  total is left out and the budget words keep to one line.
- **Coming up** lists three bills from 170dp, two from 130dp, otherwise one.

Android 12+ receives every layout at once (`RemoteViews(Map<SizeF, RemoteViews>)`)
and picks among them for each size the widget takes; older versions re-render
on `onAppWidgetOptionsChanged` from the reported minimum height. Amounts never
break across lines: the figures shrink to fit, and the budget amount is its own
view beside the words, which give way instead.

On Android 12+ the outer frame is `@android:id/background`, rounded to the
launcher's own widget radius (`drawable-v31`) and clipped to it. Single-ink
logos (Apple, GitHub, Notion, Uber, Vercel) sit in an `ImageView` tinted with
`wafra_widget_upcoming_text`, so they follow the launcher's light or dark mode.

## Data

The widgets read **only** the snapshot JSON that `src/lib/widget-snapshot.ts`
builds and `modules/wafra-widgets/index.ts` hands to `WafraWidgets.setSnapshot`.
It is stored in app-private SharedPreferences (`wafra_widget_snapshot` / `json`).
The widgets never read the ledger, SMS, notifications or any other app data.
`clearSnapshot()` removes it.

Contract (version 1; anything else shows the empty state):
`version, generatedAt (ms), language ('en'|'ar'), todayISO, currency, exponent,
amountsSensitive, hidden, todayMinor, todayCount, last7Minor[7] (oldest first),
leftInBudgetsMinor, budgetTotalMinor?, perDayMinor, budgetsOver, bills[{title,
amountMinor, estimated, dueISO, logoId?}], spending?{monthKey, totalMinor,
categories[{label, amountMinor}] (largest first, at most six), otherMinor}`.
Fields marked `?` are absent from older snapshots and are optional. Amounts are whole minor units shown as
`<CURRENCY> 1,234.56` with exactly `exponent` decimals and Latin digits.

## Safety rules

- `hidden == true`, a null amount or a non-integer amount shows `—`, never a guess.
  A snapshot without a `hidden` flag is read as hidden, as on iOS.
- A snapshot older than 36 hours, missing or malformed shows "Open Wafra to update".
- **Today** also requires `todayISO` to equal the phone's local date, so
  yesterday's total is never shown as today's.
- The seven-day total appears only when all seven amounts are known and their
  exact sum is a safe integer. Hidden, partial and overflowed totals show `—`.
- **Coming up** drops bills whose due date has passed.
- The widgets re-render at local midnight and when the snapshot expires
  (inexact `AlarmManager` alarm), and on time, time-zone and locale changes.
- `amountsSensitive` is ignored on Android: phone widgets are Home-screen only.

Widget text follows the snapshot's `language`, not the phone language.
