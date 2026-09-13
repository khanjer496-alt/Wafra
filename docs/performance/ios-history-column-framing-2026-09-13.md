# iOS history import: column framing candidate and run-name repair

Date: 13 September 2026.

## What was broken in the production build

`eas.json` `production` installs the paged History record
(`5a0da9b5d3a641d9958f3dfa37851afa`, which Apple installs under the name
**Wafra-History-v2-typed-date.signed**) but does not set
`EXPO_PUBLIC_WAFRA_PAGED_HISTORY_BETA`. `IOS_HISTORY_SHORTCUT_NAME` was chosen by
that flag, so a production build installed one Shortcut and then asked Shortcuts
to run **Wafra History Import**, a name that is not on the phone. Shortcuts fails
the `run-shortcut` URL, the `x-error` callback returns the user to `/import-sms`
with no session, and setup looks broken at the exact step the user just
completed.

The run name now follows the configured install URL
(`IOS_HISTORY_SHORTCUT_INSTALLED_RECORDS` in `src/lib/ios-history-setup.ts`),
which is the same rule the live-capture module already applied. The install
copy names the Shortcut the user will actually see, and Continue re-runs a paged
graph by name because that graph resumes its saved cursor and fences the earlier
runner; the legacy two-ended graph still only reopens Shortcuts, because
re-running it would start a second import. `scripts/test/ios-setup-ux.test.js`
pins the production URL/name pair and the agreement between the runtime table,
`ios-paged-setup.ts` and `scripts/release/ios-public-shortcut-check.mjs`.

The installed name is still the signed file's basename. To present a clean name,
sign the next artifact as `Wafra History Import.shortcut`, publish it, add the
new record ID and its installed name to the table above, and point
`EXPO_PUBLIC_WAFRA_HISTORY_SHORTCUT_URL` at it. Do not rename the existing record:
phones that already installed it resolve by the name they have.

## Why history import is slow

The published v2 graph moved the native handoff from once per Message to once
per bounded page, but it still runs about ten interpreted Shortcuts actions per
Message inside Repeat With Each: four field reads, four Base64 encodes, one Text
and one Append. A 10,000-message inbox is therefore ~100,000 interpreted actions
before any native work, and the earlier per-message-intent graph measured 23
minutes for 3,000 references. Shortcuts' per-action cost, not Wafra's parser, is
the bound.

## Column framing (`Wafra History v3`, candidate)

`scripts/build-ios-paged-history-shortcut.mjs` now also generates a
column-framed graph (`buildColumnarHistoryShortcut`, 126 actions). For each
page it applies Apple's own list-wide actions to the whole Message list:

1. Format Date over the page's `date` property (the same
   `yyyy-MM-dd'T'HH:mm:ss.SSSXXX` instant the v2 line frame uses).
2. Combine Text with the `␞` (U+241E) separator over the page's `GUID`, `Body`
   and `Sender` properties and over the formatted dates.
3. One call to `StageWafraPagedColumnsIntent` with the four joined columns.

A page therefore costs the same handful of actions whether it holds 51 or 408
Messages. No App Intent array parameter is bound; the entity-property array
binding that failed on-device for the earlier bulk intent is not used.

Natively, `WafraPagedHistoryStore.stageColumns` splits each column, requires the
GUID, body and date columns to line up exactly with the page count, rebuilds the
existing `b64|b64|b64|b64` line frame, and calls the unchanged `stage`. Every
cursor, journal, retry-idempotence, capacity and record rule applies as before.
A sender column that does not line up is dropped as a whole (sender is optional
in the stored record) rather than shifted across rows. A GUID, body or date
mismatch — a body containing the sentinel, or a nil property dropped by
Combine Text — is refused as `frame-columns`, and the graph then runs the exact
v2 per-message framing for that page only, bound to the untouched request, so
no page is ever committed misaligned and no inbox is blocked by one odd message.

The v2 generator output is byte-identical to before this change
(SHA-256 `0a39c7f5d5dce2954ee8c8e098a7db922f6b09feffa4f56c186fb603923b6c43` of its
JSON, 98 actions); the public-record check and the released app are unaffected.

## Verification status — read this before publishing

| Check | Result |
| --- | --- |
| v2 graph unchanged; v3 graph deterministic, bounded, source-free, nested correctly | `node --test scripts/test/ios-paging-shortcut.test.mjs` passes (17 tests) |
| Paged intent metadata gate includes the column intent | `scripts/check-ios-paging-metadata.mjs`, `ios-journey/paged-metadata.test.cjs` |
| Native column path: same cursor as row framing, sentinel-in-body refusal, dropped sender column, round-trip body | added to `scripts/test/ios-history-paging.swift`; **not executed here — no `swiftc` on this Linux host**. Run `bash scripts/test/ios-history-paging.sh` on a Mac before any build. |
| App Intent compiles | **not verified here**; the iOS CI job compiles the generated `WafraPagedImportIntents.swift`. |
| Combine Text over a Message property list yields one item per Message, including Messages with no text or no sender | **not verified on an iPhone.** This is the assumption the whole speedup rests on. |

### The phone test that does not need a new app build

`node scripts/build-ios-column-frame-check.mjs` generates **Wafra Column Frame
Check**: one 25-message query, the identical column construction, then each
column split back on the separator and counted. The alert shows only counts:

```
WAFRA_COLUMN_PROBE_V1
messages=25
guids=25
bodies=25
senders=25
dates=25
```

Sign it with `shortcuts sign --mode anyone` on a Mac, run it on the iPhone with
a conversation that contains an attachment-only Message and a group thread in
the newest 25, and record the alert. All five counts equal means column framing
is viable and v3 can be signed as `Wafra History Import.shortcut` and taken
through the existing physical import acceptance. `bodies` or `guids` below
`messages` means Combine Text drops nil items on this iOS build; v3 would then
fall back to per-message framing on every such page, which is correct but not
faster — do not publish it in that case. `senders` below `messages` is tolerated
by design.

Nothing in this document is evidence of a measured phone import time.
