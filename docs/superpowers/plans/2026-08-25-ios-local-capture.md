# iOS Local Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace relay-backed iPhone SMS capture with one credential-free Shortcut and one local Message automation that stages, parses, saves, and deletes future bank alerts on the iPhone.

**Architecture:** A new Expo local module owns a protected, bounded live-message queue and two App Intents. A pure TypeScript coordinator drains that queue through the existing launch parser and import planner, acknowledges records only after durable storage, and retires only the old relay Shortcut-ingest scope after the first qualifying local alert. The existing iOS setup screen becomes a two-stage installer/automation guide while relay email, PDF, CSV, and trusted-device features remain independent.

**Tech Stack:** Expo SDK 55, React Native 0.83, Expo Modules API, Swift App Intents, Foundation file storage, Cloudflare Workers/D1, TypeScript, Node test harness, Swift command-line tests.

**Spec:** `docs/superpowers/specs/2026-08-25-ios-local-capture-design.md`

## Global Constraints

- Read the exact Expo SDK 55 documentation at `https://docs.expo.dev/versions/v55.0.0/` before changing Expo or React Native code.
- The app deployment floor remains iOS 15.1; local App Intent capture is offered only on iOS 16.0 or later.
- The Shortcut name is exactly `Wafra Local Capture` and its only accepted Text input is exactly `WAFRA_LOCAL_CAPTURE_TEST_V1`.
- The target personal automation is Message, Any Sender, empty Message Contains, Run Immediately, and complete Received Message input.
- If the current stable iOS release does not permit that complete trigger, the feature remains unreleased; no partial keyword fallback is permitted.
- Native persistence accepts only exact aliases from `config/ios-bank-senders.json`; substring, regex, fuzzy, prefix, and body-name admission are prohibited.
- Raw Message content is never written to logs, analytics, URLs, notifications, UserDefaults, Keychain, D1, or the relay.
- Native bodies are limited to 16 KiB, senders to 80 characters, the queue to 2,000 records and 8 MiB, and retention to 30 days.
- Queue records use `completeUntilFirstUserAuthentication`, atomic writes, and backup exclusion.
- JavaScript reads and acknowledges no more than 50 records at a time and permits only one drain at a time.
- Native capture admission is disabled by default. Setup explicitly enables it
  only after the user confirms the automation; opt-out, manual-only setup, and
  Erase Everything disable it before changing app state or deleting data.
- Each native page is validated as one market before mutation. The registry's
  `AE`/`SA` value is passed to the launch parser as `forcedMarket`, and the
  ledger must accept that same market through `CaptureLedgerAdapter.setMarket`.
- The old relay remains active during dual-run migration; only its Shortcut-ingest scope is retired after the first qualifying local alert is durable.
- Existing email, PDF, CSV, queue/sync, background wake, and trusted-device behavior must survive relay migration unchanged.
- Do not invent private Shortcuts plist fields. Export the exact graph from Apple Shortcuts after the App Intents exist, then codify and verify that graph.
- Do not edit `ios/Pods/**` or generated Xcode files by hand; regenerate them through the Expo config-plugin workflow and inspect the resulting diff.
- Preserve unrelated worktree changes. `package.json` and `package-lock.json` do not need changes for this feature.
- Commit checkboxes define review boundaries only. Skip every commit command unless the user separately authorizes repository commits.
- Tasks 0–8 implement and verify the feature boundary. They do not publish an
  iCloud link, edit shared release configuration/copy, deploy production, or
  submit TestFlight. After this plan and History Import Tasks 1–5 both pass,
  execute `docs/superpowers/plans/2026-08-25-ios-shortcuts-release.md` once as
  the only serialized publication/deployment/submission phase.
- When both feature plans run in one worktree, complete this local plan first
  and then the history plan; do not concurrently edit their shared native,
  test-runner, settings, i18n, or generated iOS files.

---

### Task 0: Physical Message-Trigger Feasibility Gate

**Files:**
- Create after the check succeeds: `docs/test-evidence/ios-message-trigger-feasibility-2026-08-25.md`

**Interfaces:**
- Consumes: a physical iPhone on the current stable iOS release.
- Produces: a go/no-go answer for Any Sender plus empty Message Contains.

- [ ] **Step 1: Create a disposable Message automation**

Open Shortcuts → Automation → New Automation → Message. Leave Sender as
`Any Sender`, leave Message Contains unset, select `Run Immediately`, and press
Next. Record the iOS version, device model, whether Next is enabled, and the
exact selected values without including any conversation or Message content.

- [ ] **Step 2: Verify the complete trigger is accepted**

Expected: Shortcuts accepts the trigger with both Sender and Message Contains
unrestricted. If Apple requires either field, stop this plan and mark the
architecture blocked; do not insert a bank-name, amount, currency, or other
partial-coverage phrase.

- [ ] **Step 3: Remove the disposable automation**

Delete it before implementation so it cannot run beside the later exact Wafra
automation.

- [ ] **Step 4: Record source-free evidence**

Write only device model, iOS build, date, trigger fields, Run Immediately
selection, and pass/fail to the evidence file. Do not include screenshots that
show contact names or Message content.

- [ ] **Step 5: Commit evidence only if commits are authorized**

```bash
git add docs/test-evidence/ios-message-trigger-feasibility-2026-08-25.md
git commit -m "test: record iOS Message trigger feasibility"
```

---

### Task 1: Canonical Bank-Sender Admission Registry

**Files:**
- Create: `config/ios-bank-senders.json`
- Create: `scripts/generate-ios-bank-senders.mjs`
- Create: `src/lib/ios-bank-senders.generated.ts`
- Create: `src/lib/ios-bank-senders.ts`
- Create: `modules/wafra-live-capture/ios/WafraBankSenderRegistry.generated.swift`
- Modify: `scripts/test/build.sh`
- Modify: `scripts/test/ios-capture-setup.test.js`
- Reference: `scripts/test/fixtures/uae-bank-formats.js`
- Reference: `scripts/test/fixtures/saudi-bank-formats.js`

**Interfaces:**
- Consumes: physical sender evidence plus parser fixtures that already identify the same bank.
- Produces: `normalizeIosBankSender(value: string): string | null`, `iosBankSenderIdentity(value: string): { market: 'AE' | 'SA'; bankId: string } | null`, and Swift `WafraBankSenderRegistry.identity(for:)` with matching results.

The generated Swift also defines:

```swift
public struct WafraBankSenderIdentity: Equatable {
  public let market: String
  public let bankId: String
}
```

- [ ] **Step 1: Write failing registry and generator tests**

Add table-driven assertions to `scripts/test/ios-capture-setup.test.js` that load the JSON, run the generator in a temporary directory, and verify exact normalization, duplicate rejection, and Swift/JSON synchronization:

