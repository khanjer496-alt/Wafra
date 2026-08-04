# Wafra iOS relay

A Cloudflare Worker that exists for one reason: **iOS gives no app access to
SMS**, so the Android design — scan the inbox on-device, never touch the
network — cannot exist on iPhone.

What iOS does allow is a Shortcuts *personal automation* the user creates
themselves: "when I get a message from my bank, send it to Wafra". A Shortcut
cannot hand data to a sleeping app; it can only make an HTTP request. That is
the whole reason this service exists, and why the Android build still has no
server and never will.

The device half lives in `src/lib/relay.ts` (pairing, sync, ack, unpair,
status) and `src/lib/relay-crypto.ts` (the counterpart to `src/crypto.ts`'s
seal). The two halves are asserted against each other in
`scripts/test/worker.test.js` — the real `seal()` runs and the real shipping
`openSealed()` opens it, so a change to either that breaks the other fails in
CI rather than on a user's phone.

## What it does and does not keep

The message text is parsed and **dropped**. It is never written to D1, never
logged, never returned. There is no table for messages — look at `schema.sql`.

What persists is the parsed row, **sealed to the device that will collect it**
with X25519 + AES-GCM, and deleted the moment that device acknowledges it. The
Worker throws away the ephemeral private key as it seals, so it cannot read
back what it stored. A dump of the database is ciphertext and nothing else.

Inside the seal, alongside the parsed row, are three fields the phone needs and
the service must not be able to read:

| Field | Why it is there | Why it is inside the seal |
| --- | --- | --- |
| `sender` | The SMS sender ID is the **only** thing that says which bank sent a message — no UAE bank but HSBC names itself in the body. Without it, a card that is branded on Android is grey and nameless on iOS, and three sender-gated parser rules never fire. | A column of sender IDs is a record of which banks each device hears from. |
| `smsTs` / `receivedAt` | The app's strong duplicate guard is a fingerprint of the message timestamp and amount. Defaulting to `new Date()` gave a Shortcut retry a *different* fingerprint, so the same charge landed twice. | A timestamp column is a record of when each device receives bank messages. |
| `msgId` | SHA-256 of the message text. Stable across a retry with a drifted clock, which the timestamp fingerprint is not. | It is derived from the text, and short texts are guessable. It is a key the phone compares against itself, not an index into anything. |

None of the three is a column, an index, or a log line. The claim the service
makes is unchanged: **it cannot read what it stored.**

Typical retention is the seconds between a text arriving and the phone syncing.
The hard ceiling is 72 hours, after which unsynced rows are swept.

This is deliberately stricter than FinArt, which keeps full message bodies for
30 days. Their approach buys something real — they can re-run a fixed parser
over stored messages and repair history retroactively, which we cannot. The
trade was made the other way here: a readable archive of UAE bank messages is a
breach target, and "Data Not Collected" is the product's main claim.

**One thing that must be said out loud in the app, not just here.** The
Shortcut's filter is coarse (see below), so messages that are not from a bank
*do* reach this Worker. They are parsed, they return `204`, and nothing is
stored — but the text left the phone. Any onboarding copy telling an iPhone
user "there is no server" is false and has to be rewritten before this ships.

## The parser is not duplicated

`src/index.ts` imports `parseSms` from the app's own `src/lib/sms-parser.ts`
via the `@/*` path alias in `tsconfig.json`. There is one parser. Every fix
made for Android applies here the day it lands, and the parser tests cover this
service too. Do not fork it.

### The market pack

`parseSms` reads the **active market pack** at call time, and the Worker used
to leave it at the hardcoded AE default. For a Saudi user that is not a small
bug: `SAR 45.00 at PANDA RIYADH` under the AE pack finds no currency it knows,
misreads the amount, and categorises nothing. So the device tells the relay
which pack to use — at `/v1/pair`, and afterwards via `PATCH /v1/device`.

`setActiveMarket()` sets module-level state shared by the whole isolate, so it
and `parseSms` are called as one **synchronous** block with no `await` between
them. A Workers isolate runs JavaScript on one thread, so nothing can interleave
there. If you ever add an `await` between those two lines, you have introduced a
cross-user parsing bug that will not reproduce under load of one.

## Deploy

```bash
cd server
npm install
npx wrangler login

npm run setup     # creates or finds the "wafra" D1 database, writes its
                  # database_id into wrangler.toml, and applies schema.sql
npm run deploy
```

`npm run setup` is idempotent — run it on a machine that already has the
database and it finds the existing one. A D1 binding is resolved at build time
and there is no environment-variable substitution for it, which is why the id
has to be written into `wrangler.toml` rather than injected. `npm run deploy`
runs `node scripts/d1.mjs check` first and refuses while the id is still the
placeholder, so a fresh clone fails with a sentence instead of an opaque
Cloudflare API error.

If you would rather do it by hand:

```bash
npx wrangler d1 create wafra          # copy the printed uuid
# paste it into wrangler.toml -> [[d1_databases]] database_id
npx wrangler d1 execute wafra --remote --file=./schema.sql
npx wrangler deploy
```

**Upgrading a database created before the `market` column existed:**

```bash
npx wrangler d1 execute wafra --remote \
  --command "ALTER TABLE devices ADD COLUMN market TEXT NOT NULL DEFAULT 'AE'"
```

Existing devices keep parsing under AE, which is what they were doing anyway.

Cloudflare's free tier covers early usage comfortably: 100k Worker requests a
day, and D1's free allowance is far beyond what a queue that empties itself
will ever hold.

