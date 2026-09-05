# Simple iOS History Import Implementation Plan

> **Status:** The array-bulk Tasks 1–2 are retained as a decision record. The
> physical-iPhone gate superseded that transport with the scalar prepared
> design in
> [`../specs/2026-08-31-ios-prepared-history-import-design.md`](../specs/2026-08-31-ios-prepared-history-import-design.md).
> Release work must use `PrepareWafraHistoryMessageIntent` inside Repeat and one
> authenticated `ImportWafraPreparedHistoryIntent` after it; the public graph
> must not use the array-bulk intent.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the user-visible Begin/Stage/Finish wiring with one authenticated bulk Wafra action and publish an exact physically tested History Shortcut for a new TestFlight build.

**Architecture:** A focused Swift importer converts three aligned Message-property arrays into exact version-1 records, packs them into 50-attempt chunks, and drives the existing authorized store protocol. A fourth generated App Intent exposes that importer to one signed Shortcut while the current completed-session bridge, parser coordinator, review UI, and cleanup boundary remain unchanged.

**Tech Stack:** Expo SDK 55, React Native 0.83, Expo config plugins, Swift 6, App Intents, Foundation/CryptoKit, Apple Shortcuts on iOS 26+, Node and Swift test harnesses, EAS Build/Submit.

**Spec:** `docs/superpowers/specs/2026-08-31-ios-simple-history-import-design.md`

## Global Constraints

- Read the exact Expo SDK 55 docs before changing Expo or native integration code.
- Wafra never claims direct iOS Messages access; `Find Message` remains an explicit user-run Apple Shortcut action.
- The published Shortcut is exactly `Wafra History Import` and accepts no external input.
- Find uses only `date is after startBoundary` and `date is before exclusiveEnd`; Body/Sender/Contact/Conversation filters are prohibited.
- `startBoundary` is the selected local start-of-day minus one second; `exclusiveEnd` is local start-of-day after the selected end date.
- Zero and over-10,000 results stop before native Begin.
- Three aligned arrays contain exactly one GUID String, Body String, and Date per Find result; missing values use empty Strings and Unix epoch Date.
- Native code emits exactly `{"v":0}` for an invalid aligned item, otherwise SHA-256 lowercase-hex identity, UTF-8-bounded Body, and UTC ISO-8601 milliseconds.
- Native code stages exactly 50 attempted records per chunk except the final 1...49 remainder.
- One bulk intent requires local-device authentication; the low-level Begin/Stage/Finish intents remain compatible but are absent from the public graph.
- No raw GUID, Body, Date, record, or authorization secret may reach an error, URL, log, notification, analytics event, Files, clipboard, or output.
- The exact signed artifact must run on the physical iPhone before its iCloud URL enters `eas.json`.
- Public TestFlight build 38 is the older setup-only binary; the working release must use a newly incremented build.
- Preserve unrelated worktree changes. Do not commit or push unless the user separately authorizes repository publication.

---

### Task 1: Test-Driven Bulk Native Importer

**Files:**
- Create: `modules/wafra-message-history/ios/WafraMessageHistoryImporter.swift`
- Modify: `scripts/test/native-history-store.swift`
- Modify: `scripts/test/native-history-store.sh`

**Interfaces:**
- Consumes: `WafraMessageHistoryStore.beginSession`, `stageChunk`, `finishSession`, and `discardSession`.
- Produces:

```swift
public struct WafraBulkHistoryImportResult: Equatable {
  public let totalChunks: Int
  public let found: Int
  public let attempted: Int
  public let accepted: Int
  public let skipped: Int

  public init(
    totalChunks: Int,
    found: Int,
    attempted: Int,
    accepted: Int,
    skipped: Int
  )
}

public final class WafraMessageHistoryImporter {
  public static let shared = WafraMessageHistoryImporter()

  public init(
    store: WafraMessageHistoryStore = .shared,
    now: @escaping () -> Date = Date.init
  )

  public func importMessages(
    sessionId: String,
    found: Int,
    messageGUIDs: [String],
    bodies: [String],
    dates: [Date]
  ) throws -> WafraBulkHistoryImportResult
}
```

- [ ] **Step 1: Add RED native tests for aligned input and canonical records**

Add harness helpers that create a temporary `WafraMessageHistoryStore`, inject a fixed `now`, call the interface above, then inspect `completedSession` and `readChunk`. Include exact assertions equivalent to:

```swift
let importer = WafraMessageHistoryImporter(store: store, now: { fixedNow })
let result = try importer.importMessages(
  sessionId: "history-bulk-valid",
  found: 1,
  messageGUIDs: ["MESSAGE-GUID-1"],
  bodies: ["AED 12.34 spent at TEST SHOP"],
  dates: [fixedNow.addingTimeInterval(-60)]
)
check("bulk accepted", result == WafraBulkHistoryImportResult(
  totalChunks: 1, found: 1, attempted: 1, accepted: 1, skipped: 0
))
let record = try store.readChunk(sessionId: "history-bulk-valid", chunkIndex: 0).first!
check("bulk hashes GUID", record.contains(
  "\"id\":\"2ab8a9ceeae492fc18e53f245cae765ff19b6991946fd50cb205049b33c9b1b7\""
))
check("bulk emits UTC milliseconds", record.contains("\"receivedAt\":\"2026-08-31T"))
check("bulk omits raw GUID", !record.contains("MESSAGE-GUID-1"))
```

Calculate the known SHA-256 expected value once in the test fixture and hardcode it; do not calculate expected with production code.

- [ ] **Step 2: Add RED boundary, rollback, and privacy tests**

Cover exact array mismatch permutations, `found` 0, `found` 10,001, 49/50/51/10,000 packing, empty GUID, empty/whitespace/over-16-KiB Body, Unix epoch/more-than-five-minutes-future Date, Unicode/quotes/backslashes/newlines, duplicate GUID conflict, injected chunk-write failure, injected deletion failure/tombstone retry, and a successful completed descriptor readable by the existing bridge. Assert every error description and reflected value excludes GUID, Body, Date, session secret, and record JSON.

- [ ] **Step 3: Run the native suite and verify RED**

Run:

```bash
bash scripts/test/native-history-store.sh
```

Expected: FAIL because `WafraMessageHistoryImporter.swift` and its API do not exist.

- [ ] **Step 4: Implement the focused importer**

Create `WafraMessageHistoryImporter.swift` with these private boundaries:

```swift
private static let maximumRawGUIDBytes = 1_024
private static let missingDate = Date(timeIntervalSince1970: 0)

private func preparedRecord(guid: String, body: String, date: Date) -> String
private func canonicalInstant(_ date: Date) -> String?
private func sha256Hex(_ data: Data) -> String
```

`preparedRecord` returns `{"v":0}` unless GUID UTF-8 is 1...1,024 bytes, Body is nonblank and at most `WafraMessageHistoryStore.maxTextBytes`, and Date is finite, later than Unix epoch, and no more than five minutes after `now()`. Valid records use `JSONSerialization.data(withJSONObject:options:[.sortedKeys])` with exactly `v`, `id`, `text`, and `receivedAt`.

`importMessages` validates found/cardinality before Begin. After Begin, keep the secret in a local variable, build records in input order, stage `records[index..<min(index+50,count)]`, sum returned counts, and call Finish with exact totals. A `defer` best-effort discards only while completion is false; set completion true immediately after successful Finish so no later source-free result construction removes a valid session.

- [ ] **Step 5: Include the new Swift file in the native harness**

Update the `swiftc` invocation in `scripts/test/native-history-store.sh` to compile:

```bash
modules/wafra-message-history/ios/WafraMessageHistoryStore.swift \
modules/wafra-message-history/ios/WafraMessageHistoryImporter.swift \
scripts/test/native-history-store.swift
```

- [ ] **Step 6: Run focused native verification**

Run:

```bash
bash scripts/test/native-history-store.sh
swiftc -warnings-as-errors -parse-as-library \
  modules/wafra-message-history/ios/WafraMessageHistoryStore.swift \
  modules/wafra-message-history/ios/WafraMessageHistoryImporter.swift \
  scripts/test/native-history-store.swift \
  -o /tmp/wafra-native-history-warnings
git diff --check -- \
  modules/wafra-message-history/ios/WafraMessageHistoryImporter.swift \
  scripts/test/native-history-store.swift \
  scripts/test/native-history-store.sh
```

Expected: all native assertions pass and Swift emits no warning.

- [ ] **Step 7: Record the task boundary without committing**

Append exact command counts/results and changed paths to `.superpowers/sdd/2026-08-25-ios-history-import/progress.md`. Skip Git commit because no separate commit authorization exists.

---

### Task 2: Authenticated Bulk App Intent and Localization

**Files:**
- Modify: `modules/wafra-message-history/plugin/index.js`
- Modify: `modules/wafra-message-history/ios/Resources/en.lproj/WafraHistoryIntents.strings`
- Modify: `modules/wafra-message-history/ios/Resources/ar.lproj/WafraHistoryIntents.strings`
- Modify: `scripts/test/ios-history-native-contract.test.js`
- Modify: `scripts/test/native-history-store.sh`
- Generated by prebuild: `ios/Wafra/WafraMessageHistoryIntent.swift`

