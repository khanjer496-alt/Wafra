# Shortcut setup and history recovery rebuild

This is a replacement for the failed build-160 setup/history experience. Build 160 remains the previously published binary until this source is built and distributed.

## What the device evidence establishes

The reported history run had 1,299 checked messages, 1,296 readable and three skipped. Its next page contained a row 75.113 seconds newer than its strict cursor. Native validation rejected the page before advancing the cursor. Repeating the same v6 request could repeat the failure indefinitely. This is not the v7 initial age-band boundary issue.

The setup photo establishes a failed Shortcut return and an unhelpful recovery loop. The exact Apple setup error is still unavailable. A separate concrete defect was reproduced: the old capture graph compared Get Type to English `Text`, while Apple's localized type names differ.

## Replacement flow

- Bundle Apple-signed **Wafra Capture v3** and **Wafra History v8** with the app, using fixed native local-resource getters and exact installed/run names. Existing binaries retain legacy URL behavior.
- Capture v3 compares input type with the type of a known Text action on the same device, fixing both locale-sensitive comparisons while retaining the existing financial capture paths. Its nonfinancial connection check invokes a distinct v3 AppIntent and records proof version 3. Old proof or an old captured alert cannot satisfy the new check.
- Versioned installation confirmation starts the connection check immediately. The failed step displays the exact Shortcut name, a direct reinstall action and explicit retry; permission detail is in Help. An already-open automation guide cannot hide the error. Existing automations can be opened for editing to avoid encouraging a second automation.
- History v8 includes the v7 probe-boundary overlap and retries a rejected column page once using the same fetched messages, request capability and revision through typed-row extraction. Authorization/storage failures are not retried as date failures. Native date and completeness checks remain unchanged.
- If typed extraction still fails validation, the graph stops and returns a source-free failure reason. Wafra retains a session/count marker so foreground refresh or reopening cannot silently turn the failed page back into an ordinary Resume action. Explicit one-page retry retains the block until native progress advances. Statement import and return to setup remain available. No saved session or ledger is automatically discarded.

## Verification

- Capture v3 graph traces cover English, Arabic and French type labels, setup-only proof, ordinary text, typed Message and no-input recovery. Published v2 is byte-identical.
- History graph tests preserve v2-v7 byte identities and execute same-page typed recovery and persistent refusal. Native replay recreates the reported cursor/revision/counts, preserves all old journal bytes after refusal, advances exactly once after valid typed recovery and refuses repeated invalid rows. **456 native paging checks passed.**
- Native capture: **156 store, 79 bridge, 105 resource checks**, plus Debug/Release AppIntent typechecks, passed. The full app build must also validate extracted v3 intent metadata.
- Root focused setup/graph/journey checks passed; exact final snapshot and broader results are recorded separately during publication.
- Independent review required distinct v3 proof and failed-check precedence over an open automation guide; both were fixed and reviewed.

Signing evidence is local under `ios-release-evidence/shortcut-rebuild-20260923/v3-proof/metadata.json`. Signed resources and executable tests live in normal source paths. Only fixed Shortcut files are shared; no bank messages, sender values, financial input or arbitrary error text are embedded in the recovery URLs.

## Proof limits

The phone was paired and visible to CoreDevice, but iPhone Mirroring could not connect. No physical execution of the replacement Shortcuts is claimed. Typed fallback distinguishes column representation problems from a persistent Apple query/date disagreement; it is not a promise that every inbox will complete. Saved pages still have the existing 24-hour lifetime.

Apple Pay/Wallet-specific capture is not implemented by this rebuild. Build 160's general iOS 27 notification receiver remains separate from a dedicated Wallet Transaction-trigger adapter.

## 2026-09-24 update: Capture v3 Message fields

Superseding the Capture v3 notes above. On iOS 26.1 the automation's Message input exposes Content and Sender (no Date, GUID not listed) and Find Messages rows expose Body, GUID and date (no Content or Sender).

- Capture v3 (36 actions, re-signed `anyone`, 25515 bytes, SHA-256 `d812d2d0…6796`) stages the live Message with SHA-256(GUID) and the Message date only when both have a value; otherwise it stages Sender and Content without an identity and the app assigns a queue UUID and the receipt time. Empty Content stops quietly.
- Capture v3 has no Find Messages lane: a no-input run records the v3 setup proof and stops. Explicit History import is the recovery path, and the app no longer opens either Capture Shortcut's no-input lane on refresh.
- `StageWafraLiveMessageIntent` now takes four optional parameters. Published v2 remains byte-identical, but on this binary its complete, current inputs stage as before, its empty-GUID/no-date live input stages a UUID row instead of failing, and its no-input rows (blank Content) are ignored instead of stopping the run.
- Queue-UUID Message rows carry no history identity, so the ledger's same-event rule pairs them with the History import copy of the same Message.
- Not proven on a physical iPhone: whether Shortcuts passes the omitted/empty optional parameters as nil, and whether "has any value" on the Message input's GUID/date properties evaluates false as the trace assumes.
