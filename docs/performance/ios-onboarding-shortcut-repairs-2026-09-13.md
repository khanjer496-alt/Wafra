# iOS onboarding and Shortcut repairs after the build 127 device report

Date: 13 September 2026.

## What the device report said

Build 127 (TestFlight, public beta) on a physical iPhone:

1. The Message automation step told the user to pick the bank sender, but
   Apple's Sender picker lists Contacts only. Bank SMS IDs (`ADCB`,
   `Emirates NBD`, shortcodes) are not Contacts, so the step could not be
   completed as written.
2. The History Shortcut stopped on its first page with Apple's alert
   "History paused safely … Reason: invalid-input", then opened Wafra at
   `wafra://ios-setup?section=history`, where nothing about the paused import
   was visible.
3. Back from that screen bounced through the onboarding gate's redirect
   several times before the manual path became reachable.
4. After the manual exit, Home flickered and behaved erratically.

## Findings

### The first Shortcut works; the automation guidance was wrong

`WafraLocalCapture` (`9a85d5f8…`) accepts the full received Message from any
sender. `StageWafraLiveMessageIntent` and `WafraLiveCaptureStore.stage` do not
filter by sender; the JavaScript drain parses each queued record and discards
anything that is not a supported bank alert. Nothing in the pipeline needs a
sender-scoped trigger.

The one-page onboarding plan (3 September) had deliberately required "bank
senders the user selects". That requirement is not satisfiable on iOS: the
Message automation's Sender picker only offers Contacts. The guidance now
tells the user to leave **Sender** and **Message Contains** empty, so the
automation runs for every new message and Wafra keeps only bank alerts on the
iPhone. The privacy copy states this plainly. `isSupportedIosMessageAutomationTrigger`
accepts zero selected senders (the guided configuration) and still rejects a
"Message Contains" keyword filter, which would silently drop alerts.

Creating a fake Contact for a bank sender ID remains wrong and is not offered.

### `invalid-input` on the paged History Shortcut

Production installs the paged record `5a0da9b5…` (installed name
`Wafra-History-v2-typed-date.signed`). The alert text comes from
`StageWafraPagedImportIntent` returning `{status: "blocked", reason}`. Begin
succeeded on the device (a Begin failure throws a Shortcuts error instead of
showing this alert), and the cursor-date intent parsed the same request JSON,
so the refusal came from `WafraPagedHistoryStore.stage` on the first page:
the frame's line count disagreeing with the page count, a field that was not
canonical Base64/UTF-8, a date outside the producer's instant format, or a
body over 16 KiB / sender over 1 KiB.

Which of those it was cannot be determined from this host. Two changes make
the next device run conclusive and remove the one whole-import blocker that
is not a transport bug:

- The store now names the failing check: `invalid-input-lines`,
  `invalid-input-field`, `invalid-input-date`. The Shortcut shows `reason`
  verbatim in its "History paused safely" alert, so no Shortcut republish is
  needed to read it. `invalid-input` alone now means the request JSON or
  parameters were malformed. The Begin intent's Shortcuts error also carries
  the store's reason code.
- A Message whose body exceeds 16 KiB, or whose sender exceeds 1 KiB, is
  staged as a skipped row (identity and date kept, no record) instead of
  refusing the page. Bank alerts are short; the parser could never have used
  such a Message, and refusing the page blocked every page behind it with no
  way past.

The v2 Shortcut graph is unchanged (its generator output is byte-identical).

### The paged Shortcut ran against the legacy history UI

`pagedHistoryEnabled()` followed `EXPO_PUBLIC_WAFRA_PAGED_HISTORY_BETA`, which
the production profile does not set. So a production user ran the paged graph
while `ios-setup`, `import-sms` and the paging screen all treated history as
the retired per-message design: no saved-page counts, "Continue" reopening
Shortcuts blind, and the review screen not recognising a `PAGED-` session.
The paged surfaces now follow the record the build installs; the flag only
widens them to builds testing an unverified URL. `ios-setup` reads
`getPagedStatus` on refresh and shows checked/readable/skipped counts with
Resume or Review, which is what "Open Wafra to check progress" now lands on.

### The Back loop

The Shortcut's return URL `wafra://ios-setup?section=history` cannot carry
`fromOnboarding=1`, and a deep link into the mounted route replaces its
params. The screen then believed it was a Settings visit: it hid the manual
exit, and Back popped to `/`, where the onboarding gate saw
`returnToOnboarding` and redirected straight back to `/ios-setup`, through a
loading splash each time. First-run state is durable in the store, so the
screen now latches onboarding mode from `state.onboarded === false` for its
whole lifetime, whatever the params say.

### The Home flicker

