# Wafra History Import — iOS 26.5+ Shortcut specification

This is the source of truth for the separate **Wafra History Import**
Shortcut. It imports retained historical Messages into Wafra without uploading
their text. It does not replace **Wafra Capture**, which remains the real-time
personal automation.

## Supported scope and honest boundary

- Require iOS **26.5 or later**. Apple introduced **Find Message** in iOS 26,
  but its Body filter regressed in iOS 26.3–26.4.1. The launch baseline is the
  current stable iOS 26.6.
- “Past messages” means Messages still retained and indexed on this iPhone.
  The Shortcut cannot recover deleted messages, expired 30-day/one-year
  history, or content that is not downloaded from iCloud.
- The user starts every history import and chooses its date range. Wafra never
  receives continuing Messages access.
- Raw text never uses the relay, clipboard, a URL query, Files, Notes,
  analytics, logs or AI. The native Wafra action stages it under iOS complete
  file protection; Wafra parses locally and deletes the session after durable
  confirmation or explicit cancellation. An abandoned session becomes
  eligible for expiry after one hour and is purged on the next Wafra history
  stage/read; iOS does not guarantee an exact background deletion wake.

Apple documents the action's introduction in the
[Shortcuts release notes](https://support.apple.com/en-us/125148), and documents
Shortcut privacy choices and reset in its
[privacy settings guide](https://support.apple.com/en-gb/guide/shortcuts/apd961a4fc65/ios).

## Versioned record contract

Each Message becomes one JSON **Text** value. The Shortcut passes an array of
at most 50 such values to Wafra's App Intent:

```json
{
  "v": 1,
  "id": "<SHA-256 of Message GUID, hex or base64url>",
  "text": "<Message Body/Content>",
  "sender": "<plain sender label, omitted when unavailable>",
  "receivedAt": "2026-08-09T12:34:56.000Z"
}
```

Rules enforced again by Wafra:

- `id`: 8–128 ASCII letters, digits, `_` or `-`; never send the raw GUID.
- `text`: non-empty, valid Unicode, at most 16 KiB encoded as UTF-8.
- `sender`: optional plain Text, 1–80 characters, no controls or bidi marks.
  If Shortcuts supplies an unsafe Contact-like value, Wafra drops only this
  optional field and still parses the financial message.
- `receivedAt`: an exact valid UTC ISO-8601 instant with seconds and optional
  milliseconds; never substitute the time the Shortcut happened to run.
- No extra dictionary keys. Contract version is exactly `1`.
- At most 50 records per App Intent call, 10,000 per session, and 8 MiB of
  serialized record text across the session. Histories over either session
  limit must be imported in more than one date range.

## Shortcut action graph

Name the Shortcut **Wafra History Import** exactly. It accepts no Share Sheet
input and contains no relay URL, credential, bank name, phone number, or user
data.

1. **Get Device Details → System Version**. If lower than 26.5, show
   “Past-message import requires iOS 26.5 or later” and stop.
2. **Show Alert**:

   > Apple Shortcuts will search retained Messages on this iPhone in the date
   > range you choose. Wafra parses them on this iPhone, shows a review, and
   > deletes staged text after confirm or cancel. Nothing is uploaded. Deleted
   > or retention-expired messages cannot be recovered.

   Provide **Continue** and **Cancel**.
3. **Ask for Date** twice: `Start of history` and `End of history`. Reject an
   end earlier than the start or later than today. Normalize Start to the
   user's local start-of-day. Normalize End to the next local day's
   start-of-day and use it as an exclusive upper bound; when End is today, use
   the current instant. This includes the whole end date instead of stopping
   at 00:00.
4. **Find Messages** where Date is at-or-after normalized Start and before the
   exclusive End. Do not require
   body keywords: universal bank formats do not share a reliable word, and a
   keyword filter creates silent false negatives. If the current iOS action
   exposes a Sender/Conversation predicate, the user may additionally choose
   known bank conversations; date-only search remains the recall-safe path.
5. If the result count is over 10,000, show “Choose a smaller date range” and
   stop before staging anything.
6. Show the exact result count and ask the user to continue. This is the last
   point before any Message body crosses from Shortcuts into Wafra's protected
   local staging area.
7. Generate **UUID** as `sessionId`. Keep the hyphens; Wafra accepts them.
8. Set Number `chunkIndex` to `0`. Set List `chunkRecords` to an empty list.
9. **Repeat with Each** Message, preserving the Find result order:
   1. Get Message detail **GUID**. Hash it with **SHA-256**. Convert the hash to
      lowercase hexadecimal or base64url Text as `id`. Never use GUID itself.
   2. Get detail **Content** (or Body) as `text`.
   3. Get detail **Sender**, then pass it through an explicit **Text** action as
      `sender`; omit the dictionary key if the result is empty.
   4. Get detail **Date**. Format in UTC as
      `yyyy-MM-dd'T'HH:mm:ss.SSS'Z'` as `receivedAt`. The Date action's time
      zone must be UTC; quoting `Z` without changing the zone is incorrect.
   5. Build the version-1 Dictionary shown above, then serialize it with
      **Get Text from Input** / JSON Text. Add that Text to `chunkRecords`.
   6. When `chunkRecords` contains 50 items, run the Wafra action
      **Stage Wafra message history** with `sessionId`, `chunkIndex`, and the
      entire `chunkRecords` list. Increase `chunkIndex` by one and clear the
      list. The action skips an individual record over 16 KiB and reports the
      skipped count in its Shortcuts dialog; bank alerts are not realistically
      that large, while long personal iMessages can be. One oversized message
      therefore cannot block every bank alert from the same date.
10. After the repeat, stage the remainder when `chunkRecords` is non-empty.
    If any stage action reports a session-size, conflict, or disk error, Wafra
    atomically discards every chunk already staged for that session. Show
    “Choose a smaller date range” and stop; never open an incomplete review.
11. Open only this URL:

    ```text
    wafra://import-sms?history=<sessionId>
    ```

    No Message content, sender, date, GUID or hash belongs in the URL.
12. End the Shortcut. Do not show, copy, save, speak or log any record or App
    Intent result.

## Wafra-side behavior

`StageWafraMessageHistoryIntent` is generated into the iOS app target. It:

- requires local-device authentication;
- accepts a maximum of 50 JSON Text records per chunk;
- makes retries idempotent when a chunk's bytes are identical and rejects a
  conflicting replay of the same chunk number;
- caps a session at 10,000 accepted records, skips and reports individual
  records over 16 KiB, and caps all accepted serialized record text at 8 MiB;
  protected staging is additionally bounded to four sessions and 24 MiB total;
  a session-size, conflict, or disk failure rolls back the whole session;
- writes atomically with complete file protection in Application Support and
  excludes the staging directory from device backups.

The `/import-sms?history=` screen:

1. validates every field again;
2. parses locally with the same `parseSms` and `buildImportPlan` used by
   Android;
3. reads at most one 50-record chunk over the native bridge at a time, yields
   between chunks, and immediately drops all raw text from parsed, declined,
   and ignored rows;
4. shows a non-mutating review;
5. commits normalized rows atomically to SQLCipher only after confirmation;
6. deletes staging only after the durable write succeeds, or on explicit
   cancel; abandoned sessions become purge-eligible after one hour and are
   removed on the next history staging/read operation;
7. keeps Android's `lastScanTs` unchanged.

## Physical iPhone release gate

Source inspection and Simulator builds are not sufficient. On a signed current
iPhone, verify:

- Find Message returns carrier SMS, not only iMessage;
- Body, Date, Sender and GUID are available and coerce as specified;
- alphanumeric bank IDs, short codes, Unknown Senders/Finance filtering,
  Arabic/RTL, Indian numbering, non-Latin digits and dual SIM;
- histories near and over the 10,000-row and 8 MiB boundaries;
- iCloud Messages partially downloaded, interrupted staging, retry, cancel,
  low storage, lock/reboot, explicit cleanup, and opportunistic expiry;
- the Shortcuts **Allow Sharing Large Amounts of Data** recovery setting, and
  List magic-variable coercion into the App Intent's `[String]` parameter;
- overlap between historical import and a live Wafra Capture alert produces
  one transaction;
- airplane-mode import succeeds and no request contains historical text.

Publish the exact tested Shortcut from the owning Apple account, copy its
iCloud link, set it as `EXPO_PUBLIC_WAFRA_HISTORY_SHORTCUT_URL` in every iOS
EAS build profile, and run `npm run release:check`. Do not reuse the real-time
`EXPO_PUBLIC_WAFRA_SHORTCUT_URL`: these are separate action graphs. Include the
tested history link in App Review notes with a synthetic-message demo. Do not
advertise Android-equivalent history coverage before this gate passes.
