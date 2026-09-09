# Closed-beta history integration — 9 September 2026

This change integrates the previously uncommitted paged-history work with the
current main-line parser/ownership and Ledger & Light performance updates. The
original working checkout, whose Git index is cloud-offloaded, was not reset,
switched or overwritten. The candidate files were copied with hashes into an
isolated main-based worktree; their prior bytes remain in a local snapshot.

## Included implementation

- Normal iOS setup and the ordinary import screen route closed-beta users to
  the matching paged importer. Production profiles keep the existing published
  Shortcut. Both native and UI beta flags must agree.
- The new signed **Wafra History Paging Beta** is separate from the published
  **Wafra History Import**. The beta uses a fixed versioned download link and
  explains Safari Downloads → Add Shortcut → return and start. No developer
  settings are required for ordinary users.
- The source reducer requests 51 references, preserves a whole-second overlap,
  grows dense boundaries to 102/204/408, and requires the original oldest anchor
  before a short page can mean completion. Empty/truncated/repeated/out-of-range
  pages cannot be silently treated as successful history.
- Scalar, bounded page frames retain exact quoting, Unicode and millisecond
  timestamps. The graph uses the corrected text-token date bindings, explicit
  empty-list resets and no unbounded Messages query. It has no network, file,
  clipboard, SMS or email output action.
- A protected journal saves each page with its next cursor. Reopening resumes,
  retrying a lost acknowledgement is idempotent, and new local authentication
  fences an old runner. A durable page whose head write was interrupted is
  rolled forward exactly once.
- Progress is source-free, validated and translated into English and Arabic.
  Restart/Resume rereads native state, retains original handoff timing and
  returns to onboarding after review. Discard confirms one exact session and
  does not erase an unrelated concurrent import or the existing ledger.
- App import consumes only completed native sessions; the old descriptor
  limits remain unchanged. Paged chunks contain at most 50 validated records.
  Read guards do not repeatedly rescan the complete journal per chunk.
- Current parser, transfer ownership, account attribution, diagnostics, logos,
  Android filtering and Ledger & Light assets are retained from main.

## Gates exercised

The 10,001-record native host harness validates distinct identities, exact
content, completion/recovery cutoffs, read-before-complete refusal, chunk bounds,
lost acknowledgements, resume, stale capabilities, dense seconds, truncated
pages, crash recovery, capacity retention and explicit cleanup. Host file
protection is modeled; it does not certify iPhone hardware encryption.

Executable setup tests verify install-versus-run consent, matching Shortcut
URLs, resume timing, review instead of automatic ledger save, session-specific
discard, Arabic/missing-Shortcuts errors and unchanged production flags. The
existing parser/accounting, future-capture, onboarding and published-artifact
tests remain enabled. The built IPA has an additional check for the actual new
App Intent names, required scalar parameter types and authentication policies.

The earlier date-filter result was supplied from the owner's iPhone: a valid
future date, Future=0 and Before-future=3. This proves that particular fixed
predicate, not full paging or a real bank-message import. Do not ask the owner to
repeat it or represent a model test as complete on-phone coverage.

## Explicit beta limits and release gate

The new source is for an owner/internal TestFlight acceptance build first.
External tester invitations remain blocked until that build completes the
real-device history → review → durable ledger journey and a separate real
future-alert capture test. The current phone was paired but passcode-locked at
the latest attempt; no lock or authentication prompt was bypassed.

Extraction requires iOS 26+ with readable Messages, Shortcuts foreground and an
unlocked phone. Stored progress expires after 24 hours. Storage is capped at
72 MiB; exceedingly dense seconds stop visibly. Deleted or unavailable iCloud
messages cannot be claimed as included. There is no claim of unlimited or
universal complete history, measured import speed, or successful phone import
from these host tests alone.

Independent review was attempted through the worker connector and the installed
read-only CLI. Session attribution and CLI/model compatibility prevented a
completed independent review. Those failed attempts are not counted as passes.
Exact final CI, artifact signatures and App Store processing are recorded in the
separate release handoff after the build, not inferred here.
