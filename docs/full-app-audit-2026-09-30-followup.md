# Wafra reliability audit continuation — 30 September 2026

This continues the [first audit](full-app-audit-2026-09-30.md) in the canonical
checkout at upstream `566a9243d35ae19e51d149e6e2965daf92a3c66b`. Changes remain
local and unpublished. Unrelated performance, marketing and iPhone setup-video
work was preserved.

## Confirmed failures repaired

| Failure | Result and regression coverage |
|---|---|
| Two service accounts at the same recurring provider became one schedule | Detection and consumers now use provider plus validated service identity. The E& two-account reproduction yields two AED100 monthly schedules. Histories, reminders, dismiss/cancel/undo, Home and widget projections preserve that distinction. Funding-card IDs are not service IDs. Legacy provider preferences still apply, and a scoped undo can override them for one service. Reserved-looking provider names cannot collide with encoded keys. `recurring-service-identity`, `recurring-service-consumers`, `recurring-preferences`, and the new browser suite cover this. |
| Future amounts inferred from old receipts appeared confirmed | Bills and widget forecasts now mark those future amounts as estimates; historical receipts retain their actual-payment status. A browser assertion failed the old export and passed the fresh export in both themes. |
| A full Review tray or capped notification page acknowledged unsaved alerts | Capture partitions available capacity, retains deferred source messages, and rechecks that the admitted claim still exists after durable work. Missing, evicted or expired claims are not acknowledged. Known pending inbox rows are skipped during retries so older unseen rows can emerge. The inbox watermark remains held while unresolved overlapping claims require it. Automatic Relay, supplemental import and setup verification now share selective acknowledgement safeguards. Queue-to-source mapping survives chronological sorting; setup retains its probe ownership. A blocked full supplemental page stops draining until capacity becomes available. `capture-review-admission` covers cap, capacity, durability, ledger replacement and source identities. |
| Supplemental import applied a stale ledger plan across UI pauses | It now reacquires the ledger after the first pause and replans if the snapshot changes before applying. Actual planner/reducer regressions reproduce a concurrent source import and deletion of a matched account; the import no longer duplicates that work or posts an orphan reference. |
| Older bill notices overwrote newer obligations | For notices carrying stated-date provenance, merge uses the stated cycle and proven source time. Conflicting same-cycle amounts with equal or missing source timestamps fail planning before posting or moving the cursor; distinct valid clocks select the latest notice. Unstamped legacy records can still be refreshed. A higher proven correction revokes only that cycle's paid claim, preserves expenses, and detaches stale manual-payment links. `bill-notice-freshness` and bill lifecycle/provider regressions cover order permutations and reconciliation. |
| Bank debits and receipts for different cards were collapsed | External-payment matching rejects conflicting destination/card or issuer evidence. Ambiguous account sets remain unmatched; an unidentified legacy debit may still match one unambiguous receiving card. Independent account pairs retain their own chronological matching. `card-payment-counterparty` exercises these boundaries alongside existing cash-flow tests. |
| Deleting or financially editing a manual card payment left settlement evidence behind | New settlements recorded with a manual transaction retain that receipt ID. Removing/changing that receipt revokes its claim, while cosmetic edits and valid replacement ledgers preserve it. The linked receipt's local date also fixes month-boundary allocation where UTC was still in the prior month. Backup validates the association. `card-settlement-claim-lifecycle` covers these cases. |

The local Review adapter also preserves the card-payment family under currency
conflict. This is defensive hardening: the normal globally pinned foreign-ledger
route already rejected the conflicting currency, so this audit does not claim a
reproduced loss through that normal route.

Deletion/edit cleanup does not infer receipt ownership for legacy records.
Legacy unlinked card settlement dates keep their previous allocation behavior.
A higher proven bill notice can still revoke an older paid claim. This pass does
not invent receipt links from matching amounts.

## Verification

The 85-suite app run passed 82 suites initially. The isolated parser invariant
suite then passed 34/34, covering all 86 app suites. The three initial failures
were resolved: database fixture dependency wiring, brittle source-spelling
contracts, and Relay fixtures/mapping. Durable ACK/probe behavior is covered by
executor behavior tests rather than those removed source-spelling assertions.

The broad repair/workflow/iOS journey run exercised 2,700 checks: 2,698 passed
initially. The two failures were an assistant merchant-whitespace regression
(fixed while preserving recurrence service identity) and an invalid Review test
fixture (replaced with a valid durable claim). Both passed targeted reruns. The
entire broad command was not repeated after these focused fixes.

| Final affected checks | Result |
|---|---|
| Financial/capture/recurrence regressions | 161/161 broad affected checks, followed by 46/46 capture/reminder checks after the final race fix (including its two new reproductions) |
| Relay executor and encrypted sync | 304/304 after the final rebuild |
| Persistence/database | 267/267 |
| Contracts | 300/300; removed exact-source ACK assertions are covered behaviorally |
| Accounting | Unit 833/833, import planning 351/351, cash flow 56/56, bills 45/45 |
| Performance | Parser invariants 34/34; ledger hot-path and history checkpoint tests 15/15 |
| Server | 255 assertions passed |
| Static checks | App/server typechecks and final diff check passed. No lint errors; two pre-existing warnings in import-plan and journal-home. |

Independent reviews covered recurring identity, money/claim ownership, notice
freshness, and capture acknowledgements. Findings were fixed with regressions,
including the supplemental stale-plan race. Test logs are in
`/tmp/wafra-audit2/`; selected final evidence is preserved under
`artifacts/full-app-audit-20260930-followup/`.

Browser evidence is in `artifacts/audit2-browser/report.md`:

- Fresh recurrence export: four cases passed (E& and Netflix, light and dark),
  including isolated histories/actions, persistence, canonical logos, distinct
  timeline IDs, Home routing, and estimated future amounts.
- Earlier export: smoke 65/65, period 15/15, navigation 111/111.
- Backup round-trip 2/2 on rerun. An initial light-case failure occurred before
  restore when external fixture mutation raced pending application persistence;
  it was not a demonstrated restore defect.

No signed native candidate was built or installed by this continuation. Browser
screenshots and host tests do not prove phone background delivery, OS reminders,
Shortcuts, purchases, or native widget rendering. There is no claim that every
possible app defect has been eliminated.
