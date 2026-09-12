# Android startup lag investigation

## Device baseline

Observed on a connected OnePlus CPH2653 running Android 16 on 2026-09-12.
Installed APK versionCode was **179**, built from `8ce7dcea68cbc110d56031a09bc346c326de6c45`.
The newest successful Actions APK was build 180; it was not the installed APK.

A cold launch reproduced the loading delay. The app still showed “Loading your
ledger” at eight seconds. Android thread samples showed `mqt_v_js` at about
100% CPU at four, eight and twelve seconds. By sixteen seconds it was idle,
with 13.76 CPU seconds accumulated. After startup settled, tapping Settings
showed that screen in the one-second screenshot. This supports a startup CPU
block; it does not independently reproduce every reported delayed Home tap.

App data was preserved. No SMS provider dump or private database extraction was
performed. Local screenshots, app logs and thread samples are under the ignored
`artifacts/android-device-diagnostics/20260912T112638Z/` directory; they must not
be published because screenshots can contain personal financial information.

## Source findings and changes

The installed build and current main have identical store, persistence and
Android parsing startup implementations. Saved raw SMS were synchronously
parsed again on every launch. A desktop CPU profile using the shipping parser
and 10,000 synthetic SMS rows attributed 95–96% of migration time to `parseSms`.
This is source-level attribution, not a JavaScript stack profile of the release
APK (which is not debuggable).

- Local hydration now reuses a completed saved-row parsing receipt, keyed by
  repair revision, parser version, market and merchant rules. It is separate
  from the full-inbox `parserVersion` migration receipt. Restoring a backup
  still forces repair, and exported backups omit the local receipt.
- The receipt and repaired rows use the existing atomic persistence boundary.
  User-edited rows remain protected, unsupported rows remain available, and
  parser failures cannot stamp a completed receipt.
- A necessary-token guard avoids an expensive promotional-sentence regular
  expression on ordinary alerts. The matching grammar is unchanged.

The first launch after this change, parser upgrades, rule changes or restoring
a backup can still perform the full synchronous repair. This change does not
claim to make those first-repair launches instantaneous or to eliminate other
Home projection costs.

## Validation

- `node scripts/test/db.test.js`: **214 passed, 0 failed**. The new repeat-launch
  regression was demonstrated failing before the receipt implementation.
- `node --test scripts/test/repair/parser-promo-performance.test.cjs`: **3 passed**;
  differential comparison with unconditional promo matching covers 552 messages.
- Existing parser and corpus tests run against freshly transpiled current
  parser source: **2,460 assertions passed** (1,054 parser, 1,338 bank corpus,
  68 SMS corpus).
- `npx tsc --noEmit`: passed.
- Focused ESLint for changed source and the new regression test: passed.
- Independent read-only review of both changes: no actionable findings.
- Related persistence and promo regression suites: **17 passed**.
- `npm test` was attempted but stopped in an unrelated native iOS Xcode gate:
  `xcodebuild: error: 'ios/Wafra.xcworkspace' does not exist.` The full suite is
  therefore **not passed**. Parser, corpus, database and the related regression
  suites above were then run explicitly against the freshly compiled source.

A controlled synthetic 10,000-row comparison retained all 10,000 raw messages
through merchant-pinned categories. On the identical saved snapshot, forcing
the old reparse behavior took 725 ms migration and 949 ms including the reducer;
receipt reuse took 56 ms migration and 294 ms including the reducer. Both
measurements include JSON round trips and transaction output was identical.
An earlier first-versus-repeat fixture dropped its raw messages while healing,
so those initial figures are not evidence of the receipt's benefit. These are
desktop Node timings, not Android end-to-end timings. The promo-only benchmark measured
109.24 ms to 80.64 ms median per 1,000 ordinary synthetic alerts.

## Delivery status

At source validation, no replacement APK had been built or installed, and the
physical-device improvement was **unverified**. The user subsequently authorized
committing and pushing the startup and merchant-logo changes and building both
Android and iOS. Build results must be verified separately against their source
commit; authorization and source tests are not evidence of a delivered binary.
The missing native workspace still blocks the full local test command. After installing
an authorized signed update, measure the first repair, repeated cold launch and
Home interactions on the same phone without erasing its data.
