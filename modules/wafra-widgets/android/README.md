# Wafra Android widgets

Two classic `AppWidgetProvider` widgets built with `RemoteViews` (no Glance or
Compose):

- **Today** (`TodayWidgetProvider`, 2x2): today's spending, payment count, seven
  bars for the last 7 days (today highlighted) and "Left in budgets" when set.
- **Coming up** (`UpcomingWidgetProvider`, 4x2): up to three upcoming bills
  with short due date and amount (`≈` when estimated).

Tapping either widget opens the app.

## Data

The widgets read **only** the snapshot JSON that `src/lib/widget-snapshot.ts`
builds and `modules/wafra-widgets/index.ts` hands to `WafraWidgets.setSnapshot`.
It is stored in app-private SharedPreferences (`wafra_widget_snapshot` / `json`).
The widgets never read the ledger, SMS, notifications or any other app data.
`clearSnapshot()` removes it.

Contract (version 1; anything else shows the empty state):
`version, generatedAt (ms), language ('en'|'ar'), todayISO, currency, exponent,
amountsSensitive, hidden, todayMinor, todayCount, last7Minor[7] (oldest first),
leftInBudgetsMinor, perDayMinor, budgetsOver, bills[{title, amountMinor,
estimated, dueISO}]`. Amounts are whole minor units shown as
`<CURRENCY> 1,234.56` with exactly `exponent` decimals and Latin digits.

## Safety rules

- `hidden == true`, a null amount or a non-integer amount shows `—`, never a guess.
- A snapshot older than 36 hours, missing or malformed shows "Open Wafra to update".
- **Today** also requires `todayISO` to equal the phone's local date, so
  yesterday's total is never shown as today's.
- **Coming up** drops bills whose due date has passed.
- The widgets re-render at local midnight and when the snapshot expires
  (inexact `AlarmManager` alarm), and on time, time-zone and locale changes.
- `amountsSensitive` is ignored on Android: phone widgets are Home-screen only.

Widget text follows the snapshot's `language`, not the phone language.
