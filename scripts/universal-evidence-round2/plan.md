# Round 2: complete the observed extraction gaps

User authorized implementation on 2026-09-05. Existing public and independent
corpora remain frozen. The round-1 after-fix snapshot had 10/36 independent
parser cases and 13/15 category cases matching all asserted fields.

1. Capture a fresh baseline and trace the missing fields through raw numerical
   candidates, monetary roles, merchant/date fields, and event semantics.
2. Extend monetary role labels for the evidenced languages. Keep transactions,
   balances, statement total, minimum payment and fees separate; preserve
   currency/decimal ambiguity and aggregate exclusions.
3. Extend labelled due-date extraction and seller boundaries using source
   language constructs. Do not infer date order, year, issuer, or merchant
   from the active AE/SA setting.
4. Interpret completed purchase/refund predicates and direction only with
   source evidence. Preserve authorization, decline, renewal, bill and
   statement guards, as well as unknown status for unfamiliar wording.
5. Cover the two category vocabulary misses with directional/user-rule and
   ambiguity controls.
6. Freeze implementation, evaluate independently authored unseen cases once,
   report misses without retroactively changing expectations, and add bounded
   fixes/regressions for any substantive errors. Once used for a fix, a case
   becomes regression evidence rather than held-out accuracy evidence.
7. Obtain read-only review, run existing universal and evidence regressions,
   strict typing/lint, and text-to-confirmed-ledger checks. Coordinate shared
   app/native review-flow QA with the integration owner.

Production ownership requested from the active integration task: universal
money, fields, dates, parser, categorization. Shared legacy parser, import,
store, capture, UI and build files remain outside this workstream. No commits,
publication, or native builds are performed here.

Root-cause observation before edits: Hindi, Turkish, Japanese and Chinese
purchase fixtures already contain correct exact principal/balance candidates;
both have unknown monetary roles, so selection correctly remains ambiguous.
The Spanish statement labels its total as ordinary balance and leaves its
minimum unowned. These are role/semantic gaps, not arithmetic failures.