```js
const senderCases = [
  ['EMIRATES NBD', 'emiratesnbd'],
  ['Emirates-NBD', 'emiratesnbd'],
  ['Al_Rajhi.Bank', 'alrajhibank'],
  ['AB\u202eCD', null],
  ['', null],
];

for (const [input, expected] of senderCases) {
  eq(`sender normalization: ${JSON.stringify(input)}`, normalizeIosBankSender(input), expected);
}
const registryFixture = {
  v: 1,
  aliases: [{
    alias: 'EMIRATES NBD', market: 'AE', bankId: 'emirates-nbd', evidence: 'test-fixture',
  }],
};
ok('exact fixture sender is accepted',
  iosBankSenderIdentity('Emirates-NBD', registryFixture)?.bankId === 'emirates-nbd');
ok('substring sender is refused',
  iosBankSenderIdentity('FAKE-EMIRATES-NBD-OFFER', registryFixture) === null);
ok('generated Swift is current', generatedSwift === checkedInSwift);
ok('generated TypeScript is current', generatedTypeScript === checkedInTypeScript);
```

The initial JSON must contain only aliases for which the evidence field names a masked physical-message record controlled by the project. Do not populate aliases from display names alone.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node scripts/test/ios-capture-setup.test.js`

Expected: FAIL because `config/ios-bank-senders.json`, the generator, and the exported JavaScript helpers do not exist.

- [ ] **Step 3: Implement the canonical registry and deterministic generator**

Use this exact initial JSON. It deliberately remains empty until the combined
release plan adds aliases backed by masked physical-message evidence; parser
display names are not evidence:

```json
{
  "v": 1,
  "aliases": []
}
```

Each later alias object has exactly four fields: `alias`, `market`, `bankId`,
and `evidence`; `market` is `AE` or `SA`, and `evidence` is the identifier of a
masked physical-message record stored outside the public source corpus.

`src/lib/ios-bank-senders.ts` must export the JavaScript helpers and consume
only the generated, sorted entry constant:

```ts
import { IOS_BANK_SENDER_ALIASES } from '@/lib/ios-bank-senders.generated';

export interface IosBankSenderAlias {
  alias: string;
  market: 'AE' | 'SA';
  bankId: string;
  evidence: string;
}

export interface IosBankSenderRegistry {
  v: 1;
  aliases: IosBankSenderAlias[];
}

export function normalizeIosBankSender(value: string): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 80) return null;
  if(/[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/u.test(value)) return null;
  const normalized = value.normalize('NFKC').toLocaleLowerCase('en-US')
    .replace(/[ ._-]/g, '');
  return normalized.length === 0 || normalized.length > 80 ? null : normalized;
}

export function iosBankSenderIdentity(
  value: string,
  registry: IosBankSenderRegistry = { v: 1, aliases: IOS_BANK_SENDER_ALIASES },
): { market: 'AE' | 'SA'; bankId: string } | null {
  const key = normalizeIosBankSender(value);
  if (key === null) return null;
  const entry = registry.aliases.find((candidate) =>
    normalizeIosBankSender(candidate.alias) === key);
  return entry ? { market: entry.market, bankId: entry.bankId } : null;
}
```

Reject a registry when two aliases normalize to the same key but differ in market or bank ID, when evidence is missing, or when a field is outside the closed contract. Emit sorted Swift dictionary literals and a Swift normalizer with the same scalar rules.
Emit `src/lib/ios-bank-senders.generated.ts` from the same sorted aliases and
add `ios-bank-senders` to the pure modules compiled by `scripts/test/build.sh`.

- [ ] **Step 4: Regenerate and rerun the focused test**

Run:

```bash
node scripts/generate-ios-bank-senders.mjs config/ios-bank-senders.json src/lib/ios-bank-senders.generated.ts modules/wafra-live-capture/ios/WafraBankSenderRegistry.generated.swift
bash scripts/test/build.sh
node scripts/test/ios-capture-setup.test.js
```

Expected: PASS, including exact alias, lookalike, control/bidi, length, collision, and generated-file assertions.

- [ ] **Step 5: Commit the registry boundary if commits are authorized**

```bash
git add config/ios-bank-senders.json scripts/generate-ios-bank-senders.mjs src/lib/ios-bank-senders.generated.ts src/lib/ios-bank-senders.ts modules/wafra-live-capture/ios/WafraBankSenderRegistry.generated.swift scripts/test/build.sh scripts/test/ios-capture-setup.test.js
git commit -m "feat: define iOS bank sender admission registry"
```

---

### Task 2: Protected Native Live Queue

**Files:**
- Create: `modules/wafra-live-capture/ios/WafraLiveCaptureStore.swift`
- Create: `scripts/test/native-live-capture-store.swift`
- Create: `scripts/test/native-live-capture-store.sh`
- Modify: `scripts/test/run.sh`

**Interfaces:**
- Consumes: `WafraBankSenderRegistry.identity(for:)` from Task 1.
- Produces: Swift `WafraLiveCaptureStore.stage`, `setCaptureEnabled`, `listPendingRecords`, `acknowledgeRecords`, `purgeExpired`, `status`, `recordSetupProof`, `recordFirstCapturedAt`, `acknowledgeCaptureWarning`, and `eraseAll`.

- [ ] **Step 1: Write the failing Foundation-level queue tests**

Create an injected-root test harness and assert the public result/status shapes:

```swift
let store = WafraLiveCaptureStore(
  root: testRoot,
  now: { clock },
  senderIdentity: { sender in
    sender == "EMIRATES NBD"
      ? WafraBankSenderIdentity(market: "AE", bankId: "emirates-nbd")
      : nil
  }
)
check("capture starts disabled", try store.status().enabled == false)
check("disabled staging writes nothing", try store.stage(
  sender: "EMIRATES NBD",
  body: "AED 12.00 spent at TEST",
  eventId: "7D72166B-E969-47B4-989A-DB97624049CA",
  observedAt: clock
) == .disabled)
try store.setCaptureEnabled(true)
let accepted = try store.stage(
  sender: "EMIRATES NBD",
  body: "AED 12.00 spent at TEST",
  eventId: "7D72166B-E969-47B4-989A-DB97624049CA",
  observedAt: clock
)
check("known sender is staged", accepted == .accepted)
check("stable listing returns one record", try store.listPendingRecords(limit: 50).count == 1)
try store.acknowledgeRecords(ids: ["7D72166B-E969-47B4-989A-DB97624049CA"])
check("ack removes only the named snapshot row", try store.status().pending == 0)
```

Add cases for unknown/substring senders, invalid UUID/date/body/sender,
identical retry, conflicting ID reuse, observedAt/id ordering, a concurrent
append after list, two child processes contending on the same lock, 50-ID
acknowledgement bounds, 30-day expiry, 2,000-record/8-MiB capacity, source-free
dropped count, corrupt-record tombstoning, setup proof, earliest-value first
milestone idempotence, disabled-by-default persistence, disable-versus-stage
interleaving across child processes, erase leaving admission disabled, backup exclusion, and
`FileProtectionType.completeUntilFirstUserAuthentication`.

- [ ] **Step 2: Run the native test and verify failure**

Run: `bash scripts/test/native-live-capture-store.sh`

Expected: FAIL because `WafraLiveCaptureStore.swift` has not been created.

- [ ] **Step 3: Implement the queue with serial and interprocess locking**

Use these public contracts:

```swift
public enum WafraLiveStageResult: String, Codable {
  case accepted, ignored, invalid, capacityReached, disabled
}

