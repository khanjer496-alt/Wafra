# Fast, bank-independent iOS SMS history: investigation and implementation gate

## Status

Investigation plus a reproducible synthetic native-transport benchmark. **Not a
new shipping Shortcut, not a full-inbox extraction fix, and not a physical-iPhone
speed claim.** Existing app sources, production Shortcut links, and releases are
unchanged. The test creates only temporary synthetic stores and removes them.

## Product target

Open Wafra -> Import past messages -> add the supplied Shortcut once -> approve
Apple's sharing prompt -> review financial results in Wafra. No bank selection,
bank login, Apple Card, country eligibility list, clipboard copying, or computer
should be required by the primary iPhone route. Preserve all retained available
history; a recent-history choice must never be called a complete import.

This is a target, not the behavior of the current release. Apple's Find Message
and Find Conversation actions were added in iOS 26. Their availability does not
prove every filter, paging method, or iPhone behaves correctly.

## Confirmed starting point

- The published generator uses newest/oldest 1,500-message queries. It prepares
  messages individually and rejects a non-overlapping result. Consequently, an
  inbox with 3,000 or more retained messages can fail after substantial work.
- The prior physical record documents 3,000 references, 2,374 unique messages,
  and approximately 23 minutes. This is historical evidence, not a test performed
  in this investigation.
- A single unbounded query previously caused a 240 MiB runner memory termination.
  Existing date-filter and direct property-array experiments also failed. Do not
  enable those retired graphs or increase the cap without new device evidence.
- The current native adapter, StageWafraShortcutHistoryIntent, accepts at most
  50 serialized records. It handles explicit ISO time-zone offsets. It does not
  find messages, establish history coverage, or resume a Shortcut.
- The inspected build-59 report contains the adapter. The paired phone was still
  on build 55 during this investigation; build-59 device behavior was not tested.

References in this repository: docs/ios-history-shortcut-spec.md;
docs/test-evidence/ios-history-import-implementation-2026-09-01.md;
modules/wafra-message-history/ios/WafraMessageHistoryStore.swift;
modules/wafra-message-history/plugin/index.js.

## Chosen transport design

Use Shortcuts only to acquire and package complete message records. Move parsing,
classification, reconciliation, and storage work into Wafra. Submit bounded
50-record batches instead of one native App Intent per message. Keep GUID, text,
sender and date together in each record; never zip independent property arrays
that may silently omit missing values. Use a real JSON serializer, not raw text
interpolation. Preserve the instant represented by an explicit time-zone offset.

The existing batch store rejects duplicate record IDs, including duplicates across
chunks. Therefore, the two-ended producer cannot simply switch its Prepare action
to Stage: its intentional overlap would invalidate the session. Resolve exact
duplicates before staging, detect conflicting copies, and reconcile attempted,
accepted and skipped counts. Do not manufacture IDs or missing dates to satisfy
the transport validator.

For 3,000 input references, 50-record batches would require 60 stage invocations
instead of 3,000 prepare invocations, excluding begin/finalize calls. This is an
invocation-count calculation, **not a 50-times end-to-end speed claim**.

## Acquisition gate: still unresolved

The producer must demonstrate a query that actually advances through history.
These are experiments to validate, not assumed Apple capabilities:

1. A bounded, single-sided date cursor using the exact system-generated filter
   serialization. Probe an impossible range and known boundary records to catch
   ignored filters before importing. Preserve equal-timestamp boundaries and
   validate forward progress; a capped batch of timestamp ties is not complete.
2. Conversation-scoped enumeration using Find Conversation, **only if** a real
   device exposes a usable relationship to its messages and a coverage-safe way
   to enumerate both conversations and their contents. No manual bank selection.

Filtering an already-truncated array cannot recover the missing messages. Larger
arrays risk repeating the memory crash. Bank-name or English-keyword filters are
not a universal substitute for a complete extractor. The current checked-in
adaptive date-window graph remains diagnostic-only.

If neither query route advances reliably on a supported OS, report the imported
scope honestly. A desktop backup or a statement import is a different fallback
with different requirements, not evidence that universal phone-only SMS history
has been solved. Do not relabel latest-N messages as all history.

## Recovery and UX requirements

Persist progress only after a batch is durably accepted, with source IDs and an
explicit coverage checkpoint. Replaying that exact batch must not duplicate
transactions. Resuming must not skip an unfinished equal-date boundary. The
current one-hour stage expiry and begin-session semantics are not a complete
resume implementation; design checkpoint expiry and cleanup together before
exposing a Resume button.

Show actual checked/imported counts and supported coverage, not invented progress
or an estimate derived from a synthetic host benchmark. Keep financial results
separate from personal-message contents. Only confirmed transactions enter the
ledger; uncertain financial interpretations go to review. Future SMS capture is
a separate setup from historical extraction.

## Reproducible native experiment

Run:

```sh
bash scripts/test/ios-history-batch-benchmark.sh 300
bash scripts/test/ios-history-batch-benchmark.sh 5001 --batch-only
```

The harness calls the real prepared and batch stores with synthetic fixtures. It
checks exact persisted ID/body/sender/date equality, counts, Arabic and escaped
text, explicit-offset normalization, idempotent chunk retry, and rejection of
51-record native batches. A non-multiple of 50 also exercises the final partial
batch. No Messages database, phone inbox, production staging root, or ledger is
accessed. The host file-protection adapter models metadata only; it does not
certify iPhone encryption or locked-device behavior.

The first 300-record host run measured 4.752 seconds for individual preparation
plus finalization and 0.573 seconds for the batch route. These timings include
native record serialization, not Apple entity search, Shortcuts loops, permission
prompts, interprocess invocation, or on-device parsing/review. They establish a
promising native transport path, not a finished iPhone feature.

A second comparison with 301 records exercised a one-record final batch and
passed exact parity, retry, offset and capacity checks (1.835 seconds scalar;
0.262 seconds batched). A separate 5,001-record batch-only run accepted and
finished 101 chunks in 6.004 seconds, then verified every stored record against
its original synthetic fixture. No per-message baseline was run for that large
case. It proves native batch capacity above the current Shortcut's limit, **not
the ability to retrieve 5,001 real iPhone messages**. Exact machine-readable
results are in docs/test-evidence/ios-history-batch-transport-2026-09-09.json
and docs/test-evidence/ios-history-batch-capacity-2026-09-09.json. Run-to-run
timing differences are expected; these small host samples are not a production
performance guarantee.

## Release acceptance

Require an exact signed producer plus the matching installed app to complete a
real inbox above 3,000 messages, with known oldest/newest records and no silent
gaps. Also test small/empty inboxes, dense equal-date boundaries, Arabic alerts,
missing fields, duplicate and conflicting IDs, cancellation, interruption,
resume, and repeat import. Record acquisition, conversion, native staging, and
review times separately. Keep current release artifacts unchanged until those
checks pass.

## Apple references checked on 2026-09-09

- https://support.apple.com/en-us/125148 (new Messages actions in Shortcuts 26)
- https://developer.apple.com/documentation/updates/defaultapps (default-app
  conversation access starts when the app becomes default; not old-inbox access)
- https://developer.apple.com/documentation/identitylookup/ilmessagefilterqueryhandling
  (incoming unknown-sender filtering, not a historical inbox enumeration API)
