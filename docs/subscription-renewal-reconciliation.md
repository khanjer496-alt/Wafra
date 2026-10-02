# Changed-price subscription renewals

A single-service subscription bill (ChatGPT, Netflix, Spotify…), whether
detected or added by the person, reconciles a changed-price payment without
treating it as a new expense or leaving the old cycle due. Eligible providers
use an exact normalized name and service identity. Marketplaces and
bank-stated totals keep their stricter existing payment rules.

The one charge from that service within five days of a cycle's calendar
anchor settles that cycle at its actual amount, with no earlier history
required: plans change price and providers bill a few days early (a ChatGPT
plan billed at AED 799.99 on 27 September settles a bill saved at AED 384.99
and due 1 October). A charge below half the saved price could be an add-on
or a card check, so it settles a cycle only after the previous cycle renewed
through the same service. Additional charges in the cycle and competing bill
records keep it unsettled. A bill added by hand also keeps its same-month
match for a charge off the anchor, unless that charge settled another cycle.

Each charge belongs to one calendar cycle even across month/year boundaries
or salary reporting periods.
Explicit manual payment links retain their user-selected cycle.

The current cycle and immediately following estimate use the proven amount.
This is a projection: saved bill settings and transaction amounts are not
rewritten. Bills, Home, details and notifications read the same result. Manual
payment confirmation and reducer validation use that projected amount and
recheck whether a receipt arrived before recording another payment. Inferred
subscription reminders use the latest charge shown by the visible renewal row.

Regression coverage includes price changes, early renewals, ambiguous charges,
service identities, annual/month-end calendars, manual payments and backup
restore, and the reported case: a hand-added ChatGPT bill with no earlier
history and one doubled-price charge four days early.