public struct WafraLiveCaptureStatus: Codable {
  public let enabled: Bool
  public let pending: Int
  public let dropped: Int
  public let corrupt: Bool
  public let warningId: String?
  public let setupProofVersion: Int?
  public let setupProofAt: TimeInterval?
  public let firstCapturedAt: TimeInterval?
}

public final class WafraLiveCaptureStore {
  public static let shared = WafraLiveCaptureStore()
  public init(
    root: URL? = nil,
    now: @escaping () -> Date = Date.init,
    senderIdentity: @escaping (String) -> WafraBankSenderIdentity? = WafraBankSenderRegistry.identity
  )
  public func stage(sender: String, body: String, eventId: String, observedAt: Date) throws -> WafraLiveStageResult
  public func setCaptureEnabled(_ enabled: Bool) throws
  public func listPendingRecords(limit: Int) throws -> [String]
  public func acknowledgeRecords(ids: [String]) throws
  public func purgeExpired() throws -> Int
  public func status() throws -> WafraLiveCaptureStatus
  public func recordSetupProof(version: Int, at: Date) throws
  public func recordFirstCapturedAt(_ date: Date) throws
  public func acknowledgeCaptureWarning(id: String) throws -> Bool
  public func eraseAll() throws
}
```

Every public operation must execute inside one `DispatchQueue` and a Darwin
`flock` on `rootDirectory.appendingPathComponent(".lock")`. Write each record
and manifest with `.atomic` plus
`.completeFileProtectionUntilFirstUserAuthentication`; set
`isExcludedFromBackup = true` on the root. A list reads an immutable manifest
snapshot, sorts by `observedAt` then `id`, and returns at most
`min(max(limit, 0), 50)`. Acknowledgement removes only listed IDs, remains
successful for missing IDs, and never uses list position. Corruption first
writes a source-free tombstone/status manifest atomically, then attempts
deletion.

Store `enabled` in the protected manifest and initialize a missing/new
manifest to `false`. `stage` checks that flag under the same serial/file lock
before validation or persistence and returns `.disabled` without writing a
record or source-derived counter. `setCaptureEnabled(false)` wins atomically
against a concurrent stage according to lock order. `eraseAll()` first writes
a disabled tombstone, removes queue/proof/milestone/counter data, and recreates
only a disabled empty manifest before returning.

- [ ] **Step 4: Register and pass both native suites**

Modify the Darwin block in `scripts/test/run.sh` to execute both scripts and increment `NATIVE_SUITES` after each successful script:

```bash
if [ "$(uname -s)" = "Darwin" ]; then
  bash native-history-store.sh
  NATIVE_SUITES=$((NATIVE_SUITES + 1))
  bash native-live-capture-store.sh
  NATIVE_SUITES=$((NATIVE_SUITES + 1))
fi
```

Run:

```bash
bash scripts/test/native-live-capture-store.sh
bash scripts/test/native-history-store.sh
```

Expected: both suites PASS and no raw body/sender appears in a failure message.

- [ ] **Step 5: Commit the queue boundary if commits are authorized**

```bash
git add modules/wafra-live-capture/ios/WafraLiveCaptureStore.swift scripts/test/native-live-capture-store.swift scripts/test/native-live-capture-store.sh scripts/test/run.sh
git commit -m "feat: add protected iOS live capture queue"
```

---

### Task 3: Expo Module and Background App Intents

**Files:**
- Create: `modules/wafra-live-capture/expo-module.config.json`
- Create: `modules/wafra-live-capture/index.ts`
- Create: `modules/wafra-live-capture/src/WafraLiveCapture.types.ts`
- Create: `modules/wafra-live-capture/src/WafraLiveCaptureModule.ts`
- Create: `modules/wafra-live-capture/src/WafraLiveCaptureModule.web.ts`
- Create: `modules/wafra-live-capture/ios/WafraLiveCapture.podspec`
- Create: `modules/wafra-live-capture/ios/WafraLiveCaptureModule.swift`
- Create: `modules/wafra-live-capture/ios/Resources/en.lproj/WafraIntents.strings`
- Create: `modules/wafra-live-capture/ios/Resources/ar.lproj/WafraIntents.strings`
- Create: `modules/wafra-live-capture/plugin/index.js`
- Modify: `app.json`
- Test: `scripts/test/ios-capture-setup.test.js`
- Test: `scripts/test/native-live-capture-store.sh`

**Interfaces:**
- Consumes: all Task 2 store methods.
- Produces: JavaScript `WafraLiveCaptureNativeModule` and the discoverable `RecordWafraCaptureSetupProofIntent` / `StageWafraLiveMessageIntent` actions.

- [ ] **Step 1: Add failing bridge and generated-intent contract tests**

Assert this exact TypeScript surface and generated Swift properties:

```ts
export interface WafraLiveCaptureStatus {
  enabled: boolean;
  pending: number;
  dropped: number;
  corrupt: boolean;
  warningId: string | null;
  setupProofVersion: number | null;
  setupProofAt: number | null;
  firstCapturedAt: number | null;
}

