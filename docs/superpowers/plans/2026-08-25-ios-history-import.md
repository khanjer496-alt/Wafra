# iOS Message History Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an iOS 26+ user explicitly search a chosen retained Messages date range, stage the results locally, review parsed bank activity in Wafra, and delete the protected source session after confirmation or cancellation.

**Architecture:** The existing history Expo module becomes a Begin/Stage/Finish state machine with one ephemeral authorization secret, completed-manifest visibility, exact count reconciliation, and tombstoned cleanup. A pure TypeScript coordinator validates the completed descriptor, streams accepted chunks through the launch parser, removes raw body/sender data before review state, and preserves the screen's durable confirmation boundary. A separately published `Wafra History Import` Shortcut owns the user-started Find Messages query and contains no network, Files, clipboard, or embedded credential actions.

**Tech Stack:** Expo SDK 55, React Native 0.83, Expo Modules API, Swift App Intents on iOS 26+, Foundation/CryptoKit protected storage, TypeScript, Expo Router, Node test harness, Swift command-line tests.

**Spec:** `docs/superpowers/specs/2026-08-25-ios-history-import-design.md`

## Global Constraints

- Read the exact Expo SDK 55 documentation at `https://docs.expo.dev/versions/v55.0.0/` before changing Expo or React Native code.
- Automatic retained-Message search is offered on iOS 26.0 or later; iOS 15.1–25.x always keeps manual paste, PDF, and other explicit imports visible.
- The Shortcut name is exactly `Wafra History Import`, accepts no external input, and is distinct from `Wafra Local Capture`.
- Find Messages uses a date-only query. It must not require a body phrase or Contact/sender filter.
- The user chooses Last 30 days, This year, or Choose dates; end-day inclusion uses an exclusive next-day upper bound.
- Zero results stop before Begin. More than 10,000 results stop before staging and require a smaller date range.
- Every Find result contributes one staged Text item; an unextractable GUID, Content, or Date becomes exactly `{"v":0}`.
- Every valid v1 record ID is exactly the Message GUID's SHA-256 digest encoded
  as 64 lowercase hexadecimal characters; raw/UUID-shaped GUIDs and alternate
  encodings are rejected by native and JavaScript validation.
- Stage rejects input arrays over 50 before per-record filtering and persists attempted/accepted/skipped metadata even when accepted is zero.
- Finish requires contiguous zero-based chunk indices and exact found/attempted/accepted/skipped equations.
- Only complete manifests are bridge-visible. Open, invalid, tombstoned, expired, and partial sessions are never reviewable.
- History records are at most 16 KiB each, 10,000 accepted records, and 8 MiB per session; global storage is four sessions and 24 MiB.
- History storage uses complete file protection, atomic writes, backup exclusion, a serial coordinator plus Darwin `flock` around every public operation, and a fixed one-hour expiry.
- Wafra and its Shortcut do not transmit historical Message text. Apple Messages may separately sync retained content through iCloud.
- Raw Content is removed immediately after parse. Raw Sender is converted to normalized bank/card identity and removed before React review state or durable persistence.
- The shared artifact never embeds an authorization secret. Native storage keeps only a hash and invalidates it on finish, failure, discard, or expiry.
- Do not invent private iOS 26 Find Messages or custom App Intent plist fields. Export and inspect the exact graph after a native build exposes all three actions.
- Do not edit `ios/Pods/**` or generated Xcode files by hand; use the Expo config-plugin workflow and inspect generated changes.
- Preserve unrelated worktree changes and launch-tested Android, UAE, and Saudi behavior.
- Commit checkboxes define review boundaries only. Skip every commit command unless the user separately authorizes repository commits.
- When both iOS feature plans are executed in one worktree, finish the Local
  Capture feature plan before starting this plan so shared native/test/UI files
  are edited serially. Tasks 1–5 implement the history boundary; they do not
  publish an iCloud URL, edit shared release copy/configuration, deploy, or
  submit TestFlight. After both feature handoffs pass, execute
  `docs/superpowers/plans/2026-08-25-ios-shortcuts-release.md` once as the only
  publication/deployment/submission phase.

---

### Task 1: Authorized Native History Session State Machine

