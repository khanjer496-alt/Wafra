# iOS native parser integration implementation plan

> For agentic workers: use subagent-driven-development with narrow independent ownership, then independent task and integrated review.

**Goal:** Replace the separate iOS preview interpretation with the shared on-device parser while preserving queued receipts and ledger protections.
**Architecture:** A pure TypeScript adapter emits a scalar notification contract. A deterministic direct-source generator packages it, Swift JavaScriptCore evaluates it without host bindings, and protected native settings gate emission.
**Tech stack:** Expo SDK 55, TypeScript, Swift Foundation/JavaScriptCore/CryptoKit, existing native module and resource bundle.
**Spec:** `docs/superpowers/specs/2026-10-14-ios-native-parser-integration-design.md`.

## Authorization and rulings

Owner approved design and autonomous planning/execution. No additional design prompts are required. Commits, pushes, deployment, submission and installation are not authorized; omit skill commit steps. Preserve both dirty canonical and candidate histories. Execute in existing candidate, then mirror only reviewed narrow deltas to canonical.

## Global constraints

- No cloud SMS, AI/native host bindings, ledger/key access, second ledger writer or weaker key protection.
- Native input preview limit 4 KiB body, 80 UTF-16 sender, 2 KiB result; closure at most 64 modules and resource at most 2 MiB.
- Two-second result deadline is not an execution kill; preserve queued receipts on any failure or late result.
- Original currency and true original minor units/exponent; no converted ledger estimate or legacy foreign-cent fallback.
- Queue bytes, staging IDs and acknowledgement ownership remain unchanged.
- Missing context/resources or hash mismatch disables preview only.

## Review focus

- Domestic amounts without original fields still produce valid movement previews.
- JOD/JPY originals and missing FX retain correct units or Review, never disappear as non-bank messages.
- Malformed old manifest snapshots cannot corrupt or block real receipts.
- Changed country, capture consent, entitlement, alert setting or source hash cannot emit stale results.
- Long/pathological input, missing resource, invalid result and OTA mismatch stay quiet without losing receipt data.

## Frozen interfaces

`NativeParserContext` JSON: `{v:1,country:string|null,parserMarket:'AE'|'SA'|'ZZ',ledgerMoney:{currency:string,exponent:0|2|3}|null,sourceHash:string}`.
`NativeParserInput`: `{v:1,context:NativeParserContext,sender:string,body:string,observedAt:number}`.
Export pure `parseIosBackgroundAlert(input: NativeParserInput): NativeParserResult`.
Bundle function `globalThis.wafraNativeAlertParse(inputJson: string): string` uses JSON parsing/stringifying only.
`NativeParserResult`: `{v:1,parserVersion:number,route:'parsed'|'review'|'ignore',provenance:'launch'|'unverified'|null,notification:null|{style:'movement'|'review',family:'purchase'|'transfer'|'refund'|'cash-withdrawal'|'fee'|'utility'|'recurring-payment'|'income',direction:'debit'|'credit',amount:{currency:string,minorUnits:string,exponent:0|2|3},merchant:string|null,instrument:{kind:'card'|'account'|'wallet',last4:string|null}|null}}`.
Use income only for received-money wording, never a claim of net income/account ownership.
Resources: `WafraBackgroundParser.js` and `WafraBackgroundParser.meta.json`.
Metadata: `{v:1,parserVersion,sourceHash,bundleSha256,moduleCount,currencies:Record<string,0|2|3>,countries:string[]}`.
Generated foreground constant: `src/lib/ios-background-parser-source.generated.ts` exports `IOS_BACKGROUND_PARSER_SOURCE_HASH`.
Swift `WafraNativeParserContext: Codable, Equatable, Sendable` owns same context fields and validated JSON initializer. Root owns this type.
Store APIs: `setNativeParserContext(_ serialized:String?) throws`, `nativeParserContextSnapshot() throws -> WafraNativeParserContext?`, `mayEmitParserPreview(context:WafraNativeParserContext) throws -> Bool`.
Swift runtime `WafraBackgroundAlertParser.read(sender:String?,body:String,observedAt:Date,context:WafraNativeParserContext) async -> WafraNativeAlertNotification?`.
Root exposes optional bridge `setNativeParserContext(serialized:string|null): Promise<void>`.

### Task 1: Pure source adapter