export interface WafraLiveCaptureNativeModule {
  setCaptureEnabled(enabled: boolean): Promise<void>;
  listPendingRecords(limit: number): Promise<string[]>;
  acknowledgeRecords(ids: string[]): Promise<void>;
  purgeExpired(): Promise<number>;
  getCaptureStatus(): Promise<WafraLiveCaptureStatus>;
  acknowledgeCaptureWarning(warningId: string): Promise<boolean>;
  recordFirstCapturedAt(observedAt: number): Promise<void>;
  eraseAll(): Promise<void>;
}
```

The source assertions must reject HTTP, Files, clipboard, logs, notifications, and input-echoing dialogs, and require `.alwaysAllowed`, `openAppWhenRun = false`, and an iOS-26-only `supportedModes = .background` extension. They must also prove the podspec packages both `Resources/*.lproj/WafraIntents.strings` files and generated intents resolve every title/parameter/error through that custom table and bundle rather than string literals.

- [ ] **Step 2: Run the bridge contract test and verify failure**

Run: `node scripts/test/ios-capture-setup.test.js`

Expected: FAIL because the Expo module and generated intent source do not exist.

- [ ] **Step 3: Implement the module wrapper and config plugin**

Map every bridge method, including `setCaptureEnabled`, directly to the store
and reject limits before calling it. In `WafraLiveCapture.podspec`, declare:

```ruby
s.resource_bundles = {
  'WafraLiveCaptureResources' => ['Resources/**/*']
}
```

Expose a public `WafraLiveCaptureResources` helper from the module. It locates
the CocoaPods-created `WafraLiveCaptureResources.bundle` from both
`Bundle(for: ResourceAnchor.self)` and `Bundle.main`, fails closed when it or a
key is absent, and
constructs `LocalizedStringResource` with table `WafraIntents` and that exact
bundle URL. Missing bundles/keys are build-test failures, not English
fallbacks. Generate two App Intents with these declarations, using resource
keys such as `live.stage.title` rather than the English literals shown here:

```swift
@available(iOS 16.0, *)
struct StageWafraLiveMessageIntent: AppIntent {
  static let title = WafraLiveCaptureResources.localized("live.stage.title")
  static let authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed
  static let openAppWhenRun = false

  @Parameter(title: "Sender") var sender: String
  @Parameter(title: "Message") var body: String
  @Parameter(title: "Event ID") var eventId: String
  @Parameter(title: "Observed at") var observedAt: Date

  func perform() async throws -> some IntentResult & ReturnsValue<String> {
    let result = try WafraLiveCaptureStore.shared.stage(
      sender: sender,
      body: body,
      eventId: eventId,
      observedAt: observedAt
    )
    return .result(value: result.rawValue)
  }
}

@available(iOS 26.0, *)
extension StageWafraLiveMessageIntent {
  static var supportedModes: IntentModes { .background }
}
```

Generate `RecordWafraCaptureSetupProofIntent` with no parameters, the same authentication/background declarations, and a call to `recordSetupProof(version: 1, at: Date())`. Add `./modules/wafra-live-capture/plugin` after the module's autolinked pod is available.
The Expo bridge converts native epoch seconds to JavaScript epoch milliseconds
for all three timestamps and converts `recordFirstCapturedAt` milliseconds back
to a `Date`. Put all App Intent titles, parameter labels, and source-free errors
in the English/Arabic resource tables declared above.

- [ ] **Step 4: Regenerate iOS and verify source membership and compilation**

Run:

```bash
npx expo prebuild --platform ios
bash scripts/test/native-live-capture-store.sh
node scripts/test/ios-capture-setup.test.js
npx tsc --noEmit
```

Expected: PASS; `ios/Wafra/WafraLiveCaptureIntent.swift` is in the Wafra Sources phase, the pod compiles, no iOS-26-only symbol is referenced outside an availability boundary, the built app contains `WafraLiveCaptureResources.bundle/en.lproj/WafraIntents.strings` and `ar.lproj/WafraIntents.strings`, and an Arabic-locale build resolves a known key to Arabic rather than the key/English fallback.

- [ ] **Step 5: Commit the native integration if commits are authorized**

```bash
git add app.json modules/wafra-live-capture ios/Wafra/WafraLiveCaptureIntent.swift ios/Wafra.xcodeproj/project.pbxproj scripts/test/ios-capture-setup.test.js scripts/test/native-live-capture-store.sh
git commit -m "feat: expose local capture App Intents"
```

---

### Task 4: Local Record Parser and Durable Drain Coordinator

**Files:**
- Create: `src/lib/local-message-record.ts`
- Create: `src/lib/ios-local-capture.ts`
- Modify: `src/lib/auto-import.ts`
- Modify: `src/lib/import-plan.ts`
- Modify: `scripts/test/build.sh`
- Modify: `scripts/test/ios-capture-setup.test.js`
- Test: `scripts/test/import-plan.test.js`

**Interfaces:**
- Consumes: `WafraLiveCaptureNativeModule`, `CaptureLedgerAdapter`, `createLaunchAlertSession`, review admission helpers, and `buildImportPlan`.
- Produces: `parseLocalMessageRecord`, `createIosLocalCaptureCoordinator`, and serialized `drain()` execution.

- [ ] **Step 1: Write failing record and durability-order tests**

Cover exact v1 decoding, unknown keys, UTF-8/Unicode failures, future timestamps, source value, raw removal, sender-to-bank attribution, forced AE/SA parsing, SAR while the ledger starts in AED, mixed-market page refusal before mutation, missing/refused `setMarket`, distinct UUID semantic dedupe, duplicate financial qualification, admitted/rejected review qualification, reconciled/no-op decline qualification, one in-flight drain, retirement retry ownership, and acknowledgement ordering:

```js
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const nextMicrotask = () => new Promise((resolve) => setTimeout(resolve, 0));
const rejects = async (operation, pattern) => {
  try {
    await operation();
    throw new Error('operation resolved');
  } catch (error) {
    if (!pattern.test(String(error))) throw error;
  }
};
const durable = deferred();
const drain = createIosLocalCaptureCoordinator({ native, ledger });
const pending = drain.drain();
await nextMicrotask();
eq('source is not acknowledged before durable save', native.acknowledged, []);
durable.resolve();
await pending;
eq('source is acknowledged after durable save', native.acknowledged, [recordId]);

ledger.importBatch = () => ({ ids: ['tx-1'], durable: Promise.reject(new Error('disk')) });
await rejects(() => drain.drain(), /disk/);
eq('failed storage leaves source queued', native.acknowledged, []);
```

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
bash scripts/test/build.sh
node scripts/test/ios-capture-setup.test.js
node scripts/test/import-plan.test.js
```

Expected: FAIL because the local record parser/coordinator exports do not exist.

- [ ] **Step 3: Implement the parser without returning raw text**

Use this closed outcome:

```ts
export type LocalMessageParseOutcome =
  | { kind: 'parsed'; market: 'AE' | 'SA'; row: ScannedSms; milestone: 'financial' }
  | { kind: 'declined'; market: 'AE' | 'SA'; row: DeclinedSms; milestone: 'decline-candidate' }
  | { kind: 'review'; market: 'AE' | 'SA'; item: ReviewAlert; milestone: 'review-candidate' }
  | { kind: 'ignored'; market: 'AE' | 'SA'; milestone: 'none' }
  | { kind: 'invalid'; milestone: 'none' };

export function parseLocalMessageRecord(
  serialized: string,
  now: Date,
  expectedMarket: 'AE' | 'SA',
  session: LaunchAlertSession,
): LocalMessageParseOutcome;
```