`router.replace('/')` from the pushed `ios-setup` screen targets the root
stack, and React Navigation's `REPLACE` swaps the focused route for a **new**
`(tabs)` route while the original `(tabs)` route is still the stack root. Two
tab navigators end up mounted: two Home screens, doubled foreground scans,
reveal animations replaying. Exits from `ios-setup` now pop to the existing
root (`dismissAll`) and switch tabs there; a cold deep-link launch with no root
beneath keeps the replace. The paging screen's Back uses `dismissTo` for the
same reason.

## Build 135 device result (same day)

Build 135 shipped the named refusals. On the owner's iPhone the History
Shortcut's first page (51 Messages, plus the two boundary rows) was refused
with `invalid-input-lines`: the frame's newline-separated line count did not
equal the 51 Messages found. Bank alert bodies are long, so the Base64 body
field was arriving wrapped onto several transport lines even though the
graph configures Base64 Encode with no line breaks; short OTP rows were fine.

The store no longer trusts line breaks. `frameRecords` splits the frame on
any whitespace and reassembles records by their three `|` separators, which
Base64 can never contain, so a wrapped field is rejoined exactly and a
record ends precisely at its date field. Records that run together with no
separator, or a dangling partial record, are still refused, and the reason
now carries the observed counts (`fragments`, `separators`, `records`,
`found`) so the next alert, if any, identifies the shape directly. The
Shortcut graph is unchanged; only the app build changes.

## Build 137 device result and the root cause (14 September)

Build 137 refused the same first page with
`invalid-input-lines fragments=0 separators=0 records=0 partial=0 found=51`:
Shortcuts found 51 Messages and handed Wafra an **empty** frame. That rules
out wrapping, encoding and the native reader. It also re-explains the earlier
alerts: the dictionary-framed graph's `invalid-input` and build 135's
`invalid-input-lines` were the same empty frame, read by less specific checks.

The cause is one parameter key in the generator. Apple's Combine Text action
(`is.workflow.actions.text.combine`) takes its input under the key `text`,
not `WFInput`. Every Combine Text in `scripts/build-ios-paged-history-shortcut.mjs`
(the v2 frame, the v3 column joins) and in the column probe used `WFInput`.
Shortcuts ignores an unknown key and gives the action the previous action's
output instead. In the v2 graph the previous action is the end of the
per-message Repeat, whose results are empty because the loop body ends with
Nothing, so the frame was always empty. Split Text, whose key the probe
already had right, uses the same `text` key; the other actions in the graph
(Base64 Encode, Add to Variable, Set Variable, Repeat, Get Item, Dictionary
Value) do take `WFInput`, and every one of those has behaved on the device.

The repair is the key: `text: attachment(variable('Encoded Page'))`. The graph
keeps its 98 actions and every other identifier and parameter. A test now
fails any Combine or Split Text that binds `WFInput` or omits `text`.

The published record `5a0da9b5…` still carries the broken key, and this host
cannot sign or publish a Shortcut. `.github/workflows/ios-sign-history-shortcut.yml`
generates the repaired graph from an exact main commit on a macOS runner,
verifies it against the generator, converts it and signs it with
`shortcuts sign --mode anyone`, and stores it as a workflow artifact and a
prerelease asset under the file name `Wafra-History-v2-typed-date.signed.shortcut`.
Apple installs a signed file under its basename, which is the name build 137
already runs, so a phone can delete the installed Shortcut, open the signed
file, and test the repaired graph without a new app build. Once a page imports
on the phone, the Shortcut is published to iCloud from that phone, and the new
record ID replaces `5a0da9b5…` in `IOS_HISTORY_SHORTCUT_INSTALLED_RECORDS`,
`ios-paged-setup.ts`, `scripts/release/ios-public-shortcut-check.mjs` and
`eas.json`, followed by an app build. Until then the public record check
reports a mismatch for the history record, which is the truthful state.

## Verification

| Check | Result |
| --- | --- |
| `tsc --noEmit` | passed |
| ESLint on changed files | passed |
| `scripts/test/ios-setup-ux.test.js` | 274 passed |
| `scripts/test/onboarding.test.js` | 98 passed |
| `scripts/test/contracts.test.js` | passed |
| `node --test scripts/test/ios-journey/*.test.cjs ios-paging-shortcut.test.mjs ios-paging-loader.test.cjs` | 154 passed (13 Sep); `ios-paging-shortcut.test.mjs` 18 passed after the Combine Text key repair |
| `scripts/test/ios-capture-setup.test.js` | trigger-guard assertions pass; two later assertions need the prebuilt `ios/Wafra.xcodeproj` and fail on this host without it (unchanged by this work) |
| Native paged store (`bash scripts/test/ios-history-paging.sh`) | **not executed here — no `swiftc` on this Linux host.** New checks added for the oversize-body skip and the three named refusals. Run on a Mac before any build. |
| Physical iPhone | **not tested.** The automation guidance, the Back path, the Home exit and the alert reason all need one device run on the next build. |

Nothing here is evidence that the History import completes on a phone. The
next device run either completes the first page or names the failing check.
