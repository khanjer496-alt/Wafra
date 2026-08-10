# Wafra Capture v2 — designated iPhone verifier

You are the only verifier for this Shortcut version. Do not send anyone your
Wafra setup code, bank message, phone number or card details. The result report
at the bottom contains none of them.

## Prepare the sender-aware Shortcut

1. Build a fresh Shortcut named `Wafra Capture v2`. Do not duplicate or
   reinstall `85bd1e080e5849b591049eccffb9a3a1`: its Get File action uses
   Shortcut Input as a directory and produces Apple's “Invalid file path”
   error during Wafra's text test.
2. Follow `docs/ios-shortcut-build.md`, including the setup import question.
   The new graph must have no Get File, Save File, Move File or Folder action.
3. In Details, accept **Messages** and **Text**, nothing else. Keep **Show in
   Share Sheet** off.
4. Replace the existing plain `Text → Shortcut Input` read with this branch:
   - If `Shortcut Input` is **Text**, set variable `text` to `Shortcut Input`.
   - Otherwise, get **Content** from the received Message and set variable
     `text` to it.
   - Then get **Sender** from that Message, pass Sender through an explicit
     **Text** action, and set variable `sender` to that Text result.
5. Generate a UUID as `eventId` before the HTTP action.
6. In the HTTP JSON body, send `text`, `sender` and `eventId`. Do not add a
   result preview, alert, clipboard action or logging action.

The complete tap-by-tap graph is in `docs/ios-shortcut-build.md`. The explicit
Text conversion is mandatory. A raw Contact object cannot identify the bank.

## Pair and prove the pipe

1. Install the latest Wafra TestFlight build and open **Settings → iPhone
   capture**.
2. Copy the setup code and paste it only into the import question on your local
   Shortcut when asked.
3. Run the Shortcut manually with `WAFRA_CAPTURE_TEST_V1`.
4. Wafra must advance to **pipe ready**. This proves only Shortcut → relay →
   encrypted queue → app.

## Create the personal automation

1. Shortcuts → Automation → **Message** → **Sender**.
2. Select the existing conversation for one supported bank. Do not use a broad
   “Message Contains AED” rule.
3. Choose **Run Immediately**.
4. Add **Run Shortcut → Wafra Capture v2** and pass the complete **Messages**
   variable—not only its Content—as Shortcut Input.

## Prove a real alert

1. Close Wafra and lock the phone.
2. Let one genuine transaction alert arrive from the selected bank.
3. Enable airplane mode before opening Wafra.
4. Confirm the transaction is already present and assigned to the correct
   named bank/card. “The transaction arrived” is not enough.
5. Repeat after reboot plus first unlock.
6. Repeat after force-quitting Wafra and record what recovery was needed.
7. If the phone has Liv and Emirates NBD cards sharing the same last four
   digits, confirm the alert lands on the correct one.

## Publish and report

Rename the verified Shortcut to `Wafra Capture`. Verify its shared graph
contains exactly one setup import question and no file/folder action, literal
setup code, token, relay URL, phone number, bank name or message.
Then Share → **Copy iCloud Link** and report only:

```text
iOS version:
Bank label received (for example ADCB or EmiratesNBD):
Pipe test: pass/fail
Locked + airplane-mode test: pass/fail
Correct named bank/card: pass/fail
After reboot: pass/fail
After force-quit: pass/fail; recovery required:
Wafra Capture v2 iCloud link:
```

Do not include the bank message, amount, card digits or Wafra setup code.
