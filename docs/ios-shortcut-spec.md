# Wafra Capture — publishable Shortcut specification

This is the source-of-truth action graph for the credential-free iCloud
Shortcut referenced by `EXPO_PUBLIC_WAFRA_SHORTCUT_URL`. The published Shortcut
must contain no Wafra server URL, bearer token, device identifier, bank name or
user data. Pairing supplies a versioned one-paste JSON value:

```json
{"v":1,"url":"https://<relay>/v1/ingest","token":"<device ingest bearer>"}
```

## Action graph

1. Accept **Messages** and **Text** as `Shortcut Input`. The intended personal
   automation passes the whole Message object so the graph can try to extract
   its sender. Text stays accepted so the manual setup test below still runs.
2. Look for `Shortcuts/Wafra Capture/config.json` in iCloud Drive.
3. If the file does not exist:
   1. Ask for Text with “Paste the setup code from Wafra”.
   2. Get Dictionary from the supplied text.
   3. Require `v` to equal `1`, `url` to be an HTTPS URL ending in
      `/v1/ingest`, and `token` to be non-empty. Stop with an error otherwise.
   4. Save the original dictionary as
      `Shortcuts/Wafra Capture/config.json`, overwriting only after the user
      confirms a new setup code.
   5. Show “Wafra Capture is ready” and stop. Do not send the setup code.
4. Get Dictionary from the saved config file.
5. Branch on the type of `Shortcut Input` before reading Message details:
   - For **Text**, set `text` to `Shortcut Input` and leave `sender` absent.
   - For **Messages**, get detail **Content** as `text`; get detail **Sender**,
     explicitly convert that result to plain **Text**, and set it as `sender`.
     Do not rely on JSON coercion of a Contact or participant object.
6. Require non-empty `text`; stop without a request when it is empty.
7. Generate a UUID as `eventId`.
8. Get Contents of URL using the saved `url`:
   - Method: `POST`
   - Header: `Authorization: Bearer <saved token>`
   - Header: `Content-Type: application/json`
   - JSON body: `{ "text": <text>, "sender": <sender>, "eventId": <UUID> }`
   - Omit `sender` entirely when `sender` is empty. An empty string is
     accepted and treated as absent, but a missing key is the clearer request.
9. Do not show, speak, copy or log the response. A `202` means a row was
   accepted; `204` means the alert was intentionally ignored.

### Why the sender is sent, and what may be sent as one

`sender` must resolve to the bank label — `ADCB`, `Emirates NBD`, a shortcode.
The physical-device proof below must verify that the converted value really is
that label on the target iOS version. It tells Wafra which bank a card ending
in four digits belongs to; without it two
cards ending in the same four digits at two banks are indistinguishable, and a
payment can settle the wrong card's statement. Android reads this off the inbox
row it scans, so this field is a prerequisite for iOS parity.

It is a label and nothing else. The relay discards a `sender` that is not a
string, contains control characters or bidi overrides, or is longer than 80
characters. It still accepts and parses the transaction without bank identity:
putting a Contact object or message body in this optional field must neither
store it nor silently lose the whole alert. Accepted senders are trimmed,
sealed to the user's devices alongside the parsed row, and stored in D1 only
inside device-sealed ciphertext, never as plaintext or a queryable sender
column.

The message text is still parsed and dropped. `sender` does not change that.

The setup test passes `WAFRA_CAPTURE_TEST_V1` as Shortcut Input, with no
sender. It proves the Shortcut, relay, encryption and sync path only. The app
must remain in “pipe ready” state until a real parsed row with
`captureSource: "shortcut"` is durably staged by the headless iOS task.

A Shortcut built against the earlier `{ "text", "eventId" }` contract keeps
working; `sender` is optional on the wire.

## Personal automation the user creates

1. Automation → **Message** → **Sender**.
2. Select the existing bank conversations listed by Wafra. Do not use a broad
   “Message Contains” rule as a substitute for sender selection.
3. Choose the automatic/no-confirmation execution option shown by that iOS
   version (`Run Immediately`, or disable `Ask Before Running`).
4. Add **Run Shortcut**, choose **Wafra Capture**, and pass the **Messages**
   variable — the received message itself — as `Shortcut Input`. Passing only
   its Content works, but drops the sender and with it the bank identity.
5. Keep the automation enabled.

Apple documents that the Message trigger can filter by selected senders and is
eligible to run without asking:

- https://support.apple.com/guide/shortcuts/communication-triggers-apdd711f9dff/ios
- https://support.apple.com/guide/shortcuts/enable-or-disable-a-personal-automation-apd602971e63/ios

Those pages do not prove that **Run Shortcut** receives a rich Message object
or exposes its Sender detail. Treat the graph above as the required setup spec,
not as parity proof, until the first real alert passes the physical test below.

## Publication and release proof

- Build this graph in Apple Shortcuts, test it with a disposable staging relay,
  remove the staging config file, then publish the credential-free Shortcut.
- Put the resulting `https://www.icloud.com/shortcuts/<id>` URL in
  `EXPO_PUBLIC_WAFRA_SHORTCUT_URL` and run `npm run release:check`.
- On a signed physical iPhone, prove one real bank alert while Wafra is closed
  and the phone is locked. Open Wafra in airplane mode and confirm the already
  staged row is present. Repeat after reboot plus first unlock, and document
  force-quit recovery. Simulator or source inspection is not that proof.

Creating the local graph or publishing its iCloud share link changes the
user's Shortcuts/iCloud state and must be completed in the owning Apple account.