**Files:**
- Replace: `modules/wafra-message-history/ios/WafraMessageHistoryStore.swift`
- Replace: `scripts/test/native-history-store.swift`
- Modify: `scripts/test/native-history-store.sh`

**Interfaces:**
- Consumes: version-1 historical record contract from `src/lib/historical-import.ts` and exact `{"v":0}` sentinel behavior.
- Produces: native Begin/Stage/Finish, complete-session descriptor, protected reads, discard, expiry, and full erase operations.

- [ ] **Step 1: Rewrite the native tests around Begin/Stage/Finish**

Use these core assertions before retaining any legacy stage-only case:

```swift
let sessionId = "history-" + UUID().uuidString
let secret = try store.beginSession(sessionId: sessionId)
let counts = try store.stageChunk(
  sessionId: sessionId,
  authorizationSecret: secret,
  chunkIndex: 0,
  records: [validRecord(), "{\"v\":0}"]
)
check("stage records attempted count", counts.attempted == 2)
check("stage records accepted count", counts.accepted == 1)
check("stage records skipped count", counts.skipped == 1)
check("open session is hidden", try store.completedSession(sessionId: sessionId) == nil)
try store.finishSession(
  sessionId: sessionId,
  authorizationSecret: secret,
  totalChunks: 1,
  found: 2,
  attempted: 2,
  accepted: 1,
  skipped: 1
)
check("finished session is visible", try store.completedSession(sessionId: sessionId) != nil)
```

Add exact cases for duplicate Begin, wrong secret, over-50 input before
filtering, all-skipped chunk, identical retry, conflicting retry tombstone,
missing/noncontiguous chunk, every count mismatch, an exact 64-lowercase-hex
SHA-256 ID, uppercase/short/base64url/UUID-shaped/raw-GUID rejection, duplicate
ID across chunks, record/session/global limits, fixed expiry,
complete/open/tombstone visibility, two child processes contending on the same
lock across Begin/Stage/Finish/discard, failed deletion injection, cleanup
retry, full erase, backup exclusion, and `FileProtectionType.complete`.

- [ ] **Step 2: Run the native suite and verify failure**

Run: `bash scripts/test/native-history-store.sh`

Expected: FAIL because the current store implicitly creates sessions and has no authorization or completion state.

- [ ] **Step 3: Implement closed manifest states and count types**

Use these public contracts:

```swift
public struct WafraHistoryChunkCounts: Codable, Equatable {
  public let attempted: Int
  public let accepted: Int
  public let skipped: Int
}

public struct WafraCompletedHistorySession: Codable, Equatable {
  public let chunkIndices: [Int]
  public let found: Int
  public let attempted: Int
  public let accepted: Int
  public let skipped: Int
}

public final class WafraMessageHistoryStore {
  public static let shared = WafraMessageHistoryStore()
  public init(root: URL? = nil, now: @escaping () -> Date = Date.init)
  public func beginSession(sessionId: String) throws -> String
  public func stageChunk(sessionId: String, authorizationSecret: String, chunkIndex: Int, records: [String]) throws -> WafraHistoryChunkCounts
  public func finishSession(sessionId: String, authorizationSecret: String, totalChunks: Int, found: Int, attempted: Int, accepted: Int, skipped: Int) throws
  public func completedSession(sessionId: String) throws -> WafraCompletedHistorySession?
  public func readChunk(sessionId: String, chunkIndex: Int) throws -> [String]
  public func discardSession(sessionId: String) throws
  public func purgeExpired(now: Date) throws -> Int
  public func eraseAll() throws
}
```

The manifest must encode `open`, `complete`, or `invalid`; `createdAt`, fixed `expiresAt`, SHA-256 secret hash while open, per-chunk content digest and counts, and final totals while complete. Generate 32 random secret bytes with `SecRandomCopyBytes`, return base64url to Begin, and persist only `SHA256(secret)`.
Every public operation must execute through one private serial `DispatchQueue`
and a Darwin `flock` on `rootDirectory.appendingPathComponent(".lock")`. Acquire
both around cleanup scans, manifest reads/writes, chunk reads/writes, finish,
discard, purge, and erase so App Intents and the Expo process observe one order.

- [ ] **Step 4: Implement validation, tombstoning, and fixed expiry**

