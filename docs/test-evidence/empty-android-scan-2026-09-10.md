# Empty Android scans must not invent progress

## Device evidence

APK 150 was installed over 147 with the same signer, without uninstalling or
clearing data. Its startup read zero new messages and did not repeat history.
The trace showed collection in 83 ms and planning in 356 ms, but then a zero-row
save consumed 20,900 ms; total routine time was 21,340 ms.

The full-history run on 147 had already completed. A subsequent phone backup
contained stored parser 39, 14,718 transactions, and 32 reciprocal linked
own-transfer records (16 pairs). Compared with the older saved phone snapshot,
no prior transaction ID was missing, no original monetary field changed, and
no user-edited row changed. This does not mean every unclassified transfer is
resolved, nor does it establish faster processing of the full history on 150.

## Defect and narrow correction

The collector queries strictly after the saved watermark, passing lastScanTs+1
as the scanner's inclusive lower bound. The scanner initializes newestTs to
that bound even when it returns no messages. Passing that sentinel through
made the executor see fictitious progress and schedule an unnecessary durable
write after every idle refresh.

The collector now preserves the existing watermark only when both scan counters
and all parsed/refused/review/binding collections are empty. Actual inbox
refusals, review-only alerts, notification captures and completed parser-migration
receipts keep their previous save/acknowledgement behavior. No parser bump,
storage bypass, acknowledgement reordering or ledger restoration is introduced.

## Verification

The added seven-test collector/executor suite failed against the prior source
on repeated empty scans, then passed after the correction. It covers no-op
repeats, an actual next-millisecond message, review durability, notification
acknowledgement, complete historical receipts, an empty initial ledger, and
restricted/incomplete-history refusal.

Typecheck and lint passed, as did all 648 focused regressions, the 288-check
relay suite and 52 scanner checks. The actual browser transfer suite passed in
English/Arabic at 320/390 widths after aligning the browser timezone with its
already-Dubai-local synthetic fixture date. The timezone adjustment fixes the
CI-only midnight mismatch without changing the application's recent-date filter.

Device verification of the corrected empty-scan path must be recorded after
installing its new binary. Logs and private phone snapshots remain local under
the ignored phone-speed-20260910 workspace; none are included in this commit.