Before parsing, add a module-private envelope-only validator used by the coordinator to
decode all page rows and resolve every exact sender identity without mutating
the ledger or acknowledging IDs. Validate exactly
`v,id,text,sender,observedAt,source`; require
`iosBankSenderIdentity(sender)` again and require its market to equal
`expectedMarket`. The ephemeral decoded envelope never leaves the coordinator
and is nulled after its sanitized outcome is created. After the coordinator proves one page
market and aligns the ledger, it creates one launch session with
`activeMarket: pageMarket` and
`pinnedCurrency: pageMarket === 'AE' ? 'AED' : 'SAR'`. Parsing then calls
`inspect(text, sender)` followed by
`parse(text, sender, inspection, expectedMarket)` so the sender
registry market is both the session pin and parser's `forcedMarket`; derive
`bankHint` from the parser result or `bankFromSender(sender)?.name`; and
destructure both `raw` and `sender` before returning a `ScannedSms` whose
`market` is exactly `identity.market`. Task 1's
tests must require every production alias to map to the same bank ID through
that attribution function. Extract the existing source-free review
admission/identity logic from `auto-import.ts` into exported helpers used by
Android and this parser so the two paths retain identical OTP, promotion,
decline, and review refusal behavior.

Add `declineReconciledCount: number` to `ImportPlan` in `import-plan.ts` and
increment it only for `updates` with `remove: true` that the decline sweep
actually admitted. This source-free planner receipt—not merely seeing a
decline outcome—controls the local milestone.

- [ ] **Step 4: Implement the serialized coordinator and pass the tests**

Expose:

```ts
export interface IosLocalCaptureOutcome {
  scanned: number;
  imported: number;
  reviews: number;
  declined: number;
  ignored: number;
  invalid: number;
  firstCapturedAt: number | null;
  retirement: 'not-needed' | 'complete' | 'retry-needed';
}

export function createIosLocalCaptureCoordinator(input: {
  native: WafraLiveCaptureNativeModule;
  ledger: CaptureLedgerAdapter;
  retireShortcutCapture: () => Promise<'not-needed' | 'complete'>;
}): {
  drain(): Promise<IosLocalCaptureOutcome>;
  retryRetirementIfNeeded(): Promise<'not-needed' | 'complete' | 'retry-needed'>;
};
```

Inside `drain`, join a module-level in-flight promise, purge, then process at
most 40 pages of 50 (the complete 2,000-record capacity), yielding between
pages. Decode and validate every envelope/registry identity before parsing,
ledger mutation, review staging, or acknowledgement. If the page contains both
`AE` and `SA`, throw a source-free market error and leave every page ID queued.
For the single page market, align the ledger first and then parse every row
through one correctly pinned launch session. If that market differs from
`ledger.getState().marketId`,
require `ledger.setMarket` and require it to return true before staging reviews
or building a plan. Re-read `ledger.getState()` immediately before
`buildImportPlan` and use the aligned market state; a missing/refused market
setter leaves the complete page queued.

Await the review receipt and import/ensure durability. A parsed financial
outcome qualifies after that durable boundary even when semantic dedupe creates
no new row. A review qualifies only when `stageReviewAlerts(...).admitted > 0`.
A decline qualifies only when the resulting plan's
`declineReconciledCount > 0`. Call `ensureDurable()` for an all-ignored/invalid
page and for a duplicate-only financial page, call `recordFirstCapturedAt`
only for the earliest qualifying durable outcome, then acknowledge the exact
page IDs. The native milestone preserves the earlier of its existing value
and the new value.

The coordinator alone owns scoped relay retirement. After native
acknowledgement, `drain()` calls its own `retryRetirementIfNeeded()`;
retirement failure returns `retry-needed` and never rejects an already durable
capture. The public retry method checks the native milestone and injected
relay state through `retireShortcutCapture`; no hook or screen may call the
relay client directly.

Run:

```bash
bash scripts/test/build.sh
node scripts/test/ios-capture-setup.test.js
node scripts/test/import-plan.test.js
```

Expected: PASS, including two distinct local event IDs and one relay/local copy producing one ledger row through the existing semantic duplicate guard.

- [ ] **Step 5: Commit the local parser/coordinator if commits are authorized**

```bash
git add src/lib/local-message-record.ts src/lib/ios-local-capture.ts src/lib/auto-import.ts src/lib/import-plan.ts scripts/test/build.sh scripts/test/ios-capture-setup.test.js scripts/test/import-plan.test.js
git commit -m "feat: drain iOS alerts after durable local parsing"
```

---

### Task 5: Scoped Relay Shortcut Retirement

**Files:**
- Modify: `server/schema.sql`
- Create: `server/migrations/2026-08-25-shortcut-ingest-retirement.sql`
- Modify: `server/src/index.ts`
- Modify: `server/README.md`
- Modify: `src/lib/relay.ts`
- Modify: `scripts/test/worker.test.js`
- Modify: `scripts/test/relay.test.js`
- Modify: `scripts/test/db.test.js`

**Interfaces:**
- Consumes: existing admin authentication, ingest authentication, `RelayConfig`, and D1 migrations.
- Produces: idempotent `POST /v1/device/retire-shortcut-capture` and `retireRelayShortcutCapture(config): Promise<void>`.

- [ ] **Step 1: Write failing server and client tests**

Assert that retirement denies only the old Shortcut route:

```js
const retired = await worker.fetch(adminRequest('/v1/device/retire-shortcut-capture', 'POST'), env);
assert.equal(retired.status, 204);
assert.equal((await worker.fetch(ingestRequest('/v1/ingest'), env)).status, 401);
assert.equal((await worker.fetch(emailRequest('/v1/email/ingest'), env)).status, 200);
assert.equal((await worker.fetch(adminRequest('/v1/import/pdf'), env)).status, 200);
assert.equal((await worker.fetch(syncRequest('/v1/sync'), env)).status, 200);
```

Also prove a repeated retirement is 204, queued rows remain syncable, the device remains listed, and `automation_generations` is cleared. Add a deliberately interleaved test that pauses one `/v1/ingest` after token authentication, commits retirement, resumes insertion, and proves the ingest returns 401 with no queue/receipt row.

- [ ] **Step 2: Run focused relay tests and verify failure**

Run:

```bash
bash scripts/test/build.sh
node scripts/test/worker.test.js
node scripts/test/relay.test.js
node scripts/test/db.test.js
```

Expected: FAIL because the route, column, and client method do not exist.

