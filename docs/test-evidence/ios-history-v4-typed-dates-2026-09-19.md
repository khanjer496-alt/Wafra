# iOS history import v4: typed dates (19 September 2026)

Base: `origin/main` `abb50ee4`. Phone: iPhone 16 Pro, iOS 26.6.2, Wafra build 150
(production profile, record `bc30c7ae…`, installed as
`Wafra-History-v2-typed-date.signed`).

## What the phone showed on build 150

Running the installed v2 History Shortcut ends in the alert

> Wafra could not start or resume this history import (reason). Open Wafra to
> check saved progress.

with the literal word `(reason)`. That text is thrown by
`BeginWafraPagedImportIntent`. Its Swift source is generated from a JavaScript
template literal in `modules/wafra-message-history/plugin/paged.js`, where
`\(reason)` is consumed by JavaScript before Swift sees it, so the store's
failure code was never interpolated. The same bug hid every Begin failure since
the paged graph shipped; the sibling generator (`plugin/index.js`) already used
`\\(`.

## Why v2 could not be made reliable

Every v2 date left Shortcuts through Format Date. On this phone iOS 26
materialized the Message `date` property as the localized display string
(`12 Sep 2026 at 9:22 PM`) wherever the graph formatted it as text (native
tolerance commits `42109327`, `45c89604`). A display string has no seconds. The
paged cursor withholds the last whole second of a full page as overlap and
requires the next page to return exactly those rows; with minute-precision rows
the overlap check (`missing-overlap`) or the strict range check fails as soon as
a page boundary falls inside a busy minute, and the Sep 17 "Baseline 200" fell
back to the legacy graph for that reason. Parsing display strings natively
cannot recover the lost seconds.

The only date binding with physical evidence on this device is a `Date` App
Intent parameter fed the Message `date` property directly: the legacy
per-message graph (builds 39/44) imported real history that way, and Apple's
`LNPrimitiveValueType` 8 (`Date`) is what the metadata gate now pins.

## What changed

- `plugin/paged.js`: `\\(reason)` so the alert names the failing check; new
  `BeginWafraPagedImportV2Intent` (`oldestDate`/`newestDate: Date`),
  `StageWafraPagedRowIntent` (`request, guid, body, sender, date: Date`) and
  `CommitWafraPagedPageIntent` (`request, found: Int`). The v2/v3 intents are
  unchanged so existing installs keep their behavior.
- `WafraPagedHistoryStore.swift`: `begin(…Instant:)`, `stageRow`, `commitRows`.
  Rows are buffered in the exact framed form `stage` already validates, so the
  commit reuses every cursor, size, journal and replay rule. A re-staged GUID is
  ignored; a commit whose Shortcuts count disagrees with the staged rows is
  refused (`invalid-input-rows staged=N found=M`) without touching the cursor;
  a lost commit acknowledgement is answered with the current cursor; a new run
  always starts from an empty row buffer.
- `scripts/build-ios-paged-history-shortcut.mjs --rows`: **Wafra History v4**,
  86 actions. No Format Date, Detect Date, Base64 or Combine Text. One typed
  native call per Message inside the page loop, one commit per page. The v2 and
  v3 graphs are byte-identical to before (public record check passes).
- App: the v4 record is the Apple-signed release asset
  `ios-history-v4-20260919/Wafra-History-v4.signed.shortcut`, installed by
  Apple as `Wafra-History-v4.signed`; `ios-history-setup.ts` and
  `ios-paged-setup.ts` run that name for that URL; every iOS EAS profile
  installs it; the release check pins its SHA-256
  `740e24e6a001718ebcf9fc06f0d88a29a10718c85350582acb30c54e4d9f5fad`.

## Verification performed

| Check | Result |
| --- | --- |
| `bash scripts/test/ios-history-paging.sh` | 264 passed (13 new typed-row checks: ordering refusal, exact first cursor, empty-commit refusal, duplicate row ignored, count mismatch refused with cursor untouched, replay acknowledgement, stale row, oversized body staged as skipped, resume, full 120-row completion, body round trip) |
| `node --test scripts/test/ios-paging-shortcut.test.mjs` | 19 passed, including the v4 binding test |
| `scripts/test/ios-journey/paged-metadata.test.cjs`, `paged-history-setup.test.cjs`, `paged-history-interactions.test.cjs` | 11 passed |
| `scripts/test/ios-shortcuts-config.test.js`, `scripts/test/ios-setup-ux.test.js` | 5 / 274 passed |
| `node scripts/release/ios-public-shortcut-check.mjs` | v2 record, capture record and the v4 asset all `passed` |
| Mac Shortcuts engine | The previous owner's status probes reproduce the old `Please choose a value for each parameter` error and its coercion fix; the v2 graph with Messages and Wafra intents stubbed runs its whole loop to the completion branch (`sim2-listpages`). |

## Not verified here

- No iPhone run of v4: build 150 does not contain the v4 intents, so the
  signed v4 record cannot execute until the next TestFlight build. The first
  device run must confirm that `StageWafraPagedRowIntent` receives exact
  instants (seconds present in the saved cursor) and record the page timing.
- Per-message native calls are slower than a text frame; the legacy graph
  measured about 0.6 s per Message. v4 is built for correctness first.
- The Apple Messages query and the Message automation for new transactions are
  unchanged by this work.
