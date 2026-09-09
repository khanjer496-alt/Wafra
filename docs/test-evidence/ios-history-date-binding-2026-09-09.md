# iOS history date-binding investigation — 9 September 2026

## Scope

The owner confirmed UI Automation permission for the paired iPhone. This task
ran bounded, count-only Shortcut diagnostics. It did not call Wafra's history
Begin/Stage/Finish actions, file transactions, export message bodies or change
the published History Import Shortcut. The experimental source is in the
isolated worktree based on main `130b3bbc1a5dbfa0f99417f07fb83174f1c5325c`.

## Device testing works

The first test-runner attempt timed out enabling automation. After closing
iPhone Mirroring, a subsequent runner initialized and responded over the
phone's LAN endpoint. The USB forwarding endpoint still reset connections.
These observations do not independently establish a single cause for the
earlier timeouts.

The read-only Wafra Quick History Check was installed and run on the iPhone.
Its four queries each request at most three Message references. It reads only
their counts, not their bodies, senders or identifiers.

Observed first result: newest 3, oldest 3, future 3, before-future 3.
An additional diagnostic showed that the constructed boundary date was blank.
The initial counts therefore do not demonstrate a defect in Apple's handling
of a valid date predicate.

## Confirmed generator error

Installed Apple ActionKit metadata was used to deserialize synthetic Date
parameters without executing actions or reading a message library. Both
Adjust Date and Format Date use `WFDateFieldParameter` for `WFDate`.

| Supplied representation | Native decoding |
| --- | --- |
| Bare `WFTextTokenAttachment` | Empty/null parameter |
| `WFTextTokenString` containing the action-output variable | Exact round-trip |

The experimental helpers now use the latter representation for Date fields
and date-predicate values. Regression tests enforce the correct representation.
The fast-history candidate's numeric dictionary version field was also aligned
with previously recorded installed metadata: Number is `WFItemType=3`, not 4.
None of these corrections weakens native record validation.

## Physical result supplied by the owner

The corrected diagnostic, Wafra Date Filter Check v2, was generated, signed and
installed on the iPhone. The initial remote attempt stopped after the phone
locked. The owner then ran it and supplied its final result in this conversation:

- Query boundary: `2028-09-09T16:01:31+04:00` (a constructed test date).
- Newest: 3; Oldest: 3; Future: 0; Before future: 3.

This is the expected result for this future-boundary test. Date-based Message
selection is therefore working in this tested case once the Date parameter is
properly serialized. The earlier `Future=3` result with a blank boundary is not
valid evidence that Apple's date filtering itself was broken.

The same date-wrapper correction was propagated to the existing dated smoke
generator and legacy adaptive-window experiment. Installed duration unit names
`sec`, `min` and `hr` replace the human labels that the native quantity decoder
does not accept. Tests preserve exact Date-variable references and reject a
reversion to bare attachments or invalid duration-unit labels.

Fifty-eight iOS-journey/graph/regression tests passed, including the new date-window
checks. The existing production-artifact checker passed. The generated published
two-ended production graph remains byte-identical to its pre-fix JSON (SHA-256
`f4e1d3cb8859cab4b6387fbdd588d2994b92043feabf3a737027a2f7f3d02d72`).

Do not ask the owner to repeat the successful future-boundary test. The next
separate acceptance is distinct older pages and AND-combined date windows, then
same-timestamp boundaries, interruption/resume and source-to-ledger fidelity.
This result alone is not a large-inbox, memory, throughput or full-history test.

## Release status

No app build, commit, push, public Shortcut replacement, TestFlight submission
or ledger import was performed during this investigation. The existing
published importer retains its previous limits. In particular, the experimental
full-history candidate is not ready for release: its buffer-reset semantics,
source-query memory behavior and resumable coverage remain unverified.

Local evidence: `builds/ios-history-stream-20260909/device/date-wire-metadata.json`
and `builds/ios-history-stream-20260909/artifacts/date-wire-final-regressions.log`.