Before reading individual records, reject `records.count > 50`. For each input,
accept only the exact v1 keys and bounds, including `id` matching exactly
`^[0-9a-f]{64}$`; explicitly reject UUID-shaped/raw Message GUIDs and every
other SHA-256 encoding. Count `{"v":0}`, malformed, and
oversized inputs as skipped. An otherwise valid record with an empty,
over-80-character, control-marked, or bidi-marked optional sender remains
accepted after native code reserializes it without `sender`, matching the
JavaScript contract. Persist an empty accepted array plus metadata for an
all-skipped chunk. On conflict or storage failure, atomically replace the
manifest with `invalid`, clear its secret hash, hide it, then attempt deletion;
every public operation retries removal of invalid/expired directories.

Run: `bash scripts/test/native-history-store.sh`

Expected: PASS with no operation extending the fixed one-hour expiry and no error text containing record/session secret data.

- [ ] **Step 5: Commit the session protocol if commits are authorized**

```bash
git add modules/wafra-message-history/ios/WafraMessageHistoryStore.swift scripts/test/native-history-store.swift scripts/test/native-history-store.sh
git commit -m "feat: authorize and finish iOS history sessions"
```

---

### Task 2: Three History App Intents and Completed-Only Expo Bridge

**Files:**
- Replace: `modules/wafra-message-history/plugin/index.js`
- Modify: `modules/wafra-message-history/ios/WafraMessageHistory.podspec`
- Replace: `modules/wafra-message-history/ios/WafraMessageHistoryModule.swift`
- Create: `modules/wafra-message-history/ios/WafraMessageHistoryResources.swift`
- Replace: `modules/wafra-message-history/src/WafraMessageHistory.types.ts`
- Replace: `modules/wafra-message-history/src/WafraMessageHistoryModule.web.ts`
- Create: `modules/wafra-message-history/ios/Resources/en.lproj/WafraHistoryIntents.strings`
- Create: `modules/wafra-message-history/ios/Resources/ar.lproj/WafraHistoryIntents.strings`
- Modify: `scripts/test/native-history-store.sh`
- Create: `scripts/test/ios-history-native-contract.test.js`
- Modify: `scripts/test/run.sh`

**Interfaces:**
- Consumes: Task 1 native store.
- Produces: Begin, Stage, Finish App Intents and a bridge that exposes only completed descriptors/chunks.

- [ ] **Step 1: Write failing generated-intent and bridge assertions**

Require this TypeScript interface:

```ts
export interface CompletedHistorySession {
  chunkIndices: number[];
  found: number;
  attempted: number;
  accepted: number;
  skipped: number;
}

export interface WafraHistoryNativeModule {
  getCompletedSession(sessionId: string): Promise<CompletedHistorySession | null>;
  readChunk(sessionId: string, chunkIndex: number): Promise<string[]>;
  discardSession(sessionId: string): Promise<void>;
  purgeExpired(): Promise<number>;
  eraseAll(): Promise<void>;
}
```

Generated-source tests must find exactly one Begin with `.requiresLocalDeviceAuthentication`, one Stage and one Finish with `.alwaysAllowed`, all three at iOS 26.0+, all three background-only, and no Message record/secret in a dialog, URL, log, or notification. They must also prove the podspec packages both localization tables and every generated title, description, parameter, and source-free error resolves through the custom resource helper rather than an English literal.

- [ ] **Step 2: Run contract tests and verify failure**

Run:

```bash
bash scripts/test/native-history-store.sh
node scripts/test/ios-history-native-contract.test.js
```

Expected: FAIL because only `StageWafraMessageHistoryIntent` exists and open sessions are listable.

- [ ] **Step 3: Generate the three exact App Intents**

Add this exact CocoaPods resource bundle:

```ruby
s.resource_bundles = {
  'WafraMessageHistoryResources' => ['Resources/**/*']
}
```

`WafraMessageHistoryResources.swift` exposes a public helper that locates
`WafraMessageHistoryResources.bundle` from both
`Bundle(for: ResourceAnchor.self)` and `Bundle.main`, fails closed if the
bundle/key is absent, and constructs
`LocalizedStringResource(key, defaultValue: defaultValue, table:
"WafraHistoryIntents", bundle: .atURL(bundle.bundleURL))`. The app-target
source generated by the plugin imports the module and uses this helper for
every metadata/error string. Use these action boundaries (keys below are exact
resource keys):

