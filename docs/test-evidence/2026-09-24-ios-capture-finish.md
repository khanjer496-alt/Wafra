# iOS capture, history and setup review fixes · 24 September 2026

Branch `claude/ios-capture-finish-20260924`. It finishes the uncommitted Codex work from 23 September and fixes the findings of an end-to-end review. The review covered onboarding, the bundled Shortcuts, History import, new-alert capture and statement import.

## Integrated work

- **Codex, committed as-is.** The Capture v3 / History v8 rebuild ([2026-09-23-shortcut-flow-rebuild.md](2026-09-23-shortcut-flow-rebuild.md)), the screen polish and Transfers view ([../design/2026-09-23-screen-polish.md](../design/2026-09-23-screen-polish.md)), and Apple Pay capture. Setup no longer asks for the user's banks.
- **Merged from origin/main.** #101 (re-posted notification dedupe) and #103 (onboarding logo tile).

## Review findings fixed

### Capture v3 Shortcut

Device probes recorded in this repo show two things:
- The automation's Message input exposes Content, Name, Recipients and Sender, but not Date or GUID.
- Find Messages rows expose Body, GUID and date, but not Content or Sender.

The live lane therefore stages GUID and date only when they have a value. Otherwise it stages Sender and Content under a fresh id with the receipt time.

The no-input run now records the v3 setup proof only. The app no longer opens the catch-up lane for v3 or v2. Explicit History import is the recovery path.

Live rows without a GUID carry a message-observation marker. Two consequences:
- Two genuine identical purchases stay two rows.
- A History copy binds one-to-one to its live row, including after a title edit.

Capture v2's bytes are unchanged, but its behaviour on this binary differs. A live input with no GUID now stages instead of failing, and its no-input rows are ignored.

### History v8

- A page is blocked only for genuine date or overlap refusals. Lock, storage, authorization and stale failures resume normally.
- "Messages changed" offers Start over.
- Unreadable staging offers Erase.
- An expired session is treated as no session.
- Blank-GUID identity is aligned between the column and typed-row paths.
- The block key includes the revision.
- The import screen names "Wafra History v8".

### Setup flow

- Each capture source keeps its own progress. Viewing Apple Pay or notification setup no longer erases a finished SMS setup.
- A setup proof counts only if it is newer than the install or check that asked for it.
- v2 users see a single "Update to Wafra Capture v3" card instead of a silent downgrade.
- "Open Shortcuts" is the primary action.
- "Finish setup" is available once new-alert capture is configured. History is optional, and hidden below iOS 26.
- One name for the setup check, and a message when a check is stopped. VoiceOver reads each row's status once. The setup check runs automatically after the Shortcuts share sheet returns.
- Happy path: 4 taps inside Wafra, down from 6.

### Alert queue

A conflicting-currency record no longer switches the market. A purchase in another currency becomes a durable Review item, which is refused for posting. Nothing money-moving is acknowledged without a record the user can see.

When Review is full:
- Informational reviews never block capture.
- Possible money movements wait in the native queue and are not acknowledged.
- Review shows how many alerts are waiting.

Expired queue records count as dropped. Pending reviews show how long they have left and how many expired.

### Apple Pay versus SMS

Automatic binding still requires strict one-to-one proof. A near match asks the user in both directions: same account and amount within ±10 minutes, but a different merchant descriptor or a later SMS. An explicit "Add as a separate purchase" confirmation posts a genuine second purchase exactly once.

### Test harness

`native-live-queue-signal.sh` compiles the shared resource helper again. It had been broken since the notification getter landed.

## Verification (local, macOS)

- `tsc --noEmit` is clean.
- The full JS suite (`scripts/test/run.sh` minus the Darwin native block) exits 0.
- Native host suites:
  - History store: 394 checks.
  - Paged history: 471 checks.
  - Live capture store: 230 checks.
  - Bridge: 99 checks.
  - Resources: 156 checks.
  - Queue signal: 16 checks.
- The full app `xcodebuild` and App Intents metadata extraction were not run locally, because the disk was nearly full. They run in CI's macOS job.
- Capture v3 and History v8 were re-signed with `shortcuts sign --mode anyone`. Apple validated both signatures. The signed payloads match their builders.

## Known limits (not fixed here)

- **A bank SMS near-matching an already posted Wallet row still posts separately without a prompt.** The duplicate is visible, not silent. Routing it to Review would need every capture collector to stage planner near-matches.
- **Foreign-currency purchases can fill Review.** If 50 or more are left unresolved and a full queue page holds only such rows, capture behind them waits until the user dismisses some.
- **Manual rows without a clock are not compared** by the Apple Pay duplicate prompt.
- **Statement import has separate, older defects.** These include card-statement signs and statement-versus-alert duplicates. They are tracked as a follow-up task.

## Not proven without a physical iPhone

- A real bank SMS delivered through the Message automation.
- How "has any value" treats an absent GUID or date on the Message input.
- Whether an optional intent parameter left unset arrives as nil.
- Running the re-signed History v8 end to end, including lock mid-run and Messages roll-off.
- The iOS 27 notification trigger.
- A Wallet transaction reaching Apple Pay v1 with its amount intact.

No coverage claim here depends on these.
