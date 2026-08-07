# Wafra iOS relay

A Cloudflare Worker that exists for one reason: **iOS gives no app access to
SMS**, so the Android design — scan the inbox on-device, never touch the
network — cannot exist on iPhone.

What iOS does allow is a Shortcuts *personal automation* the user creates
themselves: "when I get a message from my bank, send it to Wafra". A Shortcut
cannot hand data to a sleeping app; it can only make an HTTP request. That is
the whole reason this service exists, and why the Android build still has no
server and never will.

## What it does and does not keep

The message text is parsed and **dropped**. It is never written to D1, never
logged, never returned. There is no table for messages — look at `schema.sql`.

What persists is the parsed row (merchant, amount, date, category), **sealed to
the device that will collect it** with X25519 + AES-GCM, and deleted the moment
that device acknowledges it. The Worker throws away the ephemeral private key
as it seals, so it cannot read back what it stored. A dump of the database is
ciphertext and nothing else.

Typical retention is the seconds between a text arriving and the phone syncing.
The hard ceiling is 72 hours, after which unsynced rows are swept.

This is deliberately stricter than FinArt, which keeps full message bodies for
30 days. Their approach buys something real — they can re-run a fixed parser
over stored messages and repair history retroactively, which we cannot. The
trade was made the other way here: a readable archive of UAE bank messages is a
breach target, and "Data Not Collected" is the product's main claim.

## The parser is not duplicated

`src/index.ts` imports `parseSms` from the app's own `src/lib/sms-parser.ts`
via the `@/*` path alias in `tsconfig.json`. There is one parser. Every fix
made for Android applies here the day it lands, and the 190 parser tests cover
this service too. Do not fork it.

## Deploy

```bash
npm --prefix server install
npx --prefix server wrangler login

npm --prefix server run setup     # find-or-create D1, write its id, apply the schema
npm --prefix server run deploy
```

`setup` is idempotent — re-run it on any machine to point a fresh clone at the
existing database. If your Cloudflare login can see more than one account it
stops and asks you to set `CLOUDFLARE_ACCOUNT_ID`; that is the expected
behaviour, not a failure.

There are no secrets to configure. Identity is a key the phone generates, so
this service has nothing to authenticate itself with and nothing to leak.

Cloudflare's free tier covers early usage comfortably: 100k Worker requests a
day, and D1's free allowance is far beyond what a queue that empties itself
will ever hold.

Verify:

```bash
curl https://wafra-relay.<your-subdomain>.workers.dev/v1/health
# {"ok":true}
```

## Pointing the app at it

`deploy` prints the Worker's URL. Put it in `eas.json` as
`EXPO_PUBLIC_WAFRA_RELAY_URL`, in all three build profiles, replacing the
`REPLACE-ME` placeholder. The app treats a URL still containing `REPLACE-ME`
as unconfigured and says so on the capture screen rather than failing at the
first request — a build that was never pointed anywhere should look like a
build that was never pointed anywhere, not like a broken feature.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/v1/pair` | `{publicKey}` (base64 X25519, 32 bytes) → `{deviceId, token, ingestUrl}` |
| `POST` | `/v1/ingest` | Bearer token. `{text, receivedAt?}` → `202`, or `204` if the message was not a transaction |
| `GET` | `/v1/sync` | Bearer token → `{items: [{id, epk, iv, ct}]}` |
| `POST` | `/v1/ack` | Bearer token. `{ids: [...]}` → `204`, rows deleted |
| `DELETE` | `/v1/device` | Bearer token → `204`, device and queue erased |

No email, no password, no account. Identity is a key the phone generated. Sync
is pull-then-acknowledge rather than delete-on-read, so a dropped response
loses nothing — the app asks again and the row is still there.

`204` on ingest is the common case and is not an error: the Shortcut fires on
every message from the sender, and most of them are OTPs, promos and delivery
notices that are none of our business.

## The Shortcut the user builds

In **Shortcuts → Automation → New → When I get a message**:

1. **Sender**: add your banks' SMS senders (ADCB, FAB, Liv, Emirates NBD…).
2. **Run Immediately**, notification off.
3. Action: **Get Contents of URL**
   - URL: the `ingestUrl` returned by pairing
   - Method: `POST`
   - Headers: `Authorization: Bearer <token>`, `Content-Type: application/json`
   - Request Body: JSON, one field `text` = the **Shortcut Input** message
     content. Optionally a second field `sender` = the message sender, which is
     what lets an auto-created account read "ADCB Credit ~4733" rather than
     "Credit ~4733".

The app shows the URL and token on its pairing screen (**Settings → Automatic
capture**, iOS only) so none of this is typed from memory — every row there
copies to the clipboard on tap.

### Two limits to be honest about

**No history.** Android scans the whole inbox — that is where a typical user's
first few thousand transactions come from. Shortcuts fires only on *new*
messages, so an iOS user starts empty and accumulates from install day. This is
why statement-file import matters far more on iOS than on Android.

**Setup friction.** It is roughly six taps in an app most people have never
opened, and a meaningful share will not finish it. The app must be complete
with manual entry regardless — both because that is honest, and because App
Review Guideline 4.2 is unkind to apps whose value depends on setup performed
outside them.

### Whether "Run Immediately" fires without confirmation

Apple has changed this behaviour across iOS releases, and message-triggered
automations have not always been allowed to run unattended. **Verify on a real
device before promising it in the listing.** If confirmation is required, the
feature still works — it just prompts, which is worse but not broken.