```swift
@available(iOS 26.0, *)
struct BeginWafraHistoryImportIntent: AppIntent {
  static let title = WafraMessageHistoryResources.localized("history.begin.title")
  static let authenticationPolicy: IntentAuthenticationPolicy = .requiresLocalDeviceAuthentication
  static let supportedModes: IntentModes = .background
  @Parameter(title: WafraMessageHistoryResources.localized("history.session_id.parameter")) var sessionId: String
  func perform() async throws -> some IntentResult & ReturnsValue<String> {
    .result(value: try WafraMessageHistoryStore.shared.beginSession(sessionId: sessionId))
  }
}

@available(iOS 26.0, *)
struct StageWafraMessageHistoryIntent: AppIntent {
  static let title = WafraMessageHistoryResources.localized("history.stage.title")
  static let authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed
  static let supportedModes: IntentModes = .background
  @Parameter(title: WafraMessageHistoryResources.localized("history.session_id.parameter")) var sessionId: String
  @Parameter(title: WafraMessageHistoryResources.localized("history.authorization.parameter")) var authorizationSecret: String
  @Parameter(title: WafraMessageHistoryResources.localized("history.chunk.parameter")) var chunkIndex: Int
  @Parameter(title: WafraMessageHistoryResources.localized("history.records.parameter")) var records: [String]

  func perform() async throws -> some IntentResult & ReturnsValue<String> {
    let counts = try WafraMessageHistoryStore.shared.stageChunk(
      sessionId: sessionId,
      authorizationSecret: authorizationSecret,
      chunkIndex: chunkIndex,
      records: records
    )
    let value = "{\"attempted\":\(counts.attempted),\"accepted\":\(counts.accepted),\"skipped\":\(counts.skipped)}"
    return .result(value: value)
  }
}

@available(iOS 26.0, *)
struct FinishWafraHistoryImportIntent: AppIntent {
  static let title = WafraMessageHistoryResources.localized("history.finish.title")
  static let authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed
  static let supportedModes: IntentModes = .background
  @Parameter(title: WafraMessageHistoryResources.localized("history.session_id.parameter")) var sessionId: String
  @Parameter(title: WafraMessageHistoryResources.localized("history.authorization.parameter")) var authorizationSecret: String
  @Parameter(title: WafraMessageHistoryResources.localized("history.total_chunks.parameter")) var totalChunks: Int
  @Parameter(title: WafraMessageHistoryResources.localized("history.found.parameter")) var found: Int
  @Parameter(title: WafraMessageHistoryResources.localized("history.attempted.parameter")) var attempted: Int
  @Parameter(title: WafraMessageHistoryResources.localized("history.accepted.parameter")) var accepted: Int
  @Parameter(title: WafraMessageHistoryResources.localized("history.skipped.parameter")) var skipped: Int

  func perform() async throws -> some IntentResult {
    try WafraMessageHistoryStore.shared.finishSession(
      sessionId: sessionId,
      authorizationSecret: authorizationSecret,
      totalChunks: totalChunks,
      found: found,
      attempted: attempted,
      accepted: accepted,
      skipped: skipped
    )
    return .result()
  }
}
```

Stage returns only the source-free JSON count object shown above. Put every
referenced key, including descriptions and source-free failures, in both
English/Arabic resource tables declared above; generated intent metadata may
not retain literal English labels.

- [ ] **Step 4: Implement the bridge, regenerate, and compile**

Map `getCompletedSession` to Task 1's completed descriptor, refuse `readChunk`
unless that descriptor contains the requested index, and map `eraseAll`
directly to the atomic native operation. The web fallback returns `null`/empty
values and never simulates successful native staging.

Run:

```bash
npx expo prebuild --platform ios
bash scripts/test/native-history-store.sh
node scripts/test/ios-history-native-contract.test.js
npx tsc --noEmit
```

Expected: PASS; `ios/Wafra/WafraMessageHistoryIntent.swift` is regenerated in
the app Sources phase, the module compiles, an Xcode build copies
`WafraMessageHistoryResources.bundle` with both `en.lproj` and `ar.lproj`
tables, and an Arabic-locale assertion resolves a known Arabic value instead
of its key/English fallback. Register
`ios-history-native-contract.test.js` as its own suite in
`scripts/test/run.sh`; do not merge it into the local-capture artifact test.

