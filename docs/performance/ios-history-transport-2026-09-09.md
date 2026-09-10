# iPhone SMS history: transport investigation, 9 September 2026

## Outcome and release status

The preferred bank-independent, phone-only route remains a user-authorized
Shortcuts extractor feeding bounded batches into Wafra's native history store.
This investigation did **not** produce a replacement shipping Shortcut or prove
a fast, exhaustive import on an iPhone. Do not describe the results below as
an iPhone import time, a completed producer, or universal platform support.

No app source, public Shortcut link, entitlement, production configuration,
ledger, TestFlight assignment, or published build was changed. The only new
executable files are a reproducible synthetic host benchmark:

- `scripts/test/ios-history-transport-benchmark.swift`
- `scripts/test/ios-history-transport-benchmark.sh`

## Actual constraints recovered from the project

The physical evidence in
`docs/test-evidence/ios-history-import-implementation-2026-09-01.md` records:

- 3,000 prepared references (newest 1,500 plus oldest 1,500), reconciled to
  2,374 readable Messages, took approximately 23 minutes on the iPhone 16 Pro.
- The overlapping two-ended query is only an exhaustive-history proof for
  fewer than 3,000 retained Messages. Its cap is a property of this implementation,
  not a documented universal Apple inbox limit.
- A one-shot 2,392-entity candidate was killed at a 240 MiB process high-water
  mark. Raising the query limit is not a demonstrated solution.
- Direct GUID/body/date vector binding produced empty App Intent arrays.
  That does not prove that an ordinary list of serialized String records also
  fails; these are different transport paths and must be tested separately.
- The adaptive date-window diagnostic was retired because the concrete Apple
  query adapter did not pass its real-device capability gate.

`src/lib/ios-history-traversal.ts` is explicitly a synthetic-provider coordinator,
not a working Apple Messages reader. It already has window splitting, newest-first
ordering, resumable metadata, overflow rejection and transactional commit contracts.
Passing its tests cannot certify the real query adapter.

The connected iPhone was enumerated successfully. Wafra **build 55** was installed,
not build 59. The saved build-59 IPA inspection includes
`StageWafraShortcutHistoryIntent`; the current source implements that receiver with
ISO 8601 offset normalization. No new real-phone batch handoff was completed in
this investigation. Mac Shortcuts UI/export attempts did not yield a usable
exported manual date-filter graph.

Git HEAD reported branch `fix/transfer-ownership-review` and commit
`4099201aa02e7acdac955340ffc74d4828d1ec60`. Git status failed because the index
could not be memory-mapped (Operation timed out). No branch switch, index repair,
commit, push, or existing-source rewrite was attempted.

## Reproducible native-only benchmark

Run from the repository root on the development Mac:

```sh
bash scripts/test/ios-history-transport-benchmark.sh 3000
```

The script compiles the unchanged production Swift stores with optimization and
warnings as errors. It generates synthetic non-financial text containing Unicode,
quotes, backslashes and a newline. All benchmark storage is in a unique temporary
directory, never a real app container. It verifies accepted counts, exact batch
record round trips and cleanup. No phone Messages or existing ledger are read.

Observed on this development Mac:

| Measurement | Observed result |
| --- | ---: |
| Synthetic input records | 3,000 |
| Per-message preparation calls | 3,000 |
| Per-message native preparation | 12.819 s |
| Per-message native finalization | 4.520 s |
| Per-message native total | 17.340 s |
| 50-record batch staging calls | 60 |
| Batched native begin/stage/finish total | 2.195 s |

The direct-batch inputs are encoded before its timed begin/stage/finish region.
The per-message path includes its own record encoding and preparation-file writes.
This compares native ingestion paths, **not** equivalent end-to-end Shortcuts
workloads. Both omit Apple Messages retrieval, Shortcut property extraction,
App Intent IPC, permission prompts, the JavaScript parser, review and ledger save.
The host file-protection adapter models metadata only; iPhone encryption and
locked-device behavior are not certified by this test.

Raw source-free result:
`builds/ios-history-transport-20260909/host-benchmark-3000.json`.

The result supports investigating batched transport. It does not support
advertising a 2-second import or a 50-times-faster iPhone import.

## Verification actually completed

`node --test scripts/test/ios-journey/journey.test.cjs`:
16 passed, 0 failed. The 12,000-message/two-year case uses a simulated provider.

`bash scripts/test/native-history-store.sh --host-only`:
385 passed, 0 failed, plus the host protection-model checks. Includes 50-record
offset normalization, exact-retry handling, duplicate identifiers, invalid
dates/JSON, permission metadata, fixed expiry, storage ceilings and cleanup.

The 3,000-record benchmark compiled and completed with exact batched record
reconciliation and both synthetic sessions discarded.

## Concrete implementation decision

Separate two independent gates rather than mistaking one for the other:

1. **Transport gate:** ordinary individually serialized records, collected in
   bounded groups of 50, handed to the native receiver once per group. Verify the
   exact signed Shortcut against a matching installed app. Require expected count,
   accepted count and field preservation; zero/empty binding is a failure.
   Keep scalar-text batch framing as an alternative only if the concrete ordinary
   String-list binding also fails. Do not repeat the retired parallel-vector probe
   and call it a new solution.
2. **Extraction gate:** verify date-range predicates, sort direction, boundary
   equality, overflow and frozen-range behavior against actual iPhone Messages.
   An observed row in the wrong window must block checkpoint advancement. Only
   after this gate passes may the existing traversal coordinator be connected.

Target product experience: one installation and permission flow, then Import
history, recent complete batches first, a truthful imported-through boundary,
and durable continuation for older history. No country/bank picker and no
mandatory 30-day cutoff. A 50-record batch is a memory/work unit, not a limit on
the user's requested history. Do not discard successful durable progress when a
later page fails. Preserve historical message IDs across retries and reconcile
overlaps with live-message capture before adding financial entries.

Page completion needs explicit coverage metadata and ledger/checkpoint atomicity;
the current finished-session receiver does not provide those features by itself.
The current four-session/10,000-record/storage/expiry limits must also be reconciled
with page consumption rather than silently raised or represented as unlimited.

Acceptance must cover a physical inbox above 3,000 retained Messages, interrupted
and repeated imports, date boundaries, Arabic/multiline fields, unreadable rows,
first useful result, total elapsed time and memory. A retained/iCloud-download
gap cannot be represented as complete history. Device and action availability
must be detected; bank independence is not a guarantee of every iOS version.

## Alternatives checked, not substitutes for the requested experience

Apple's current TelephonyMessagingKit definition covers messages sent/received in
the app acting as the default carrier messaging app; it does not establish a
universal reader for the pre-existing Apple Messages inbox. A computer/backup
import adds a computer and backup/transfer setup and has not been demonstrated
as a faster universal phone-only option here. Neither should displace fixing and
measuring the concrete Shortcuts extractor without new evidence.

Primary Apple references checked on 9 September 2026:

- https://developer.apple.com/support/terms/apple-developer-program-license-agreement/
- https://support.apple.com/en-au/guide/shortcuts/apdc11deb2c1/ios
- https://support.apple.com/en-ae/guide/shortcuts/apd0f2e057df/ios
- https://support.apple.com/guide/shortcuts/handling-lists-apd9ba41d21b/ios