Files: create `src/lib/ios-background-alert-parser.ts` and `scripts/test/repair/ios-background-alert-parser.test.cjs`.
- [x] Add failing source-loaded tests for domestic AED, foreign USD on AED, JOD3/JPY0, missing FX, personal/OTP/future/negated refusal, Review and sender placeholders.
```js
assert.equal(parseIosBackgroundAlert(foreignUsd).notification.amount.currency, 'USD');
assert.equal(parseIosBackgroundAlert(foreignUsd).notification.amount.minorUnits, '2486');
assert.equal(parseIosBackgroundAlert(personal).notification, null);
```
- [x] Implement input/context validation, reset parser globals per call, bestEffort=false, guarded parser/Review seam, source money validation and bounded scalar-only output.
- [x] Assert no raw/reference/balance/category/FX/owner fields in serialization; contexts never repin ledger to force parsing.
- [x] Run focused source tests, lint and independent review.

### Task 2: Shipping generation and upgrade compatibility

Files: generator, generated resources/foreground hash, `fingerprint.config.js`, current CI/iOS workflows, update checker and generator tests. No package/lock changes.
- [x] Add failing generator tests for closure external/stub rejection, deterministic output and stale `--check`.
```js
assert.equal(runGenerator('--check').status, 0);
assert.match(bundle, /wafraNativeAlertParse/);
assert.equal(meta.bundleSha256, sha256(bundle));
```
- [x] Traverse actual source imports, erase type-only dependencies, compile with pinned TypeScript to CommonJS factories; enforce closure/byte limits and forbid externals.
- [x] Emit named resources/metadata/foreground hash; include metadata/resource in native fingerprint and prove changing source changes fingerprint.
- [x] Generate before prebuild/pods in current workflows; native filter watches source closure. Existing update checks reject stale resource/hash.
- [x] Verify packaged resource metadata/hash in current IPA validation route. Run generator/fingerprint/workflow/update tests and independent review.

### Task 3: Protected native context and foreground synchronization

Files: new Swift context type, store/module/types, `src/lib/ios-native-parser-context.ts`, foreground capture hook, native and source tests.
- [x] Add failing native tests for valid context, missing/bad old manifest snapshot, mismatch, expiry/opt-out/alerts and exact receipt-byte preservation.
```swift
precondition(try store.nativeParserContextSnapshot() == expected)
precondition(try store.mayEmitParserPreview(context: stale) == false)
```
- [x] Codable optional manifest snapshot uses tolerant validated decode; setter invalid input clears snapshot only. Never alter stored record schema/digest.
- [x] Snapshot read/emission gate compares all context fields and reads capture consent, entitlement and alerts under manifest lock.
- [x] Optional bridge and serialized foreground synchronizer prevent late writes from replacing newer settings. Country/ledger preference changes clear/update context; older binaries remain usable.
- [x] Run bridge/migration/context/hook tests and independent review.

### Task 4: Swift runtime and Wafra notification seam

Files: new runtime Swift, resource helper, instant alert Swift, podspec, EN/AR strings and dedicated actual-native tests.
- [x] Write native tests that use actual generated resource for original currency, Review style, invalid resources/metadata/output, context mismatch, long/busy/late calls and no host bindings.
- [x] Fresh off-main JSContext per admitted call, serial busy gate, optional bundle resolution, CryptoKit resource SHA, scalar validation, two-second result deadline/cancellation checks.
- [x] Replace iOS preview decision with shared runtime; queue first, no weak-reader fallback. Integer money formatter preserves 0/2/3 decimals.
- [x] Native emission rechecks store/context and OS permission; movement vs Review and transfer sent/received localized keys, stable body hash identifier.
- [x] Run actual Swift runtime/native reader/resource checks and independent review.

### Task 5: Integrated candidate validation and handoff

Files: explicit Swift test compiler lists/run gate, source-module test build list for new adapter/context helpers, current evidence docs/receipts.
- [x] Refresh normal production-module test build once all source tasks finish.
- [x] Run fresh app/server typechecks, scoped lint, affected full native/TS suites, existing universal and capture suites.
- [x] Run integrated stage+runtime+gate controls; verify payload/storage bytes unchanged across retries and preference changes.
- [x] Obtain independent final read-only review; resolve monetary/privacy/replay findings with focused regressions.
- [x] Mirror finished narrow edits without overwriting upstream-only fields. Record local component/build evidence and separate pending signed artifact/physical phone/Apple banner gates. No publication or install.


Implementation tasks are complete. Full whole-app/signed/physical release gates remain open and are recorded in `docs/test-evidence/2026-10-14-ios-native-parser-integration.md`; these task checkboxes do not mark the launch goal complete.