**Interfaces:**
- Consumes: `WafraMessageHistoryImporter.shared.importMessages(...)` from Task 1.
- Produces: `ImportWafraMessageHistoryIntent` with parameters `sessionId`, `found`, `messageGUIDs`, `bodies`, and `dates`.

- [ ] **Step 1: Write RED generated-source and metadata assertions**

Extend `historyIntentNames` with `ImportWafraMessageHistoryIntent`. Require exactly four history intents; Begin and bulk use `.requiresLocalDeviceAuthentication`; Stage and Finish remain `.alwaysAllowed`; all four are iOS 26.0+ and `.background`.

Require this exact bulk source contract:

```swift
@Parameter(...) var sessionId: String
@Parameter(...) var found: Int
@Parameter(...) var messageGUIDs: [String]
@Parameter(...) var bodies: [String]
@Parameter(...) var dates: [Date]

func perform() async throws -> some IntentResult {
  do {
    _ = try WafraMessageHistoryImporter.shared.importMessages(
      sessionId: sessionId,
      found: found,
      messageGUIDs: messageGUIDs,
      bodies: bodies,
      dates: dates
    )
    return .result()
  } catch {
    throw WafraHistoryIntentError.importFailed
  }
}
```

Assert no `ReturnsValue`, record, GUID, Body, Date, authorization, URL, log, notification, or dialog includes source data. Update clean-fixture/mutation expectations from three to four intents and add bulk auth/parameter mutations.

- [ ] **Step 2: Add RED English/Arabic key parity assertions**

Require exact new keys in both tables:

```text
history.import.title
history.import.description
history.import.error
history.message_guids.parameter
history.bodies.parameter
history.dates.parameter
```

Reuse existing `history.session_id.parameter` and `history.found.parameter`. Require every generated metadata string to use direct `.main` `LocalizedStringResource`; require runtime error lookup through `WafraMessageHistoryResources.localized`.

- [ ] **Step 3: Run contract tests and verify RED**

Run:

```bash
node scripts/test/ios-history-native-contract.test.js
bash scripts/test/native-history-store.sh
```

Expected: FAIL because the fourth intent/localizations are missing.

- [ ] **Step 4: Generate the bulk App Intent from the config plugin**

Add `importFailed` to `WafraHistoryIntentError`, add the exact intent above, preserve the existing three structs byte-for-byte, and use these metadata keys:

```javascript
history.import.title
history.import.description
history.session_id.parameter
history.found.parameter
history.message_guids.parameter
history.bodies.parameter
history.dates.parameter
```

Add concise English and Arabic values. Errors must say only that Wafra could not import the selected history and to try a smaller range or manual import.

- [ ] **Step 5: Regenerate and inspect the iOS source**

Run:

```bash
npx expo prebuild --platform ios
rg -n 'ImportWafraMessageHistoryIntent|messageGUIDs|bodies|dates' \
  ios/Wafra/WafraMessageHistoryIntent.swift
```

Expected: one generated bulk intent in the Wafra Sources phase; no manual edit under `ios/Pods/**`.

- [ ] **Step 6: Pass metadata extraction and focused gates**

Run:

```bash
node scripts/test/ios-history-native-contract.test.js
bash scripts/test/native-history-store.sh
node scripts/test/historical-import.test.js
node scripts/test/ios-setup-ux.test.js
npm run typecheck
npm run lint
git diff --check
```

Expected: every command exits 0. Inspect the built app's `Metadata.appintents/extract.actionsdata` and verify the bulk intent has five exact parameters, iOS 26.0 availability, background mode, and authentication policy 2.

- [ ] **Step 7: Obtain independent native/privacy review**

Give a read-only reviewer the amendment spec, Task 1/2 diff, native tests, and generated metadata. Require explicit findings on pre-Begin validation, GUID hashing, sentinel alignment, 50 packing, secret lifetime, rollback/tombstones, App Intent output/privacy, localization bundles, and compatibility of the existing three intents. Resolve every P0/P1 and rerun Step 6.

---

### Task 3: Exact Signed History Shortcut and Physical iPhone Gate

**Files:**
- Create from physical export: `docs/ios-history-shortcut-source.json`
- Create: `scripts/build-ios-history-shortcut.mjs`
- Create: `scripts/check-ios-history-shortcut-artifact.sh`
- Create: `scripts/test/ios-history-shortcut-artifact.test.js`
- Modify: `scripts/test/run.sh`
- Modify: `.gitignore`
- Create from observed evidence: `docs/test-evidence/ios-history-import-implementation-2026-08-31.md`