- [ ] **Step 5: Commit intent/bridge integration if commits are authorized**

```bash
git add modules/wafra-message-history ios/Wafra/WafraMessageHistoryIntent.swift ios/Wafra.xcodeproj/project.pbxproj scripts/test/native-history-store.sh scripts/test/ios-history-native-contract.test.js scripts/test/run.sh
git commit -m "feat: expose complete iOS history imports"
```

---

### Task 3: Testable JavaScript History Coordinator and Privacy Boundary

**Files:**
- Create: `src/lib/ios-history-import.ts`
- Modify: `src/lib/historical-import.ts`
- Modify: `scripts/test/build.sh`
- Replace: `scripts/test/historical-import.test.js`

**Interfaces:**
- Consumes: `WafraHistoryNativeModule`, `parseHistoricalMessageRecords`, `bankFromSender`, and `buildImportPlan` input types.
- Produces: session validation, completed-summary reconciliation, bounded chunk streaming, sanitized parsed rows, and discard operations.

- [ ] **Step 1: Write failing coordinator tests**

Cover invalid deep-link IDs, missing/open/tombstoned sessions, noncontiguous descriptor indices, every count equation, chunk over 50, exact 64-lowercase-hex record IDs, uppercase/short/base64url/UUID-shaped/raw-GUID refusal, duplicate IDs across chunks, progress/yielding, JavaScript/native validation mismatch, cancellation, and cleanup failure:

```js
const result = await loadIosHistorySession({
  sessionId: 'history_session_0001',
  native,
  overrides: {},
  onProgress: (progress) => observed.push(progress),
  now: new Date('2026-08-25T12:00:00.000Z'),
});
eq('uses native found count', result.summary.found, 2);
eq('streams accepted rows only', result.summary.accepted, 1);
ok('raw sender is absent from review state', !('sender' in result.parsed[0]));
ok('canonical bank identity survives', typeof result.parsed[0].bankHint === 'string');
```

Add a failure test proving an accepted native record that fails JavaScript v1 validation prevents a partial review and triggers tombstoned discard.

- [ ] **Step 2: Run the focused suite and verify failure**

Run:

```bash
bash scripts/test/build.sh
node scripts/test/historical-import.test.js
```

Expected: FAIL because `src/lib/ios-history-import.ts` and completed-descriptor reconciliation do not exist.

- [ ] **Step 3: Sanitize Sender into structured identity during parsing**

Change historical parsing so a returned row never carries raw body or sender:

```ts
const sender = record.sender?.trim();
const senderBank = sender ? bankFromSender(sender)?.name : undefined;
const inspection = launchSession.inspect(record.text, sender ?? '');
const result = launchSession.parse(record.text, sender ?? '', inspection);
if (result) {
  const { raw: _raw, ...structured } = result;
  parsed.push({
    ...structured,
    bankHint: structured.bankHint ?? senderBank,
    smsTs: timestamp,
    channel: 'inbox',
    sourceEventId: record.id,
  });
}
```

Apply the same removal to declined rows after any initial plan evidence is derived; retain only timestamp, channel, reason, and opaque source ID.

- [ ] **Step 4: Implement the completed-session loader and pass tests**

Expose:

```ts
export interface IosHistoryImportSummary {
  found: number;
  attempted: number;
  accepted: number;
  skipped: number;
  parsed: number;
  declined: number;
  ignored: number;
  duplicates: number;
}

export interface LoadedIosHistorySession {
  sessionId: string;
  summary: IosHistoryImportSummary;
  parsed: ScannedSms[];
  declined: DeclinedSms[];
}

export async function loadIosHistorySession(input: {
  sessionId: string;
  native: WafraHistoryNativeModule;
  overrides: Record<string, CategoryId>;
  onProgress?: (value: { scanned: number; matched: number }) => void;
  now?: Date;
}): Promise<LoadedIosHistorySession>;
```

