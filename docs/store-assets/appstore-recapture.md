# Native App Store recapture — WSC-05/06/07

All existing App Store screenshots are awaiting replacement. Do not upload the
older set or substitute web exports, resized web screens, synthesized UI or
renamed duplicate files.

Capture the current native Release UI in English and Arabic at both requested
size groups, 6.5-inch and 6.9-inch. Use the same eight surfaces for every group:
Home, Import, Bills, subscription detail, Accounts, Spending, category limit
and Settings. This produces 32 distinct captures, including the previously
missing Arabic 6.5-inch set. Use synthetic sample data and label it as sample
data when preparing the listing.

Record commit, build number, binary hash, build configuration, device model,
OS/runtime, language, appearance, actual pixel dimensions and file hash in a
manifest alongside the captures. Match each image to its named surface.

Acceptance before replacement/upload:

- Tab bar, titles and controls match the final release candidate.
- Every title is fully visible; check safe areas at both sizes.
- Arabic letters join normally with no letter spacing; check hamza spelling
  against current app strings and obtain a native Arabic reader's review.
- Every Arabic ledger amount uses the same isolated number-then-code order.
- Accounts puts the owed label and figure together without splitting them.
- Free-capture copy shows the saved end date and explains what stays free.
- Native Pro review evidence shows the actual store-returned price and cadence,
  renewal terms, Restore, Terms and Privacy. The unavailable state disables Buy.
- Inspect each full-resolution image and check hashes for accidental duplicates.

Separately retain native Pro evidence for day zero, day two and the expired
state in both languages and appearances. A simulator Release build can validate
native rendering; label its provenance accurately. A web export does not prove
native layout, store pricing, safe areas or Arabic font shaping.

App QA Lead has the native build/capture handoff. Replacement is pending that
native candidate and the checks above; no replacement image is claimed here.
