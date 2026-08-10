# Building and publishing Wafra Capture — tap by tap

**Do this once, ever.** It is the last thing standing between an iPhone tester
and three-minute setup. Until this exists, every tester has to build the action
graph themselves from `docs/ios-shortcut-spec.md`, which is fine for a
developer and is not consumer onboarding.

`docs/ios-shortcut-spec.md` is the **specification** — what the graph must
satisfy, and why each part is there. It is the authority if the two documents
ever disagree. This file is the **procedure**: which buttons, in which order.

Roughly 20 minutes on an iPhone or iPad. A Mac can maintain and publish the
sender-blind base Shortcut, but it cannot complete the sender-aware graph on
the current Shortcuts release. Read the next section before starting if you do
not have an iPhone or iPad, because it changes who completes the graph.

---

## If you do not have an iPhone or iPad

The first published Wafra Capture was authored on a Mac and safely forwards the
message body, but it cannot carry bank identity. On the Mac used to publish it,
the Shortcut Input picker has no **Messages** type and the action library cannot
construct **Get Details of Messages → Sender**. Searching for that action only
offers details for Mac-supported content types. Do not publish a Mac-only edit
as sender-aware v2: it would be another sender-blind snapshot.

A Mac can publish ordinary Shortcuts; Apple's own guide documents the link.
That does not prove macOS will preserve iPhone-only Message actions when it
imports and re-shares a completed graph:

> "Choose Copy iCloud Link from the pop-up menu, then click Share. The link is
> copied to your Clipboard, ready for you to paste into an email, message, or
> text document."
> — <https://support.apple.com/guide/shortcuts-mac/share-shortcuts-apdf01f8c054/mac>

The **Message** personal-automation trigger is also documented only for iPhone
or iPad. A Mac with no paired iPhone has no real bank SMS to trigger it with.
Parser, relay and account-placement simulations are useful, but none can prove
what Apple's automation supplies as the Message Sender.

You also do not need a production setup code to publish. The graph uses an
Apple import question attached to an empty Text field. Apple asks each person
for their own setup code and does not include that answer in the shared field.

So the split is: **one iPhone/iPad tester completes, verifies and publishes v2;
the Mac owner wires that tested link into the app.**

Pick a single iPhone tester as the designated verifier and do not tell anyone
else iPhone capture works until they have finished:

1. Build a fresh Shortcut on their iPhone. Do not duplicate the first public
   Wafra Capture; its Get File action is wired to Shortcut Input and is the
   source of the “path must be contained within the directory” failure.
2. Complete steps 1 through 4 below so the Shortcut accepts **Messages** and
   **Text**, extracts **Content** and **Sender**, explicitly converts Sender to
   **Text**, and posts `text`, `sender` and `eventId`.
3. Use **Customise Shortcut** to answer the setup import question with the
   setup code from their own copy of Wafra, then run
   `WAFRA_CAPTURE_TEST_V1`; Wafra should reach "pipe ready".
4. Do step 8 below with a real locked-phone bank alert and confirm the row is
   assigned to the correct bank/card rather than merely arriving.
5. Verify the setup Text field is covered by the import question and that the
   shared graph contains no setup code, relay URL, bearer, phone number or bank
   name, then copy its iCloud link.
6. Send that link to the Mac owner. Do not edit the graph between the successful
   test and publication. If project ownership later requires re-sharing it from
   another Apple account, repeat the physical verification on that exact link.

The tester's setup token lives only in their customised local Shortcut. Never
ask them to send that code to the Mac owner.

---

## Before you start

You need one thing from the app: a **setup code**. Open Wafra → Settings →
iPhone capture, connect the iPhone, and on the Shortcut step tap the row to
copy it. It looks like this, on one line:

```json
{"v":1,"url":"https://<relay>/v1/ingest","token":"<long random string>"}
```

That code contains **this device's ingest token**. It is a credential. It must
only be pasted as the answer to the setup import question on that user's
device; it must never be a literal value in the shared graph, sent to the Mac
owner, or included in an exported public artifact. Step 5 verifies that
boundary and is not optional.

---

## 1. Make the Shortcut

Shortcuts app → **+** (top right) → rename it **Wafra Capture** exactly. The
name is what the app tells users to look for.

Then, in the Shortcut's own settings (the ⓘ or the name → **Details**):

- Turn **Show in Share Sheet** OFF.
- Under **Accepted Types**, tick **Messages** and **Text**, nothing else.

`Messages` is what carries the sender. `Text` stays on so the setup test in
step 6 can run.

---

## 2. Add the one-time setup question

1. Add a **Text** action as the first action and leave it empty.
2. Shortcut name menu → **Setup** → **Add New Question** → choose the Text
   field from action 1. Use the question `Paste the setup code copied by Wafra`.
   Leave the default answer empty.
3. Add **Get Dictionary from Input**, using the Text action.
4. Validate the Dictionary's `v`, `url` and `token`: `v` must equal `1`, `url`
   must use HTTPS and end in `/v1/ingest`, and `token` must not be empty. On a
   failure, stop with `Open Wafra and copy a new setup code.`
5. If **Shortcut Input** has no value, show notification
   `Wafra Capture is ready` and stop. This is the visible end of the one-time
   setup run.

Do not add **Get File**, **Save File**, **Move File** or a Folder action. The
first public Wafra Capture accidentally used Shortcut Input as the Get File
directory. A text test could never be contained inside that “directory,” which
is the exact failure shown by the TestFlight tester.

---

## 3. Read the message

