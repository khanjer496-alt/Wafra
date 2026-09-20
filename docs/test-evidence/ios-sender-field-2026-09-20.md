# iOS history import: the Message entity has no sender (2026-09-20)

## Symptom

The owner's iPhone diagnostics export of 2026-09-19 (build 152, History v4, 366
imported transactions) showed every imported account minted without a bank:
`Account •9957`, `Credit Card •4531`, `Account •0315`, all with `bankName`
unset, and account hint keys of the form `?|account|9957`. The same alerts on
Android produce `ADIB Account •9957` with the bank logo. Parsing itself was
fine (262 alerts matched on 2026-09-19); only the bank identity was missing.

## Investigation on the device

All probes are Apple-signed diagnostic shortcuts under the GitHub prerelease
`ios-date-probe-20260919` (`Wafra-Sender-Probe-2` … `-9`). They read sender
labels or counts only; no message text or Wafra intent is involved. Results,
owner's iPhone 16 Pro on iOS 26:

| Probe | What it read | Result |
| --- | --- | --- |
| v1 (2026-09-19) | `Sender` property | Blank alert: the probe itself was wrong (attachment range hand-counted as `{58, 1}`, placeholder at 60). Disregarded. |
| v2 | `Sender`, coerced and plain, 20 newest messages | All 20 empty (`len=0`). |
| v7 | 27 candidate field names (`Sender`, `sender`, `From`, `Chat`, `Handle`, `Sender Name`, `Participants`, `Recipients`, `Name`, `Title`, `Address`, `Contact`, `Conversation`, `Phone Number`, `Service`, lowercase variants) | All empty. The whole item rendered as text is non-empty. |
| v8 | "has any value" on raw properties; nested picks `Sender→Name`, `Chat→Phone Number`, etc. | `Body`, `GUID`, `date`, `Date` present; `Sender`, `Chat`, `Recipients`, `Participants`, `Handle`, `Content` missing; every nested pick empty. |
| v9 | Find Messages filtered by `Sender`/`sender`/`Chat`/`Chat Name` contains `ADIB` | Shortcuts silently dropped those filter rows (the Find action showed no filter); the counts were just the newest messages. Only `Body contains ADIB` produced a real filter, and it matched. |

Conclusion: on iOS 26 the `com.apple.MobileSMS.MessageEntity` returned by Find
Messages exposes the body, identifier and date and nothing about the sender,
either as a property or as a filter. The history graph's `Sender` read is
therefore always empty, the native importer drops an empty sender from the
record (`WafraMessageHistoryImporter.preparedRecord`), and the parser receives
no sender. `bankFromSender` then has nothing to match and the existing
body rule (`bankFromMessage`) only recognises "<bank> … credit/debit card".

Side result: the owner's phone passed all six shapes of `Wafra Messages
Check`, so the "unknown error" report belongs to the tester's phone only.

## Fix (app side, no shortcut change)

`soleBankNamedInText` in `src/lib/markets.ts` returns the one bank of the
active market that the body claims as the reader's own, or null. A claim is
either the possessive form ("your ADIB Covered Card", "Your FAB account",
"your Emirates NBD Credit Card": the bank's sender pattern right after "your"
and within 24 characters of card/account) or a leading header ("ADCB: …").
A bank named anywhere else is not the issuer and is ignored: another bank's
ATM, a remitter ("transfer from EMIRATES NBD"), or a merchant whose name
contains a bank token ("ADIBA FLOWERS", "AL MASHREQ AL ARABI RESTAURANT",
"LIV GOLF STORE"), and a transfer's destination ("to your FAB Account"),
which the sending bank names without naming itself. A card payment worded
"to your ADCB Credit Card", and an inward credit worded "credited to your
ADIB account", are therefore known safe misses (no bank, as before) rather
than wrong banks; allowing that form when the body names no other party is
a possible follow-up. An earlier whole-body version was rejected in review
because those cases would have minted wrong-bank accounts and stopped rows
binding to the user's real card. Two banks claimed as yours resolve to null.

It is the last fallback for `bankHint` in `src/lib/historical-import.ts` and
`src/lib/local-message-record.ts`, after the parser's own bank hint, the
sender and the iOS sender registry, and it runs inside the routed market's
pack. A sender that resolves still wins; Android, whose raw SMS address always
resolves, is unchanged.

Tests: `scripts/test/historical-import.test.js` (senderless ADIB record →
`bankHint` ADIB and a minted account `bankName` ADIB; another bank's ATM in
the body keeps ADIB; a body naming only another bank keeps no bank; header
form; two claimed banks → none; the Saudi pack; `ENBD` sender outranks the
body) and
`scripts/test/repair/local-senderless-bank.test.cjs` (live-capture route with a
phone-number sender). Both were watched failing before the change, and the history block was
re-run with the compiled helper stubbed to null: six assertions fail and the
suite exits 1.

Existing accounts on a phone that imported before this build are backfilled by
`buildImportPlan` the next time an alert for the same card or account arrives
with a bank hint ("existing accounts that predate this get theirs backfilled").

## Probe-building lessons

- Compute `WFTextTokenString` attachment ranges from the built string; never
  count by hand.
- Count, Match Text and Split Text prompt the user for input when their input
  is missing at run time. Guard reads with If conditions (`WFCondition` 100
  "has any value", 999 "does not contain") and Text actions only.
- A filter row on an unknown property is dropped silently; check the Find
  action's rendered filter before trusting a count.