Verify:

```bash
curl https://wafra-relay.<your-subdomain>.workers.dev/v1/health
# {"ok":true}
```

The app needs to be pointed at the deployment: set `expo.extra.relayUrl` in
`app.json` to the Worker's origin. `src/lib/relay.ts` reads it and refuses to
pair without one rather than guessing a hostname.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/v1/pair` | `{publicKey, market?}` (base64 X25519, 32 bytes) → `{deviceId, token, market, ingestUrl}` |
| `POST` | `/v1/ingest` | Bearer token. `{text, sender?, receivedAt?}` → `202`, or `204` if the message was not a transaction |
| `GET` | `/v1/sync` | Bearer token → `{items: [{id, epk, iv, ct}]}` |
| `POST` | `/v1/ack` | Bearer token. `{ids: [...]}` → `204`, rows deleted |
| `PATCH` | `/v1/device` | Bearer token. `{market}` → `{market}` |
| `DELETE` | `/v1/device` | Bearer token → `204`, device and queue erased |
| `GET` | `/v1/health` | → `{ok: true}` |

No email, no password, no account. Identity is a key the phone generated. Sync
is pull-then-acknowledge rather than delete-on-read, so a dropped response
loses nothing — the app asks again and the row is still there.

`204` on ingest is the common case and is not an error: the Shortcut fires on
every message matching the user's filter, and most of them are OTPs, promos and
delivery notices that are none of our business.

`PATCH /v1/device` exists so changing country does not mean re-pairing.
Re-pairing mints a new token, and the old one is baked into the user's Shortcut
where nothing in the app can reach it — capture would die silently while the app
looked healthy. For the same reason `pairRelay()` on the device reuses whatever
key is already in the keychain (which survives app deletion on iOS) instead of
minting a fresh one on reinstall.

`receivedAt` is honoured only when it is plausible: further than a day ahead or
a year behind falls back to now, because a hand-edited value would either park a
row in the future or trip the app's 45-day stale-due cutoff.

## Tests

`scripts/test/worker.test.js` runs the **real** `export default { fetch }`
against a real SQLite database built from this directory's `schema.sql` — D1 is
SQLite, so the adapter in that file renames methods and nothing else. Covered:
auth rejection on every authenticated route, cross-device isolation on sync and
ack, rate limiting and its sliding window, the `204` path, the sync/ack
round-trip including "not deleted on read", the 72-hour sweep, unpair, the
market pack changing how a message parses, sender attribution changing a debit
card into a credit card, timestamp handling, and the assertion that the message
text appears nowhere in the database.

`npm test` at the repo root also typechecks this directory against
`@cloudflare/workers-types`. It used to be excluded from typecheck and CI both.

## The Shortcut the user builds

In **Shortcuts → Automation → New → When I get a message**:

1. **Leave Sender empty.** UAE bank alerts arrive from alphanumeric sender IDs,
   and the trigger's Sender field only accepts contacts and phone numbers.
   Instead set **Message Contains** to `AED` — three characters that every UAE
   bank alert carries, covering every bank at once.
2. **Run Immediately.** This is the make-or-break step: left on "Run After
   Confirmation" the product silently does nothing and the user blames Wafra.
   Since iOS 17 an automation set to Run Immediately always posts a
   notification when it fires — there is no way to turn that off, and the setup
   flow has to set that expectation rather than let it be a surprise.
3. Action: **Get Contents of URL**
   - URL: the `ingestUrl` returned by pairing
   - Method: `POST`
   - Headers: `Authorization: Bearer <token>`, `Content-Type: application/json`
   - Request Body: JSON —
     `text` = Shortcut Input (message content),
     `sender` = Shortcut Input (sender),
     `receivedAt` = Current Date, ISO 8601

`sender` and `receivedAt` are optional on the wire, and a Shortcut built before
they existed keeps working — it just gets grey cards and the weaker duplicate
guard.

### Three limits to be honest about

**No history.** Android scans the whole inbox — that is where a typical user's
first few thousand transactions come from. Shortcuts fires only on *new*
messages, so an iOS user starts empty and accumulates from install day. This is
why statement-file import matters far more on iOS than on Android.

**`Message Contains: AED` is a coarse filter.** Every message containing "AED"
is POSTed here, bank or not. Nothing is stored for the ones that are not
transactions, but the text still left the device. That belongs in the setup flow
and in the App Store privacy label, stated plainly.

**Setup friction.** Four taps in Wafra, then roughly ten in an app most people
have never opened. A meaningful share will not finish it. The app must be
complete with manual entry regardless — both because that is honest, and because
App Review Guideline 4.2 is unkind to apps whose value depends on setup
performed outside them.

### Detecting a setup that never finished

If the user misses the "Run Immediately" tap, nothing works and there is no
signal at all. `relayStatus()` on the device reports `looksUnconfigured` — paired
long enough that a real user would have spent money, syncing successfully, and
still zero rows ever received — which is what a "your automation may still be
asking before it runs" repair card should hang off. Letting the ledger quietly
stay empty is the worst available outcome.

### Not verified from here

These need a real device before anything is promised in a listing:

- Whether Message automations fire at all for SMS routed into **Filter Unknown
  Senders**, where UAE bank alerts often land. If they do not, the iOS design
  fails for a large share of users. This is the highest-value unknown.
- Whether "Message Contains" matching is case-insensitive and substring
  (assumed yes).
- Whether silencing Shortcuts notifications suppresses the mandatory
  automation banner.
