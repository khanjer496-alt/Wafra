# Building and publishing Wafra Capture — tap by tap

**Do this once, ever.** It is the last thing standing between an iPhone tester
and three-minute setup. Until this exists, every tester has to build the action
graph themselves from `docs/ios-shortcut-spec.md`, which is fine for a
developer and is not consumer onboarding.

`docs/ios-shortcut-spec.md` is the **specification** — what the graph must
satisfy, and why each part is there. It is the authority if the two documents
ever disagree. This file is the **procedure**: which buttons, in which order.

Roughly 20 minutes. **A Mac is enough to build and publish it** — you do not
need an iPhone for that part. Read the next section before starting if you do
not have one, because it changes which steps are yours.

---

## If you do not have an iPhone

You can still do the part that unblocks everyone else. Authoring and publishing
both work in Shortcuts on Mac; Apple's own Mac guide documents the link:

> "Choose Copy iCloud Link from the pop-up menu, then click Share. The link is
> copied to your Clipboard, ready for you to paste into an email, message, or
> text document."
> — <https://support.apple.com/guide/shortcuts-mac/share-shortcuts-apdf01f8c054/mac>

What you cannot do from a Mac is **verify** it, for a reason that has nothing
to do with Shortcuts: Messages on a Mac only receives SMS through Text Message
Forwarding from an iPhone. With no iPhone there is no bank alert to trigger on
and nothing to test against. (Separately, the **Message** automation trigger
appears to be iPhone/iPad-only — every Apple page for it is scoped "on iPhone
or iPad" — but the missing messages are the decisive part.)

You also do not need a setup code to publish. The graph asks for one on first
run and stores it on the user's own iCloud Drive, so a copy that has never been
run is already credential-free. Step 5's deletion only applies if you tested it.

So the split is: **you publish, one tester verifies.**

Pick a single iPhone tester as the designated verifier and do not tell anyone
else iPhone capture works until they have finished:

1. Install the published Shortcut from your link.
2. Paste the setup code from their own copy of Wafra.
3. Run it with `WAFRA_CAPTURE_TEST_V1` — Wafra should reach "pipe ready".
4. Do step 8 below, the real locked-phone alert.

Publishing something you could not run is a real risk, and this is the way to
carry it honestly rather than pretend it is not there.

---

## Before you start

You need one thing from the app: a **setup code**. Open Wafra → Settings →
iPhone capture, connect the iPhone, and on the Shortcut step tap the row to
copy it. It looks like this, on one line:

```json
{"v":1,"url":"https://<relay>/v1/ingest","token":"<long random string>"}
```

That code contains **this device's ingest token**. It is a credential. It goes
into the Shortcut you build now, and it must be gone again before you publish —
step 5 is that removal, and it is not optional.

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

## 2. The first-run branch: store the setup code

Everything in this step exists so the token lives in a file the user controls,
not inside the published Shortcut.

Add, in order:

1. **Get File** — Service: **iCloud Drive**, Path: `Shortcuts/Wafra Capture/config.json`.
   Turn **Error If Not Found** OFF. (Tap the action → the toggle is in the
   expanded options.)
2. **If** — Condition: `File` **has no value**.

Inside the **If** (the true branch):

3. **Ask for Input** — Input Type: **Text**, Prompt: `Paste the setup code from Wafra`.
4. **Get Dictionary from Input** — Input: **Provided Input** (the Ask result).
5. **Get Dictionary Value** — Get **Value** for key `v`, from the Dictionary.
6. **If** — Condition: `Dictionary Value` **is not** `1` → inside it, add
   **Stop and Output** with text `That is not a Wafra setup code.` Then
   **Stop This Shortcut**.
7. **Get Dictionary Value** — Value for key `url`.
8. **If** — `Dictionary Value` **does not contain** `/v1/ingest` → **Stop and
   Output** `That setup code has no ingest address.` and stop.
9. **Save File** — Service **iCloud Drive**, Path
   `Shortcuts/Wafra Capture/config.json`, Input: the **Dictionary** from step 4.
   **Ask Where To Save** OFF, **Overwrite If File Exists** ON.
10. **Show Notification** — `Wafra Capture is ready`.
11. **Stop This Shortcut**.

> Do not add a step that sends the setup code anywhere. It is stored and
> nothing else. The relay never needs to be told a token it issued.

Now tap **Otherwise** / move below the If — the rest runs when the file exists.

---

## 3. Read the message

12. **Get Dictionary from Input** — Input: the **File** from step 1.
13. **If** — Condition: `Shortcut Input` **is of type** **Text**
    - True branch: **Set Variable** `text` to **Shortcut Input**.
    - Otherwise: **Get Details of Messages** → **Content**, then **Set
      Variable** `text` to it. Then **Get Details of Messages** → **Sender**,
      then **Text** (an explicit Text action, converting the contact), then
      **Set Variable** `sender` to that Text.

The explicit **Text** action on the sender matters. Without it the value is a
contact object, and what lands at the relay is not the bank label.

14. **If** — `text` **has no value** → **Stop This Shortcut**. An empty message
    must not become a request.

---

## 4. Send it

15. **UUID** → **Set Variable** `eventId`.
16. **Get Dictionary Value** — Value for key `url`, from the Dictionary in
    step 12 → **Set Variable** `endpoint`.
17. **Get Dictionary Value** — Value for key `token` → **Set Variable** `token`.
18. **Get Contents of URL** — URL: `endpoint`. Expand **Show More**:
    - Method: **POST**
    - Headers:
      - `Authorization` → `Bearer ` + `token` *(type the word Bearer, a space,
        then insert the variable)*
      - `Content-Type` → `application/json`
    - Request Body: **JSON**
      - `text` (Text) → variable `text`
      - `sender` (Text) → variable `sender`
      - `eventId` (Text) → variable `eventId`

**Nothing after this action.** No Show Result, no Quick Look, no Copy to
Clipboard, no Speak. A `202` means the row was accepted and a `204` means the
alert was deliberately ignored; neither is worth putting a bank alert's
response on screen for.

---

## 5. Remove the credential before publishing

The Shortcut you just tested has your token sitting in
`Shortcuts/Wafra Capture/config.json` on **your** iCloud Drive — not inside the
Shortcut. That is the design. But verify it rather than trust it:

1. Files app → iCloud Drive → **Shortcuts** → **Wafra Capture** → delete
   `config.json`.
2. Run **Wafra Capture** once with any text. It must ask you to paste a setup
   code — that is the proof that the graph carries no configuration of its own.
3. Cancel the prompt. Do not paste anything.

Then read the graph once more looking for a literal relay URL, a literal token,
a bank name, or your own phone number typed into any action. There must be
none. Anything typed literally into an action ships to every person who
installs it.

---

## 6. Prove it works, then publish

With `config.json` deleted, run the Shortcut and paste your setup code when it
asks. Then run it again with the text:

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
