# Android inbox processing: fixed-pattern reuse

## Observed on the owner's phone before this change

Diagnostic APK 147 completed its existing run without a reset or restart.
The trace reached the provider's real end after 30 pages / 29,717 bridge-admitted
messages, then completed planning and durable saving. Total routine time was
1,928,369 ms; collection consumed 1,881,555 ms, planning 33,355 ms, and saving
13,437 ms. The first two 1,000-message reads took 164 and 145 ms, while their
processing loops took 77,899 and 62,555 ms.

This demonstrates an expensive processing path, not a repeating inbox cursor.
It does not attribute every millisecond to a particular function. The bridge
excludes sensitive messages, so its count must not be labelled the full raw
corpus size.

## Narrow implementation

Reuse only compiled grammar expressions in three hot modules. Market vocabulary
uses a bounded 1,024-entry cache; universal fixed phrases use 64 entries; ordered
currency-alias patterns use 32 entries. No SMS bodies, sender identities,
amounts, parsing results, keys or account relationships enter these caches.

The expressions and flags are unchanged. Non-global term/phrase tests have no
matching cursor. Alias iterators retain their explicit zero starting position.
Alias currency mappings are rebuilt for every call, so identical spellings do
not reuse a previous caller's currency assignment. This is not a parser-version
migration and does not intentionally trigger another full-history reread.

## Verification

- Typecheck, lint and the Ledger & Light design guard passed.
- All 71 application suites passed; 641 focused regression tests passed with
  zero failures or skipped tests.
- New executable checks verify warm-cache constructor reuse, unchanged results,
  currency mapping changes, Unicode, token escaping/order, offsets, iterator
  isolation and bounded eviction.
- A private read-only differential check forced the universal inspector across
  all 30,213 uploaded messages using a same-current-source pre-change runtime
  and the changed runtime. Every serialized result was identical (zero
  mismatches). The desktop measured 25,317 ms before / 19,991 ms after. This is
  an inspector benchmark, not a full-ledger replay or a phone-speed result.

Private logs, baseline snapshots and the reproducible comparison script are
outside tracked source in `builds/resume-20260908/phone-speed-20260910/`.
An independent worker was requested but could not start because the connector
returned `WORKER_IDENTITY_LOST`.

Actual new-build device timing must be measured separately. Do not report the
desktop timing improvement as a measured improvement on the phone.