Validate descriptor equations before reading, require `chunkIndices` to equal
`0...(length-1)`, read/yield one chunk at a time, and validate every record ID
against exactly `/^[0-9a-f]{64}$/`. Explicitly reject UUID-shaped/raw GUIDs and
alternate digest encodings even if native storage somehow admitted them.
Require total read records to equal descriptor `accepted`, dedupe opaque IDs,
and classify native/JS contract mismatch as a failed session rather than
showing a prefix. Add `discardIosHistorySession(native, sessionId)` as an
idempotent wrapper.

Run:

```bash
bash scripts/test/build.sh
node scripts/test/historical-import.test.js
```

Expected: PASS with progress never exposing source text/sender.

- [ ] **Step 5: Commit the coordinator if commits are authorized**

```bash
git add src/lib/ios-history-import.ts src/lib/historical-import.ts scripts/test/build.sh scripts/test/historical-import.test.js
git commit -m "feat: validate and stream iOS history sessions"
```

---

### Task 4: One Stateful Import Card and Durable Review Flow

**Files:**
- Create: `src/lib/ios-history-setup.ts`
- Modify: `src/app/import-sms.tsx`
- Modify: `src/app/settings.tsx`
- Modify: `src/components/storage-recovery.tsx`
- Modify: `src/lib/i18n.ts`
- Modify: `scripts/test/contracts.test.js`
- Modify: `scripts/test/ios-setup-ux.test.js`
- Modify: `scripts/test/historical-import.test.js`

**Interfaces:**
- Consumes: Task 3 loader/discard functions, native completed descriptor, the public history URL, and existing ledger `importBatch`/`ensureDurable` receipts.
- Produces: Add → Start → Continue → Review card states and confirmation-time replanning.

- [ ] **Step 1: Write failing setup-state and screen contract tests**

Use this closed state model:

```ts
export type IosHistoryCardState =
  | 'unsupported'
  | 'install-unavailable'
  | 'needs-install'
  | 'ready'
  | 'running'
  | 'review';

export const IOS_HISTORY_HANDOFF_TTL_MS = 15 * 60_000;

export function iosSupportsMessageHistory(version: string | number): boolean;
export function historyShortcutRunUrl(): string;
```

Assert iOS `26`, `26.0`, and later are supported; 25.x is not. Assert the
screen always renders one card, never two independent install/run buttons,
shows an unavailable configuration state when the URL is absent, and expands
manual paste on older iOS. Advance a fake clock to 14:59 and 15:00: the former
remains `running`; the latter returns to `ready` with **Try again** and
**Reinstall Shortcut**. Assert cancel/reset clears the handoff timestamp. Add
an Erase Everything assertion that awaits the native history `eraseAll()`
operation through the store's existing post-erase cleanup callback.

- [ ] **Step 2: Run focused UX tests and verify failure**

Run:

```bash
node scripts/test/ios-setup-ux.test.js
node scripts/test/contracts.test.js
node scripts/test/historical-import.test.js
```

Expected: FAIL because the current screen requires iOS 26.5 and conditionally hides two separate buttons.

- [ ] **Step 3: Implement nonsensitive install/handoff state**

Use these exact constants and URL:

```ts
export const IOS_HISTORY_SHORTCUT_NAME = 'Wafra History Import';
export const IOS_HISTORY_INSTALL_MARKER = 'wafra/ios-history-shortcut-installed/v1';

export function historyShortcutRunUrl(): string {
  return `shortcuts://run-shortcut?name=${encodeURIComponent(IOS_HISTORY_SHORTCUT_NAME)}`;
}
```

Persist only a Boolean installation confirmation and a source-free handoff
timestamp. Returning from the iCloud install page shows `I added it`; that
explicit tap writes the marker. Starting writes the handoff timestamp before
opening Shortcuts. App foreground without a `history=` deep link keeps
`Continue in Shortcuts` only while
`now - handoffStartedAt < IOS_HISTORY_HANDOFF_TTL_MS`. At 15 minutes, clear the
timestamp, return to `ready`, and show **Try again** plus **Reinstall
Shortcut**. Cancel/reset clears the timestamp immediately. A valid completed
deep link clears the timestamp and becomes Review.

- [ ] **Step 4: Move the screen to the coordinator and preserve durability ordering**

Replace direct `listSessionChunks`/`readChunk` logic with `loadIosHistorySession`. Build the initial plan from sanitized structured rows. At confirmation, rebuild against the latest ledger state, await `importBatch(...).durable`, and only then call `discardSession`. A save failure retains the protected session; a cleanup failure shows `Delete staged messages` and permits leaving it for fixed expiry.

Add English and Arabic copy for Last 30 days/This year/Choose dates, Add/Start/Continue/Review states, iOS 26 requirement, local processing, exact matched/skipped counts, retry, and cleanup.
Wire both settings erase and storage-recovery erase to the same native history
`eraseAll()` cleanup. A native cleanup failure must leave the existing
`erased-cleanup` recovery state retryable rather than reporting full erasure.

Run:

```bash
node scripts/test/ios-setup-ux.test.js
node scripts/test/contracts.test.js
node scripts/test/historical-import.test.js
npm run typecheck
npm run lint
```

Expected: PASS; manual paste remains free and supplemental imports remain visible.

- [ ] **Step 5: Commit the one-card flow if commits are authorized**

```bash
git add src/lib/ios-history-setup.ts src/app/import-sms.tsx src/app/settings.tsx src/components/storage-recovery.tsx src/lib/i18n.ts scripts/test/contracts.test.js scripts/test/ios-setup-ux.test.js scripts/test/historical-import.test.js
git commit -m "feat: add one-card iPhone history import"
```

---

### Task 5: Exact History Shortcut Source, Builder, and Verifier

**Files:**
- Create: `docs/ios-history-shortcut-source.json`
- Create: `scripts/build-ios-history-shortcut.mjs`
- Create: `scripts/check-ios-history-shortcut-artifact.sh`
- Create: `scripts/test/ios-history-shortcut-artifact.test.js`
- Modify: `scripts/test/run.sh`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: all three Task 2 App Intents installed on iOS 26+ and Apple's exact Find Messages action serialization.
- Produces: auditable normalized source, deterministic builder/verifier, signed artifact, checksum, and a handoff to the combined release plan. It does not publish or configure a public URL.

- [ ] **Step 1: Build/install the App Intents before creating the Shortcut**

Run:

```bash
npx expo prebuild --platform ios
npx expo run:ios --device
```

Expected: an iOS 26+ physical device lists Begin, Stage, and Finish Wafra history actions. Without such a device, this task is externally gated; do not create a guessed Find Messages plist.

- [ ] **Step 2: Author and export the exact action graph**

On the device build this graph:

```text
Require System Version >= 26.0
Show local-processing disclosure and Continue/Cancel
Choose Last 30 days / This year / Choose dates
Find Messages using inclusive start and exclusive next-day end only
Count results; zero stops; over 10,000 asks for smaller range
Show exact count and confirm
Generate session ID; Begin once; retain returned secret in this run
For each result hash GUID with SHA-256, normalize the digest to exactly 64
lowercase hexadecimal characters, then emit v1 JSON or exactly {"v":0}; chunk into lists of at most 50
Stage every zero-based chunk with the same session/secret and accumulate counts
Finish with totalChunks/found/attempted/accepted/skipped
Open `wafra://import-sms?history=` followed by the URL-encoded session ID only after Finish succeeds
Stop without returning source data
```

Export, inspect with Apple tools, and save the normalized complete graph as `docs/ios-history-shortcut-source.json`.

- [ ] **Step 3: Add semantic artifact tests and verify they fail before the builder exists**

The test must follow variable dataflow and reject: external input; body/sender
filters; missing date bounds; over-10,000 continuation; wrong exact count;
missing sentinel; raw/UUID-shaped GUID; non-SHA-256 ID; a digest not normalized
to exactly 64 lowercase hexadecimal characters; local/non-UTC Date; chunk over
50; repeated Begin; missing secret threading; missing/incorrect Finish totals;
open-app before Finish; URL/network, Files, clipboard, analytics,
notifications, logs, embedded secret, or output containing a record.

Run: `node scripts/test/ios-history-shortcut-artifact.test.js`

Expected: FAIL because the history source/builder/verifier are absent.

- [ ] **Step 4: Implement deterministic build/check/sign and pass tests**

Build the exported graph exactly, with only Apple signing metadata permitted to differ. Decode signed files in the checker, restore Apple's separately stored record name, and compare the full normalized graph plus semantic constraints.

Run:

```bash
node scripts/build-ios-history-shortcut.mjs /tmp/WafraHistoryImport.json
node scripts/test/ios-history-shortcut-artifact.test.js
bash scripts/check-ios-history-shortcut-artifact.sh /tmp/WafraHistoryImport.json
plutil -convert binary1 -o /tmp/WafraHistoryImport.shortcut /tmp/WafraHistoryImport.json
shortcuts sign --mode anyone --input /tmp/WafraHistoryImport.shortcut --output /tmp/WafraHistoryImport.signed.shortcut
bash scripts/check-ios-history-shortcut-artifact.sh /tmp/WafraHistoryImport.signed.shortcut
```

Install that exact signed file, rerun it on the device, and keep it under ignored `artifacts/`.

Expected: builder, semantic verifier, signed-artifact checker, and on-device run PASS.

- [ ] **Step 5: Record the exact artifact handoff and commit source/verifier if authorized**

Install the exact signed file on the iOS 26+ authoring device, rerun it, confirm
its checksum after export, and record only the ignored artifact path/checksum
in feature evidence. Do not publish it yet: the combined release plan first
runs both complete physical matrices and then publishes the exact tested files
from the owning Apple account. Neither EAS, a simulator, a generated plist,
nor local signing creates a public share URL.

Register `ios-history-shortcut-artifact.test.js` as a separate suite in
`scripts/test/run.sh` and update the runner's exact expected suite count.

```bash
git add .gitignore docs/ios-history-shortcut-source.json scripts/build-ios-history-shortcut.mjs scripts/check-ios-history-shortcut-artifact.sh scripts/test/ios-history-shortcut-artifact.test.js scripts/test/run.sh
git commit -m "feat: define iOS history Shortcut artifact"
```

---

### Task 6: Feature Verification and Combined-Release Handoff

**Files:**
- Create: `docs/test-evidence/ios-history-import-implementation-2026-08-25.md`
- Modify only on discovered failure: files owned by Tasks 1–5.

**Interfaces:**
- Consumes: Tasks 1–5, including the checked signed artifact and one-card implementation.
- Produces: independently reviewed feature evidence and an explicit handoff to the combined release plan; no public URL, shared release edit, deployment, or TestFlight submission.

- [ ] **Step 1: Run feature-level verification**

Run:

```bash
npm run typecheck
npm run lint
npm test
npm run check
bash scripts/test/native-history-store.sh
node scripts/test/historical-import.test.js
node scripts/test/ios-history-shortcut-artifact.test.js
git diff --check
```

Expected: every command exits 0. Confirm Android inbox cursor behavior remains
unchanged and shared release files (`eas.json`, legal/store/landing copy, and
TestFlight scripts) were not changed by this plan.

- [ ] **Step 2: Obtain independent privacy/native/parser review**

Give the reviewer the history spec, this plan, exact graph, and complete
feature diff. Require explicit findings for cross-process locking,
authentication reuse, secret exposure, exact SHA-256 ID validation,
partial-session visibility, count mismatch, over-50 filtering order, tombstone
cleanup, App Intent localization bundle membership, sender/body retention,
15-minute handoff expiry, confirmation-time dedupe, deep-link validation, and
misleading iCloud/network claims. Resolve every P0/P1 finding and rerun Step 1.

- [ ] **Step 3: Record a source-free handoff**

Record command results, the ignored signed-artifact path/checksum, unresolved
physical-device cases, and the exact uncommitted/committed task paths. Do not
record Message text, sender/GUID values, authorization secrets, signing
material, invented iCloud URLs, or a claim that a build was submitted.

- [ ] **Step 4: Continue only through the combined release plan**

Verify Local Capture Tasks 0–9 have a passing handoff, then execute:

```text
docs/superpowers/plans/2026-08-25-ios-shortcuts-release.md
```

Expected: that plan is the sole owner of both physical release matrices, both
iCloud publications, shared release configuration/copy, D1/Worker deployment,
and the one iOS/TestFlight submission.

- [ ] **Step 5: Commit evidence only if commits are authorized**

```bash
git add docs/test-evidence/ios-history-import-implementation-2026-08-25.md
git commit -m "test: verify iOS history import implementation"
```
