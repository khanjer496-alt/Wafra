# Changed-price subscription renewals

A saved automatic subscription estimate can reconcile a changed-price payment
without treating it as a new expense or leaving the old cycle due. Eligible
single-service providers use an exact normalized name and service identity.
Marketplaces, manually authored bills and bank-stated totals keep their stricter
existing payment rules.

Two consecutive single-charge cycles matching the saved estimate establish the
baseline. Later unique charges within five days of the calendar billing anchor
can settle that cycle at their actual amount. Missing cycles, additional charges
and competing bill records interrupt this evidence. Each charge belongs to one
calendar cycle even across month/year boundaries or salary reporting periods.
Explicit manual payment links retain their user-selected cycle.

The current cycle and immediately following estimate use the proven amount.
This is a projection: saved bill settings and transaction amounts are not
rewritten. Bills, Home, details and notifications read the same result. Manual
payment confirmation and reducer validation use that projected amount and
recheck whether a receipt arrived before recording another payment. Inferred
subscription reminders use the latest charge shown by the visible renewal row.

Regression coverage includes price changes, early renewals, ambiguous charges,
service identities, annual/month-end calendars, manual payments and backup
restore. Real device data is still needed to confirm which path produced a
particular user's missed reconciliation. This source change is not included in
APK 356 or TestFlight 173.