- [ ] **Step 3: Add the D1 scope and idempotent endpoint**

Add this schema field for new databases:

```sql
shortcut_ingest_enabled INTEGER NOT NULL DEFAULT 1 CHECK (shortcut_ingest_enabled IN (0, 1))
```

Create `server/migrations/2026-08-25-shortcut-ingest-retirement.sql` with the
single one-time `ALTER TABLE devices ADD COLUMN ...` for existing D1 databases,
and document a `PRAGMA table_info(devices)` pre/post check in `server/README.md`.
The combined release plan, not this feature task, applies that exact file to
production after resolving the configured D1 binding.

The endpoint must run this batch after admin authentication:

```sql
UPDATE devices SET shortcut_ingest_enabled = 0 WHERE id = ?1;
DELETE FROM automation_generations WHERE device_id = ?1;
DELETE FROM ingest_receipts WHERE device_id = ?1;
DELETE FROM ingest_limits WHERE device_id = ?1;
```

Make `/v1/ingest` authentication return 401 when the field is zero, but do not
rely on that early check for race safety. The queue insert itself must be a
conditional `INSERT ... SELECT` whose `WHERE EXISTS` rereads the authenticated
device ID with `shortcut_ingest_enabled = 1`. Put that insert and any matching
ingest receipt/rate-limit writes in the same D1 batch/transaction and require
the insert result to report one changed row before returning success. If
retirement commits after authentication but before this atomic insert, return
401 and write neither queue nor receipt. If insertion commits first, the row
is an ordinary pre-retirement row and remains syncable. Do not delete the
device, queue, sync token, admin token, email token, push registration,
invites, or vault membership.

Because `queueStructuredRow` also serves email/PDF/CSV, add an explicit
`sourceScope: 'shortcut' | 'supplemental'` option and apply this predicate only
to Shortcut `/v1/ingest`. Every Shortcut queue insert, replay receipt insert,
and ingest-limit upsert uses the same enabled `EXISTS` guard inside the batch;
supplemental callers keep their current behavior. After a zero-change Shortcut
insert, reread the flag: return 401 when retired, otherwise preserve the
existing replay/queue-full response.

- [ ] **Step 4: Implement the client and pass focused tests**

Add:

```ts
export async function retireRelayShortcutCapture(cfg: RelayConfig): Promise<void> {
  const response = await request(`${cfg.baseUrl}/v1/device/retire-shortcut-capture`, {
    method: 'POST',
    token: cfg.adminToken,
  });
  if (response.status !== 204) {
    throw await responseError(response, `Could not retire Shortcut capture (${response.status}).`);
  }
  await updateRelayConfigIfCurrent(cfg, (current) => ({
    ...current,
    shortcutCaptureRetiredAt: Date.now(),
  }));
}
```

Persist `shortcutCaptureRetiredAt?: number` in the existing encrypted relay configuration and make retries safe when the server succeeded but the local write did not.

Run:

```bash
bash scripts/test/build.sh
node scripts/test/worker.test.js
node scripts/test/relay.test.js
node scripts/test/db.test.js
```

Expected: PASS with supplemental relay products unchanged.

- [ ] **Step 5: Commit scoped retirement if commits are authorized**

```bash
git add server/schema.sql server/migrations/2026-08-25-shortcut-ingest-retirement.sql server/src/index.ts server/README.md src/lib/relay.ts scripts/test/worker.test.js scripts/test/relay.test.js scripts/test/db.test.js
git commit -m "feat: retire only legacy Shortcut ingest"
```

---

### Task 6: Foreground Drain, Status, Migration Retry, and Erase Integration

**Files:**
- Modify: `src/hooks/use-auto-import.ts`
- Modify: `src/lib/capture.ts`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/store.tsx`
- Modify: `src/screens/ledger-home-screen.tsx`
- Modify: `src/app/settings.tsx`
- Modify: `src/components/storage-recovery.tsx`
- Modify: `src/lib/i18n.ts`
- Modify: `scripts/test/contracts.test.js`
- Modify: `scripts/test/ios-capture-setup.test.js`

**Interfaces:**
- Consumes: `createIosLocalCaptureCoordinator`, `getCaptureStatus`, `setCaptureEnabled`, and `eraseAll`.
- Produces: local capture status states and automatic launch/foreground drain behavior.

- [ ] **Step 1: Write failing lifecycle and UI-state tests**

Replace relay-only assertions with the closed local state reducer:

```ts
export type CaptureSurfaceState =
  | 'checking'
  | 'first-alert-captured'
  | 'waiting-for-alert'
  | 'needs-automation'
  | 'queue-warning'
  | 'migration-retry'
  | 'off'
  | 'paused'
  | 'unsupported';

resolveIosCaptureSurfaceState({
  enabled: true, setupProofVersion: 1, firstCapturedAt: null, dropped: 0, corrupt: false,
  retirementPending: false,
})
  === 'waiting-for-alert';
resolveIosCaptureSurfaceState({
  enabled: true, setupProofVersion: 1, firstCapturedAt: 1, dropped: 0, corrupt: false,
  retirementPending: false,
})
  === 'first-alert-captured';
resolveIosCaptureSurfaceState({
  enabled: true, setupProofVersion: 1, firstCapturedAt: 1, dropped: 0, corrupt: false,
  retirementPending: true,
})
  === 'migration-retry';
resolveIosCaptureSurfaceState({
  enabled: false, setupProofVersion: null, firstCapturedAt: null, dropped: 0, corrupt: false,
  retirementPending: false,
})
  === 'off';
```

Test hydration gating, launch drain, active-event drain, in-flight joining,
private-mode local capture, disabled status, opt-out disabling native admission
before preference persistence, clearing opt-out without silently re-enabling,
manual-onboarding disable, retirement retry through the coordinator only,
dropped/corrupt warning recovery through an exact opaque warning ID, and Erase
Everything disabling before the native wipe.

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```bash
node scripts/test/ios-capture-setup.test.js
node scripts/test/contracts.test.js
```

Expected: FAIL because `use-auto-import.ts` still derives iOS status only from relay pairing/proof.

- [ ] **Step 3: Mount the coordinator after hydration and on foreground**

Construct one coordinator through the existing `CaptureLedgerAdapter` in
`useAutoImport`. For iOS 16+, invoke `drain()` after `state.hydrated` becomes
true, on `AppState === 'active'`, and inside an explicit refresh before the
supplemental relay executor. On iOS, do not call the relay-backed `routine`
executor when no relay config exists; a successful local drain is a complete
capture attempt, while an existing relay config may still run the supplemental
collector for email/PDF/CSV rows. Update `isCaptureAvailable()` to include the
iOS-16 local module. Local capture must not be blocked by `privateMode`;
`captureOptOut` still blocks both draining and setup status.

The hook never calls `retireRelayShortcutCapture` directly. `drain()` owns the
initial attempt; on each foreground/status refresh the hook invokes only
`coordinator.retryRetirementIfNeeded()`. Continue running relay collection for
email/PDF/CSV queue rows.

- [ ] **Step 4: Render truthful status and include native erase**

Map states to these English meanings and add matching Arabic strings:

```ts
const IOS_CAPTURE_COPY = {
  'needs-automation': 'Finish the one-time Message automation',
  'waiting-for-alert': 'Ready — waiting for the first bank alert',
  'first-alert-captured': 'First bank alert captured locally',
  'queue-warning': 'Some alerts could not be staged; open capture recovery',
  'migration-retry': 'Local capture works; finish retiring the old Shortcut upload',
} as const;
```

Add this source-free durable state and store receipt:

```ts
export interface IosCaptureWarningState {
  dropped: number;
  corrupt: boolean;
  recordedAt: number;
  nativeWarningId: string | null;
}

