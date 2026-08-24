# Wafra Capture — publishable Shortcut specification

This is the source-of-truth action graph for the credential-free iCloud
Shortcut referenced by `EXPO_PUBLIC_WAFRA_SHORTCUT_URL`. The published Shortcut
must contain no Wafra server URL, bearer token, device identifier, bank name or
user data. Pairing supplies a versioned one-paste JSON value:

```json
{"v":1,"url":"https://<relay>/v1/ingest","token":"<device ingest bearer>"}
```

## Action graph

The repository generator produces the audited 50-action version of this graph.

1. Accept **Messages** and **Text** as `Shortcut Input`. The intended personal
   automation passes the whole Message object so the graph can try to extract
   its sender. Text stays accepted so the manual setup test below still runs.
2. Add one **Text** action for the setup JSON. Its shared value must be empty.
   In the Shortcut's **Setup** screen, attach an import question to that Text
   field: “Paste the setup code copied by Wafra.” Apple clears a field covered
   by an import question from the shared copy and asks the recipient to supply
   their own value when customising or first running it.
3. Get Dictionary from that Text action. Require `v` to equal `1`, `url` to be
   an HTTPS URL ending in `/v1/ingest`, and `token` to be non-empty. Stop with
   “Open Wafra and copy a new setup code” when validation fails.
4. If `Shortcut Input` has no value, show “Wafra Capture is ready” and stop.
   This makes the one-time configuration run visibly complete without sending
   any financial or setup data.
5. Branch on the type of `Shortcut Input` before reading Message details:
   - For **Text**, explicitly convert `Shortcut Input` to Text as `text` and
     leave `sender` absent.
   - For **Messages**, explicitly convert the Message's **Content** to Text as
     `text`, and explicitly convert its **Sender** to Text as `sender`. Do not
     rely on JSON coercion of a Contact or participant object. The request from
     this branch also gets the fixed literal discriminator
     `automation: "message"`; the Text branch never gets it.
6. Require non-empty `text`; stop without a request when it is empty.
7. Generate one UUID-shaped `eventId`. The repository graph hashes two random
   numbers plus Current Date, then formats the hash as a UUID; Current Date is
   entropy for this request id only.
8. In each branch, use Get Contents of URL with the saved `url`:
   - Method: `POST`
   - Header: `Authorization: Bearer <saved token>`
   - Header: `Content-Type: application/json`
   - Text body: `{ "text": <text>, "eventId": <UUID> }`
   - Messages body:
     `{ "text": <text>, "sender": <sender>, "eventId": <UUID>, "automation": "message" }`
   - An empty `sender` is accepted and treated as absent. The generated graph
     supplies the key only in the Messages branch.
9. Close the top-level Text-or-Messages conditional, then append **Stop This
   Shortcut** with no input as the final action. It must be outside the
   conditional so both successful POST branches discard the HTTP response
   instead of returning it as a response file.
10. Do not show, speak, copy or log the response. A `202` means a row was
    accepted; `204` means the alert was intentionally ignored.

The official graph intentionally has no Message Date detail, Format Date,
Convert Time Zone or `receivedAt` action/body field. Its only Current Date
value is the event-id entropy above. Native inspection on iOS 26.1 found that
`WFMessageContentItem` exposes Content, Name, Recipients and Sender, but not
Date. The relay therefore stamps its receipt time on rows from this graph.
`receivedAt` remains an optional, plausibility-checked wire field for older or
alternate clients that can supply a real message timestamp; it is not part of
the publishable 50-action graph.

The published graph must contain **no Get File, Save File, Move File or Folder
action**. The first public Wafra Capture accidentally configured Get File to
use `Shortcut Input` as its directory. The app's text probe therefore produced
Apple's “The provided file path must be contained within the directory” error.
File-backed configuration is prohibited so that failure class cannot return.

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
sender. It proves the Shortcut, relay, encryption and sync path only. When the
user later confirms that the personal automation is ready, the app uses its
admin credential to rotate an opaque generation for this device. A subsequent
Messages-branch request still sends only `automation: "message"`; after
authenticating it, the relay binds that request to its server-held generation
and seals this marker into the parsed row:

```json
{"kind":"message","sourceDeviceId":"<authenticated device>","generation":"<current opaque generation>"}
```

The app records automation proof only after that parsed row is durably staged
or imported and both `sourceDeviceId` and `generation` exactly match its current
setup. Foreground recovery and the background task are equally valid consumers
of the sealed evidence. A row captured by another trusted device cannot prove
this iPhone, and a queued or locally staged row from an older setup generation
cannot become fresh merely because it is processed after setup is retried.

A Shortcut built against the earlier `{ "text", "eventId" }` contract keeps
capturing; `sender`, `receivedAt` and `automation` are optional on the wire.
It cannot earn the app's stronger “automation verified” status until replaced
with a graph that sends the Messages-only discriminator. The server, not the
Shortcut, supplies the source-device and generation proof metadata.

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

- Build this graph in Apple Shortcuts and test it with a disposable staging
  relay. Before sharing, add the import question to the setup Text field and
  use **Customise Shortcut** to prove Apple asks the question and replaces that
  field. Publish only the credential-free shared copy.
- Download the unsigned source behind the resulting iCloud record and verify:
  one setup import question exists; no file/folder action exists; and no relay
  URL, bearer token, phone number, bank name or test data appears literally.
- Put the resulting `https://www.icloud.com/shortcuts/<id>` URL in
  `EXPO_PUBLIC_WAFRA_SHORTCUT_URL` and run `npm run release:check`.
- On a signed physical iPhone, prove one real bank alert while Wafra is closed
  and the phone is locked. Open Wafra in airplane mode and confirm the already
  staged row is present. Repeat after reboot plus first unlock, and document
  force-quit recovery. Simulator or source inspection is not that proof.

Creating the local graph or publishing its iCloud share link changes the
user's Shortcuts/iCloud state and must be completed in the owning Apple account.