**Interfaces:**
- Consumes: the physical build containing `ImportWafraMessageHistoryIntent`.
- Produces: one exact audited/signed Shortcut artifact and checksum; no public URL until the physical run passes.

- [ ] **Step 1: Build and install the native action on the connected iPhone**

Run a supported Xcode 26.2+ EAS development build when quota is available:

```bash
npx --yes eas-cli@22.4.0 build --platform ios --profile development
```

Install the resulting ad-hoc IPA on the registered iPhone and verify the built metadata before launch. A local Xcode 26.1 build may be used for simulator schema discovery only, not release evidence.

- [ ] **Step 2: Probe the bulk action bindings before authoring the full graph**

On the physical iPhone, create a temporary Shortcut with one `Find Message` action and `Import Wafra message history`. Bind literal one-item GUID/Body/Date arrays and a valid session ID/count. Export and inspect it to prove Apple's exact five parameter wrapper shapes and the physical TeamIdentifier. Delete no user Messages and record no source values.

- [ ] **Step 3: Author the complete user graph on the physical iPhone**

Build exactly:

```text
Require iOS >= 26
Show local-processing disclosure
Choose Last 30 days / This year / Choose dates
Compute startBoundary = local start-of-day - 1 second
Compute exclusiveEnd = local start-of-day after selected end
Find Message where date is after startBoundary AND date is before exclusiveEnd
Count results; zero stops; >10,000 stops; confirm exact count
Generate UUID sessionId
Initialize GUIDs=[], Bodies=[], Dates=[]
Repeat each Message in Find order:
  GUID or "" -> Add to GUIDs
  Body as Text or "" -> Add to Bodies
  Date or 1970-01-01T00:00:00Z -> Add to Dates
Require all three counts equal found
Import Wafra message history(sessionId, found, GUIDs, Bodies, Dates)
Open wafra://import-sms?history=<percent-encoded sessionId>
Stop without output
```

Use Apple UI actions only. Do not introduce Body/Sender/Contact/Conversation filters or a relay/network action.

- [ ] **Step 4: Export and freeze the exact physical graph**

In Shortcuts use name arrow → **Export File** → **Anyone** → Save to Files/AirDrop. Decode the file with `plutil`, preserve action UUIDs/grouping/order/descriptors/workflow metadata, normalize only proven signing/share fields, and save the complete source as `docs/ios-history-shortcut-source.json`. Verify the name is exactly `Wafra History Import` and the App Intent descriptor has the physical team.

- [ ] **Step 5: Write RED semantic/mutation tests**

Require complete normalized equality plus dataflow checks. Mutations must reject: external input; missing iOS gate/disclosure; Body/Sender/Contact/Conversation filter; incorrect/reversed date bounds; zero/over-10,000 reaching import; mismatched confirmation count; fewer/more than one aligned value per Message; nonempty missing-property placeholders; direct raw GUID in v1 JSON; low-level Begin/Stage/Finish actions; repeated bulk import; mismatched session/count/arrays; deep link before import; extra query data; network/Files/clipboard/log/notification/output actions.

Run:

```bash
node scripts/test/ios-history-shortcut-artifact.test.js
```

Expected: FAIL before builder/checker exist.

- [ ] **Step 6: Implement one deterministic builder/verifier**

`scripts/build-ios-history-shortcut.mjs` exports `buildHistoryShortcut()` and `verifyHistoryShortcutGraph(graph)`. The shell checker delegates to that same verifier after decoding JSON, binary plist, or signed AEA input. Two builder calls produce byte-identical JSON. The checker restores only Apple's separately stored record name before normalized equality.

- [ ] **Step 7: Build, check, sign, and recheck**

Run:

```bash
node scripts/build-ios-history-shortcut.mjs /tmp/WafraHistoryImport.json
node scripts/test/ios-history-shortcut-artifact.test.js
bash scripts/check-ios-history-shortcut-artifact.sh /tmp/WafraHistoryImport.json
plutil -convert binary1 -o /tmp/WafraHistoryImport.shortcut /tmp/WafraHistoryImport.json
shortcuts sign --mode anyone \
  --input /tmp/WafraHistoryImport.shortcut \
  --output /tmp/WafraHistoryImport.signed.shortcut
bash scripts/check-ios-history-shortcut-artifact.sh \
  /tmp/WafraHistoryImport.signed.shortcut
shasum -a 256 /tmp/WafraHistoryImport.signed.shortcut
```

Expected: every checker/test passes; record only checksum/path, never source data.

- [ ] **Step 8: Run the exact signed file on the physical iPhone**