recordIosCaptureWarning(input: IosCaptureWarningState): { durable: Promise<void> };
```

Ordinary status reads never acknowledge this warning. Settings recovery must
drain the bounded pending queue without a Pro gate, durably record the current
opaque warning ID, compare-and-clear that exact native generation, and durably
clear only matching AppState warning state. It shows only source-free
pending/dropped/corrupt counts. Both ordinary erase and storage-recovery erase
must call `setCaptureEnabled(false)` before app-state cleanup, await
`WafraLiveCapture.eraseAll()`, and clear `IosCaptureWarningState` before
reporting completion. Every path that persists `captureOptOut = true`, plus the
manual-only onboarding choice, must first await `setCaptureEnabled(false)`.
Clearing opt-out never enables admission automatically; Task 7's explicit
automation confirmation is the only enable path. A durable `firstCapturedAt` with no
`shortcutCaptureRetiredAt` resolves to `migration-retry` after a remote failure
and retries on every foreground transition.

Run:

```bash
node scripts/test/ios-capture-setup.test.js
node scripts/test/contracts.test.js
npm run typecheck
```

Expected: PASS; no UI claims that personal automation provenance is verified.

- [ ] **Step 5: Commit lifecycle integration if commits are authorized**

```bash
git add src/hooks/use-auto-import.ts src/lib/capture.ts src/lib/types.ts src/lib/store.tsx src/screens/ledger-home-screen.tsx src/app/settings.tsx src/components/storage-recovery.tsx src/lib/i18n.ts scripts/test/contracts.test.js scripts/test/ios-capture-setup.test.js
git commit -m "feat: run and surface local iOS capture"
```

---

### Task 7: Two-Stage iPhone Setup

**Files:**
- Create: `src/lib/ios-local-capture-protocol.ts`
- Replace: `src/lib/ios-capture-setup.ts`
- Replace: `src/app/ios-setup.tsx`
- Modify: `src/lib/i18n.ts`
- Modify: `scripts/test/ios-capture-setup.test.js`
- Modify: `scripts/test/ios-setup-ux.test.js`
- Modify: `scripts/test/onboarding.test.js`

**Interfaces:**
- Consumes: native capture status, `setCaptureEnabled`, the public capture URL, `Linking`, and `/ios-setup?fromOnboarding=1`.
- Produces: a two-stage controller and exact Shortcut run URL.

- [ ] **Step 1: Rewrite failing controller and static UX tests**

Define and test this model:

```ts
export type IosSetupStage = 'shortcut' | 'automation';
export type IosSetupReadiness = 'not-added' | 'shortcut-proven' | 'first-alert-captured';

export interface IosSetupModel {
  loading: boolean;
  supported: boolean;
  shortcutAvailable: boolean;
  stage: IosSetupStage;
  readiness: IosSetupReadiness;
  opening: boolean;
  failure: 'load' | 'shortcut-install' | 'shortcut-run' | 'shortcuts-missing' | null;
}
```

Tests must prove there are only two stages, no relay pairing/clipboard/token/push permission, the installed test is the exact sentinel, returning from Shortcuts reads native proof, `I added the automation` enables native admission before opening the sentinel run, enable failure prevents the run, manual-only navigation disables first, onboarding routing remains intact, and manual/history paths always remain reachable.

- [ ] **Step 2: Run setup tests and verify failure**

Run:

```bash
node scripts/test/ios-capture-setup.test.js
node scripts/test/ios-setup-ux.test.js
node scripts/test/onboarding.test.js
```

Expected: FAIL because the current controller is the four-step relay setup.

- [ ] **Step 3: Implement the protocol and controller**

Use exact constants and URL construction:

```ts
export const IOS_LOCAL_CAPTURE_SHORTCUT_NAME = 'Wafra Local Capture';
export const IOS_LOCAL_CAPTURE_TEST_SENTINEL = 'WAFRA_LOCAL_CAPTURE_TEST_V1';