6. **If** — Condition: `Shortcut Input` **is of type** **Text**
    - True branch: **Set Variable** `text` to **Shortcut Input**.
    - Otherwise: **Get Details of Messages** → **Content**, then **Set
      Variable** `text` to it. Then **Get Details of Messages** → **Sender**,
      then **Text** (an explicit Text action, converting the contact), then
      **Set Variable** `sender` to that Text. Then **Get Details of Messages**
      → **Date** → **Format Date** using UTC and custom format
      `yyyy-MM-dd'T'HH:mm:ss.SSS'Z'` → **Set Variable** `receivedAt`.

The explicit **Text** action on the sender matters. Without it the value is a
contact object, and what lands at the relay is not the bank label.

7. **If** — `text` **has no value** → **Stop This Shortcut**. An empty message
    must not become a request.

---

## 4. Send it

8. **UUID** → **Set Variable** `eventId`.
9. **Get Dictionary Value** — Value for key `url`, from the setup Dictionary →
   **Set Variable** `endpoint`.
10. **Get Dictionary Value** — Value for key `token` → **Set Variable** `token`.
11. **Get Contents of URL** — URL: `endpoint`. Expand **Show More**:
    - Method: **POST**
    - Headers:
      - `Authorization` → `Bearer ` + `token` *(type the word Bearer, a space,
        then insert the variable)*
      - `Content-Type` → `application/json`
    - Request Body: **JSON**
      - `text` (Text) → variable `text`
      - `sender` (Text) → variable `sender`
      - `eventId` (Text) → variable `eventId`
      - `receivedAt` (Text) → variable `receivedAt`

The manual Text setup test has no Message Date; omit `receivedAt` in that
branch. Never stamp a real alert with the current time merely because the
automation ran late.

**Nothing after this action.** No Show Result, no Quick Look, no Copy to
Clipboard, no Speak. A `202` means the row was accepted and a `204` means the
alert was deliberately ignored; neither is worth putting a bank alert's
response on screen for.

---

## 5. Prove the shared copy has no credential

1. Shortcut name menu → **Setup**. Confirm exactly one import question targets
   the first Text action and has no default answer.
2. Tap **Customise Shortcut**. Confirm Apple asks for the Wafra setup code and
   that the answer populates the Text field.
3. Read the graph looking for a literal relay URL, token, bank name, phone
   number, or Message content. There must be none outside your local answer.
4. After publishing, download the unsigned source behind the iCloud record and
   inspect it. It must contain the import question, no file/folder actions, and
   no setup value. Do not rely on the editor view alone. On this Mac, run:

   ```bash
   bash scripts/check-ios-shortcut-artifact.sh https://www.icloud.com/shortcuts/<new-id>
   ```

---

## 6. Prove it works, then publish

Run the freshly customised Shortcut once with no input. It must say
`Wafra Capture is ready`. Then run it with the text:

```
WAFRA_CAPTURE_TEST_V1
```

Wafra's setup screen should move to "pipe ready". That proves the Shortcut, the
relay, the encryption and the sync path — and **only** those. It does not prove
the automation fires on a real alert; step 8 is that.

Now publish: Shortcut → **Share** → **Copy iCloud Link**. The link looks like

```
https://www.icloud.com/shortcuts/0123456789abcdef0123456789abcdef
```

---

## 7. Put the link in the build

It goes in `eas.json`, under `build.production.env`:

```json
"production": {
  "autoIncrement": true,
  "env": {
    "EXPO_PUBLIC_WAFRA_RELAY_URL": "https://wafra-relay.khanjer496.workers.dev",
    "EXPO_PUBLIC_WAFRA_SHORTCUT_URL": "https://www.icloud.com/shortcuts/<published-id>"
  }
}
```

**It cannot be a GitHub secret.** The iOS build runs on Expo's macOS workers,
not on the GitHub runner, so a runner environment variable never reaches it.
`eas.json` (a commit) or an EAS project environment variable
(`eas env:create`) are the two places that work. This is the opposite of
`WAFRA_RELAY_URL` for the Android APK, which *is* a repository variable —
that build runs on the runner.

Then rebuild, and `npm run release:check` stops failing on this line.

---

## 8. The proof that actually matters

Everything above can pass while automatic capture still does not work, because
none of it involves a real message arriving.

On a signed physical iPhone, with the personal automation set up per
`docs/ios-shortcut-spec.md` ("Personal automation the user creates"):

1. Let one real bank alert arrive while **Wafra is closed and the phone is
   locked**.
2. Open Wafra **in airplane mode**. The row must already be there — that proves
   it was staged by the headless task rather than fetched when you looked.
3. Repeat after a reboot plus first unlock.
4. Repeat after a force-quit, and write down what recovery required.

Simulator runs and reading the source are not this proof. Until step 8 passes
on a real device, the honest thing to tell testers is that iPhone capture is
unverified.

---

## What testers still have to do themselves

Apple makes personal automations **per-device** and gives no way to ship one.
So even with the Shortcut published, every tester creates their own Message
automation once: Shortcuts → Automation → **Message** → **Sender**, pick their
bank conversations, choose **Run Immediately**, and add **Run Shortcut → Wafra
Capture**, passing the **Messages** variable as input.

That is the floor Apple sets, not something left undone here.

- <https://support.apple.com/guide/shortcuts/communication-triggers-apdd711f9dff/ios>
- <https://support.apple.com/guide/shortcuts/enable-or-disable-a-personal-automation-apd602971e63/ios>