Install that exact signed file, choose a small controlled range, and verify: carrier SMS and iMessage are returned; missing Body creates a skipped sentinel; one authentication boundary; bulk action succeeds; Wafra opens only after completion; review totals match; airplane-mode run transmits no historical text; confirm/save produces ledger rows; staged source deletes after durable save. Then increase controlled ranges through 50, 500, 2,000 and near the 8-MiB boundary. An observed App Intent/XPC limit becomes an explicit smaller supported cap in code/copy/tests before release.

- [ ] **Step 9: Register the artifact suite and evidence**

Add `ios-history-shortcut-artifact` as the next exact suite in `scripts/test/run.sh`, update the expected suite count, ignore generated signed artifacts under `artifacts/`, and record source-free physical results/checksum in the evidence file.

---

### Task 4: Public Shortcut URL and New TestFlight Build

**Files:**
- Modify: `eas.json`
- Modify: `scripts/test/release-readiness.test.js`
- Modify only if physical UX exposes a defect: `src/app/import-sms.tsx`, `src/app/ios-setup.tsx`, `src/lib/ios-history-setup.ts`, `src/lib/i18n.ts`, and focused tests
- Modify with observed results: `docs/test-evidence/ios-history-import-implementation-2026-08-31.md`

**Interfaces:**
- Consumes: Task 3's exact physically passing signed artifact.
- Produces: distinct public iCloud URL embedded in a newly incremented TestFlight binary.

- [ ] **Step 1: Publish the exact tested artifact from the owning iPhone account**

Share the installed `Wafra History Import` Shortcut as an iCloud link. Accept only a URL matching:

```text
https://www.icloud.com/shortcuts/[0-9a-f]{32}
```

Download/inspect the public record and prove its normalized graph and checksum correspond to the physically tested artifact. Do not invent or reuse the retired capture URL.

- [ ] **Step 2: Write RED release-profile assertions**

Extend `release-readiness.test.js` to require `EXPO_PUBLIC_WAFRA_HISTORY_SHORTCUT_URL` in `capture-beta`, `production`, and `production-candidate`; require exact iCloud shape and inequality with `EXPO_PUBLIC_WAFRA_SHORTCUT_URL` and the retired capture URL. Verify the history card remains visible with a source-free unavailable state when the variable is absent.

- [ ] **Step 3: Add the observed URL to shipping profiles**

Set the same verified History URL in the three profiles above. Do not change the capture URL in this task; the combined release plan owns replacing the separate local-capture artifact after its physical gate.

- [ ] **Step 4: Run the complete feature gate**

Run:

```bash
npm run typecheck
npm run lint
npm test
npm run check
bash scripts/test/native-history-store.sh
node scripts/test/historical-import.test.js
node scripts/test/ios-history-native-contract.test.js
node scripts/test/ios-history-shortcut-artifact.test.js
node scripts/test/ios-setup-ux.test.js
node scripts/test/release-readiness.test.js
git diff --check
```

Expected: every command exits 0. Obtain a final independent privacy/native/parser review and resolve every P0/P1.

- [ ] **Step 5: Confirm release identities read-only**

Verify EAS owner/project, Apple team, bundle ID, App Store Connect app, current latest build number, external beta group, and public TestFlight link. Record the prior TestFlight build as setup-only and choose a strictly higher build number automatically.

- [ ] **Step 6: Build with supported Xcode and submit once**

Run after the EAS iOS quota permits:

```bash
npx --yes eas-cli@22.4.0 build \
  --platform ios \
  --profile production-candidate \
  --auto-submit
```

Expected: supported Xcode 26.2+, incremented build number, successful processing in App Store Connect. If cloud quota remains unavailable, stop rather than presenting a local Xcode 26.1 build as the release gate.

- [ ] **Step 7: Publish accurate TestFlight metadata**

State that iOS history import is user-started through Apple Shortcuts, runs locally, cannot recover deleted/unavailable Messages, and is distinct from future automatic capture. Add the processed build to the external Beta group and submit Beta App Review once. Keep the existing public TestFlight group/link.

- [ ] **Step 8: Verify the public beta on the physical iPhone**

Install from public TestFlight, repeat one small carrier-SMS history import, verify return/review/save/delete, and confirm the installed production binary exposes the bulk action and both localization tables. Only then record History Import as operational.

- [ ] **Step 9: Continue to the combined future-alert release**

Execute `docs/superpowers/plans/2026-08-25-ios-shortcuts-release.md` for the separately signed `Wafra Local Capture` artifact, exact observed bank sender allowlist, one real future locked-phone alert, relay retirement, shared public copy, and final combined claims. iOS cannot be described as Android-style direct inbox access.