export function iosLocalCaptureTestUrl(fromOnboarding = false): string {
  const callback = (result: 'success' | 'cancel' | 'error') =>
    encodeURIComponent(`wafra://ios-setup?shortcutResult=${result}${fromOnboarding ? '&fromOnboarding=1' : ''}`);
  return `shortcuts://x-callback-url/run-shortcut?name=${encodeURIComponent(IOS_LOCAL_CAPTURE_SHORTCUT_NAME)}` +
    `&input=text&text=${encodeURIComponent(IOS_LOCAL_CAPTURE_TEST_SENTINEL)}` +
    `&x-success=${callback('success')}` +
    `&x-cancel=${callback('cancel')}` +
    `&x-error=${callback('error')}`;
}
```

The callback only triggers a status refresh. It cannot set proof itself; readiness changes only when `getCaptureStatus().setupProofVersion === 1`.
When the user explicitly taps **I added the automation**, first await
`setCaptureEnabled(true)` and only then open this run URL. No app launch,
install-page return, proof callback, or opt-out toggle may enable admission
implicitly. Before taking a manual-only onboarding exit, await
`setCaptureEnabled(false)`.

- [ ] **Step 4: Replace the screen and pass UX/accessibility tests**

Render one progress indicator with two segments, one annotated automation screenshot, and exactly these choices: Message, Any Sender, Message Contains empty, Run Immediately, Run Shortcut → Wafra Local Capture, Input → complete Received Message. Do not instruct the user to select Contacts or bank conversations. On unsupported iOS show manual and history options without an install CTA.

Run:

```bash
node scripts/test/ios-capture-setup.test.js
node scripts/test/ios-setup-ux.test.js
node scripts/test/onboarding.test.js
npm run lint
npm run typecheck
```

Expected: PASS in English/Arabic contracts and no truncated primary actions at supported dynamic type sizes.

- [ ] **Step 5: Commit the setup replacement if commits are authorized**

```bash
git add src/lib/ios-local-capture-protocol.ts src/lib/ios-capture-setup.ts src/app/ios-setup.tsx src/lib/i18n.ts scripts/test/ios-capture-setup.test.js scripts/test/ios-setup-ux.test.js scripts/test/onboarding.test.js
git commit -m "feat: simplify iPhone capture setup"
```

---

### Task 8: Exact Credential-Free Capture Shortcut

**Files:**
- Replace: `scripts/build-ios-capture-shortcut.mjs`
- Modify: `scripts/check-ios-shortcut-artifact.sh`
- Replace: `scripts/test/ios-shortcut-artifact.test.js`
- Create: `docs/ios-local-capture-shortcut-source.json`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: the installed Task 3 App Intents and an exact Apple-exported Shortcut graph.
- Produces: deterministic unsigned source, semantic verifier, locally signed artifact, checksum, and a handoff to the combined release plan. It does not publish or configure a public URL.

- [ ] **Step 1: Build/install a native development binary before authoring the graph**

Run:

```bash
npx expo prebuild --platform ios
npx expo run:ios --device
```

Expected: the physical iPhone's Shortcuts action picker lists both Wafra actions. If no physical iPhone is connected, record this task as externally gated; do not synthesize the private App Intent action serialization.

- [ ] **Step 2: Author, export, normalize, and add the failing artifact assertions**

On the physical iPhone, create `Wafra Local Capture` with these branches:

```text
Text input == WAFRA_LOCAL_CAPTURE_TEST_V1 -> Record Wafra capture setup proof -> Stop
Message input -> Sender as Text + Content as Text + Current Date + one invocation UUID
Message input -> Stage Wafra live message(sender, body, eventId, observedAt) -> Stop
all other Text/input -> Stop
```

Export it, inspect it with `shortcuts view`/`plutil`, redact no structural fields, and save the normalized audited source as `docs/ios-local-capture-shortcut-source.json`. Add tests requiring both typed branches and rejecting every URL/network, Files, clipboard, log, analytics, notification, secret, import question, or content-return action.

- [ ] **Step 3: Run the artifact test and verify failure against the old graph**

Run: `node scripts/test/ios-shortcut-artifact.test.js`

Expected: FAIL because the current graph is named `Wafra Capture`, asks for relay credentials, and contains HTTP actions.

- [ ] **Step 4: Implement deterministic build/sign/check and pass tests**

The builder must emit the normalized graph byte-for-byte except for Apple signing metadata. The checker must decode the signed file, restore Apple's record name, compare the complete semantic graph, and reject forbidden identifiers and string payloads.

Run:

```bash
node scripts/build-ios-capture-shortcut.mjs /tmp/WafraLocalCapture.json
node scripts/test/ios-shortcut-artifact.test.js
bash scripts/check-ios-shortcut-artifact.sh /tmp/WafraLocalCapture.json
plutil -convert binary1 -o /tmp/WafraLocalCapture.shortcut /tmp/WafraLocalCapture.json
shortcuts sign --mode anyone --input /tmp/WafraLocalCapture.shortcut --output /tmp/WafraLocalCapture.signed.shortcut
bash scripts/check-ios-shortcut-artifact.sh /tmp/WafraLocalCapture.signed.shortcut
```

Expected: builder, verifier, and signing PASS. Keep signed artifacts under ignored `artifacts/`; do not commit user-specific signing material.

- [ ] **Step 5: Record the exact artifact handoff and commit source/verifier if authorized**

Install the exact signed file on the physical authoring device, confirm its
checksum after export, and record only the ignored artifact path/checksum in
the feature evidence. Do not publish it yet: the combined release plan first
runs the full local/history physical matrix and then publishes the exact tested
files from the owning Apple account. A source file, simulator, signed local
file, or EAS build cannot create an iCloud share URL.

```bash
git add .gitignore docs/ios-local-capture-shortcut-source.json scripts/build-ios-capture-shortcut.mjs scripts/check-ios-shortcut-artifact.sh scripts/test/ios-shortcut-artifact.test.js
git commit -m "feat: define credential-free capture Shortcut source"
```

---

### Task 9: Feature Verification and Combined-Release Handoff

**Files:**
- Create: `docs/test-evidence/ios-local-capture-implementation-2026-08-25.md`
- Modify only on discovered failure: files owned by Tasks 1–8.

**Interfaces:**
- Consumes: Tasks 0–8, including the checked signed artifact and scoped relay implementation.
- Produces: independently reviewed feature evidence and an explicit handoff to the combined release plan; no production deploy, public URL, EAS edit, or TestFlight submission.

- [ ] **Step 1: Run feature-level verification**

Run:

```bash
npm run typecheck
npm run lint
npm test
npm run check
bash scripts/test/native-live-capture-store.sh
node scripts/test/ios-capture-setup.test.js
node scripts/test/ios-shortcut-artifact.test.js
git diff --check
```

Expected: every command exits 0. Review the complete task diff and confirm
that shared release files (`eas.json`, legal/store/landing copy, and TestFlight
scripts) were not changed by this plan.

- [ ] **Step 2: Obtain independent read-only review**

Give the reviewer the local spec, this plan, exact graph, and complete
feature diff. Require explicit findings for disabled admission races, queue
loss, acknowledgement-before-durable, forced-market/setMarket behavior, mixed
markets, sender overmatch, raw-text leakage, App Intent availability/resource
bundling, milestone qualification, atomic relay retirement, erase coverage,
and misleading setup copy. Resolve every P0/P1 finding and rerun Step 1.

- [ ] **Step 3: Record a source-free handoff**

Record command results, the ignored signed-artifact path and checksum, the
physical feasibility result from Task 0, unresolved physical-device cases,
and the exact uncommitted/committed task paths. Do not record Message text,
sender labels, tokens, signing material, invented iCloud URLs, or a claim that
the production migration/build was submitted.

- [ ] **Step 4: Continue only through the combined release plan**

Verify History Import Tasks 1–5 have their own passing handoff, then execute:

```text
docs/superpowers/plans/2026-08-25-ios-shortcuts-release.md
```

Expected: that plan is the sole owner of physical release matrices, sender
evidence admission, both iCloud publications, shared release configuration and
copy, D1/Worker deployment, and the one iOS/TestFlight submission.

- [ ] **Step 5: Commit evidence only if commits are authorized**

```bash
git add docs/test-evidence/ios-local-capture-implementation-2026-08-25.md
git commit -m "test: verify iOS local capture implementation"
```
