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
trusted devices) and `src/lib/relay-crypto.ts` (the counterpart to
`src/crypto.ts`'s seal). The two halves are asserted against each other in
`scripts/test/worker.test.js` and `scripts/test/relay.test.js` — the real
`seal()` runs and the real shipping `openSealed()` opens it — so a change to
either that breaks the other fails in CI rather than on a user's phone.

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
| `receivedAt` | The app's strong duplicate guard fingerprints the message timestamp together with the amount. While this was the relay's own receipt time, a Shortcut that fired twice produced two different fingerprints and the same charge landed twice. | A timestamp column is a record of when each device receives bank messages. |
| `market` | Which pack the row was parsed under, so a mis-set country is diagnosable from the phone rather than only from the wire. | It is a fact about the user's country, and it costs nothing to keep it sealed. |

`sender` is validated by `src/ingest-row.ts` before it is used. A malformed or
over-long value is **discarded, never truncated**, while the transaction is
still parsed without bank identity — truncating could store the first eighty
characters of a bank message in a field meant to hold a bank name, while
rejecting the request would silently lose the whole alert.
`receivedAt` is honoured only when it is plausible: further than a day ahead or
a year behind falls back to now, because a hand-edited value would either park a
row at the top of the ledger forever or trip the app's 45-day stale-due cutoff.

There is deliberately **no digest of the message text** anywhere, sealed or not.
Shortcut retries are collapsed by `ingest_receipts`, which stores an HMAC keyed
by the ingest token — and that token is never stored here, so a D1 dump cannot
be searched against a guessed bank alert the way a bare SHA-256 could.

None of it is a column, an index, or a log line. The claim the service makes is
unchanged: **it cannot read what it stored.**

### The one row that is not sealed: the push registration

A queued row is useless until the phone comes for it, and a phone that only
comes when the user opens the app is not "automatic". So a device may register
an Expo push token (`PUT /v1/push`) and the Worker sends a **content-available
push with no transaction data in it** — `{kind: "wafra.sync", v: 1}`, no title,
no body, no amount, no merchant, no queue id — to wake it.

This is the one place the privacy story changes, and it changes honestly:

- Apple and Expo learn **that** a row was queued for a device, and when. They
  cannot learn what it says; the row is fetched sealed over `/v1/sync`
  afterwards. Putting the amount or merchant in the push would hand two third
  parties a readable transaction feed.
- The token is stored as AES-GCM ciphertext under `PUSH_TOKEN_KEY`, with the
  AAD `wafra/v1/push-token`. Be precise about what that buys: it protects a
  **database dump**, not the service — the Worker holds the key and can decrypt
  what it needs to send. It is still, in effect, a stable identifier for a
  phone, and it is the only one here.
- It is **optional**. A device that never registers one still syncs on
  foreground and on its background task, just later. Declining notifications
  keeps the strong version of the claim available to anyone who wants it.
- Registrations expire after 180 days and are refreshed whenever the app opens.
  A token Expo reports as `DeviceNotRegistered` is deleted immediately.
- Wakes are coalesced to at most one per device per 10 minutes. Apple throttles
  apps past roughly two or three background pushes an hour, and the failure mode
  of exceeding it is invisible: the OS simply stops delivering. The window is
  claimed in the database *before* the send, so a hung send cannot let a second
  one start, and it is what makes the half-hourly retry cron safe.

Typical retention is the seconds between a text arriving and the phone syncing.
The hard ceiling is **30 days**, after which unsynced rows are swept by the
cron in `scheduled()` — not left to a client that may never come back. That one
number has to agree in three places: `schema.sql`, the `DELETE FROM queue`
in `src/index.ts`, and this paragraph. A device silent for a year with an empty
queue is deleted outright.

Destructive admin routes keep a 30-day idempotency receipt containing only the
SHA-256 admin-token digest and exact route. This closes the failure window where
the relay returns `204` but iOS cannot immediately clear Keychain: the same
request can prove the completed deletion again without restoring the device,
queue, or Shortcut authority. The cron deletes expired receipts.

Note what those 30 days are *of*: rows nobody can read, including us. Services
that keep full message bodies for a month can re-run a fixed parser over stored
messages and repair a user's history retroactively, which we cannot — that is
the real cost of this design, and it was paid deliberately. A readable archive
of UAE bank messages is a breach target, and "we cannot read it" is the
product's main claim.

**One thing that must be said out loud in the app, not just here.** The
Shortcut's filter is coarse (see below), so messages that are not transactions
*do* reach this Worker. Most are parsed, return `204`, and leave nothing behind.
A narrowly grounded UAE/Saudi bank alert that the launch parser cannot file may
instead become a sealed, structured review row; its text and sender are still
discarded. In both cases the text left the phone temporarily. Any onboarding
copy telling an iPhone user "there is no server" is false and has to be
rewritten before this ships.

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

A phone joining an existing vault inherits the vault's pack rather than
imposing its own: two phones on the same ledger parsing the same family card
under different packs would file one purchase twice, with two amounts.

## Configure and deploy

**[`DEPLOY.md`](./DEPLOY.md) is the authoritative sequence** — what the owner
must supply, what each command does, how to verify the deploy against a real
endpoint, how to roll it back, and what it costs. What follows is the short
form of the same thing.

Requirements: Node.js 22 or newer and an authenticated Wrangler session.

```bash
cd server
npm ci
npm run typecheck        # tsc against @cloudflare/workers-types; no wrangler needed
npx wrangler login

npm run setup            # creates or finds the "wafra" D1 database, writes its
                         # database_id into wrangler.toml, and applies schema.sql
npx wrangler secret put PUSH_TOKEN_KEY
npx wrangler secret put EXPO_ACCESS_TOKEN
npm run deploy
```

`npm run setup` is idempotent — run it on a machine that already has the
database and it finds the existing one. A D1 binding is resolved at build time
and there is no environment-variable substitution for it, which is why the id
has to be written into `wrangler.toml` rather than injected. `npm run deploy`
runs `node scripts/d1.mjs check` first (as `predeploy`) and refuses while the id
is still the placeholder, so a fresh clone fails with a sentence instead of an
opaque Cloudflare API error.

`npm run typecheck` deliberately does **not** shell out to `wrangler types
--check`. That is what made `npm run check:server` exit 127 on a clean
checkout — it needs a wrangler binary and a login before it can tell you
anything. `@cloudflare/workers-types` is a real dependency instead, so the
Worker is typechecked by `npm test` at the repo root with nothing installed but
npm packages.

If you would rather do it by hand:

```bash
npx wrangler d1 create wafra          # copy the printed uuid
# paste it into wrangler.toml -> [[d1_databases]] database_id
npx wrangler d1 execute wafra --remote --file=./schema.sql
npx wrangler deploy
```

**Upgrading a database created before the market and coalescing columns
existed** — SQLite has no `ADD COLUMN IF NOT EXISTS`, so these are commented out
in `schema.sql` and run once, by hand:

```bash
npx wrangler d1 execute wafra --remote \
  --command "ALTER TABLE devices ADD COLUMN market TEXT NOT NULL DEFAULT 'AE'"
npx wrangler d1 execute wafra --remote \
  --command "ALTER TABLE push_registrations ADD COLUMN push_sent_at INTEGER NOT NULL DEFAULT 0"
```

Existing devices keep parsing under AE, which is what they were doing anyway.

**Secrets.** `PUSH_TOKEN_KEY` is standard base64 containing exactly 32 random
bytes; without it the Worker registers no push tokens and sends no wakes, and
capture still works on foreground sync. Set `EXPO_PROJECT_ID` to the same EAS
project UUID the app passes to SDK 55's
`Notifications.getExpoPushTokenAsync({ projectId })` — a mismatch is rejected at
registration rather than discovered as silence. Expo's push service accepts
unauthenticated sends unless the project has enhanced security enabled, in which
case `EXPO_ACCESS_TOKEN` is required; enable it. Set `EMAIL_DOMAIN` to a domain
routed to this Worker with Cloudflare Email Routing to turn on the email
supplement.

Configure the app at build time:

```bash
EXPO_PUBLIC_WAFRA_RELAY_URL=https://wafra-relay.<your-subdomain>.workers.dev
EXPO_PUBLIC_WAFRA_SHORTCUT_URL=https://www.icloud.com/shortcuts/<published-id>
```

`src/lib/relay.ts` reads the first and refuses to pair without one rather than
guessing a hostname. The second must point at the published, credential-free
**Wafra Capture** Shortcut — never one with a device token or ingest URL baked
in; the app supplies both as a one-paste setup code after pairing. The exact
action graph and the physical-device release proof are in
[`../docs/ios-shortcut-spec.md`](../docs/ios-shortcut-spec.md).

Verify:

```bash
curl https://wafra-relay.<your-subdomain>.workers.dev/v1/health
# {"ok":true}
```

Cloudflare's free tier covers early usage comfortably: 100k Worker requests a
day, and D1's free allowance is far beyond what a queue that empties itself
will ever hold. Add an edge rate-limit rule for the unauthenticated `/v1/pair`
route before production; the Worker's own global backstop is a second line, not
the first.

## API

Every token below is scope-specific. The Shortcut receives **ingest authority
only**: it cannot read the queue, acknowledge it, or delete anything. The
background sync has its own least-privilege bearer because it must be usable
while the phone is locked, and destructive management needs the admin bearer,
which stays in the foreground app.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/v1/pair` | `{publicKey, market?, deviceName?}` (base64 X25519, 32 bytes) → `{deviceId, ingestToken, syncToken, adminToken, market}` |
| `POST` | `/v1/ingest` | Ingest bearer + `{text, sender?, receivedAt?, eventId?}` → `202` for a parsed or safe structured-review row, or `204` when intentionally ignored |
| `GET` | `/v1/sync` | Sync bearer → `{items: [{id, epk, iv, ct}]}` |
| `POST` | `/v1/ack` | Sync bearer + `{ids}` → `204`, rows deleted |
| `PATCH` | `/v1/device` | Admin bearer + `{market}` → `{market}` |
| `DELETE` | `/v1/device` | Admin bearer → `204`, device and queue erased |
| `PUT` | `/v1/push` | Admin bearer + `{expoPushToken, projectId}` → register/refresh a wake-only token |
| `DELETE` | `/v1/push` | Admin bearer → remove wake-only delivery |
| `POST` | `/v1/device-invites` | Owner bearer → one-use ten-minute join token |
| `POST` | `/v1/join` | `{publicKey, inviteToken, deviceName, market?}` → independent credentials in the same vault |
| `GET` | `/v1/devices` | Admin bearer → safe device metadata, roles and current-device marker |
| `PATCH` | `/v1/devices/:id` | Owner (or self) + `{name}` → rename a device |
| `DELETE` | `/v1/devices/:id` | Owner (or member self) → revoke one device; the last owner returns `409` |
| `DELETE` | `/v1/vault` | Owner bearer → explicitly erase the vault and every device queue |
| `GET` | `/v1/import/capabilities` | Admin bearer → truthful email/PDF/CSV formats and limits |
| `POST` | `/v1/email-token` | Admin bearer → create/rotate `{emailToken, forwardingAddress}` |
| `DELETE` | `/v1/email-token` | Admin bearer → revoke email forwarding |
| `POST` | `/v1/email/ingest` | Email bearer + `{text?, html?, eventId?}` → structured sealed rows |
| `POST` | `/v1/import/pdf` | Admin bearer + `application/pdf` bytes → structured sealed rows |
| `POST` | `/v1/import/csv` | Admin bearer + CSV/TSV bytes → accepted/rejected counts and structured sealed rows |
| `POST` | `/v1/feedback` | **No bearer** + `{text, appVersion, platform, locale?, diagnostic?}` → `202 {id, dispatched}` |
| `GET` | `/v1/feedback/:id` | Feedback-read bearer → the one item, for the agent that will fix it |
| `GET` | `/v1/health` | → `{ok: true}` |

No email, no password, no account. Identity is a key the phone generated. Sync
is pull-then-acknowledge rather than delete-on-read, so a dropped response
loses nothing — the app asks again and the row is still there.

`204` on ingest is the common case and is not an error: the Shortcut fires on
every message matching the user's filter, and most of them are OTPs, promos and
delivery notices that are none of our business. A `202` review fallback is not
an imported transaction; the phone must show and confirm it explicitly.

`PATCH /v1/device` exists so changing country does not mean re-pairing.
Re-pairing mints a new ingest token, and the old one is baked into the user's
Shortcut where nothing in the app can reach it — capture would die silently
while the app looked healthy.

The published Shortcut should send one random `eventId` per automation run and
reuse it if its HTTP action retries; a legacy `{text}` call falls back to a
normalized-body fingerprint. Either form is suppressed for 15 minutes by the
keyed receipt described above.

Forwarded email has a separate inject-only credential for a specific reason:
SMTP headers expose the destination address outside the app/relay TLS
connection, so it must not be the same secret as the Shortcut's.

## Feedback, and the one exception to "it keeps nothing"

`POST /v1/feedback` is the only path here that stores prose, and the only write
path with no bearer token in front of it. Both are deliberate.

**Why it stores text at all.** Everything above is about data the user never
chose to send: an SMS their bank pushed at them, captured by an automation
while they were asleep. Feedback is the opposite — they opened a screen, typed
a sentence and pressed send. Refusing to keep it would protect nobody; it would
only mean nobody can report a parser bug.

**Why it has no token.** Android scans the inbox on-device and never touches
this relay, so the users most likely to *find* a parser bug have no device row
here to authenticate as. Requiring pairing would silently exclude exactly the
reports worth having.

What that costs, all enforced and all covered by tests:

| | |
| --- | --- |
| **Retention** | 14 days, half the queue's 30. `expires_at` is written at insert, checked on every read, and swept by the cron — whether or not an agent ever looked at it, whether or not a PR was opened. There is no "keep this one" path, because the moment there is one this stops being a buffer and becomes an archive of things users typed about their bank accounts. |
| **Rate limit** | 60 writes/hour globally, plus a separate **5 agent runs/hour** budget. A global window, same shape as `/v1/pair`, because a per-IP bucket would mean storing an IP. Cloudflare's edge rate limiting stays the production first line — it is the only layer that sees an address without this service keeping one. |
| **Size** | 32 KiB whole body, 4 000 code points of text, 16 KiB of serialized diagnostic. **Refused, never truncated**: `413 too_large` / `400 text_too_long` / `413 diagnostic_too_large`. A diagnostic that does not fit is a client sending rows where it should send counts. |
| **Contents** | No IP, no device id, no token, no fingerprint. An anonymous row. |
| **Logging** | Nothing in the request path logs anything at all; `server/test/schema.test.cjs` asserts the absence. |

Under a flood the two budgets separate cheap from expensive: every accepted
report is still stored in full, but past 5 an hour the row records
`dispatch_status = 'skipped_budget'` and no agent runs. Nothing is lost — a
maintainer re-fires any id by hand through the workflow's `workflow_dispatch`
input. Worst case is 120 agent runs a day, which is a number a human notices on
a dashboard rather than on an invoice.

An attempted dispatch that fails at the network or GitHub boundary is retried
by the half-hour cron for up to two hours. The same feedback id is reused, and
the workflow's concurrency key prevents simultaneous duplicate runs.

When a tester explicitly sends a redacted parser-research report, the Worker
fires a GitHub `repository_dispatch` (`wafra-feedback`) carrying **the id and
nothing else**. Ordinary feedback stays human-only. The research screen masks
every digit, aliases unknown senders, masks recipient/merchant spans, replaces
words outside a strict financial grammar, removes timestamps, and shows the
complete result before confirmation. It explicitly names GitHub Actions and
Anthropic Claude. `.github/workflows/feedback-agent.yml` then fetches the item
back through the read route. Wafra's D1 copy expires within 14 days; GitHub and
Anthropic apply their own retention policies. The workflow can publish code and
synthetic tests only in a **public draft** pull request; it never merges and its
verbatim gate forbids copying the report into the diff or PR body. A
`client_payload` is readable by anyone with access to the repository's Actions
data and is kept in the run record, but it contains only the report id. With
`GITHUB_DISPATCH_TOKEN` or `GITHUB_REPOSITORY` unset the feedback is still
stored and the row says `skipped_unconfigured` — nothing 500s. See the secrets
block at the end of `wrangler.toml` for exactly which token, which scopes, and
who sets which half.

## Email and statement supplements

Cloudflare Email Routing calls the Worker's email handler for
`<emailToken>@<EMAIL_DOMAIN>`. `postal-mime` parses RFC822/MIME in memory;
plain text is preferred and HTML is reduced to inert text before it reaches the
same bank-alert parser. PDF, CSV, and TSV attachments take the same routes as
direct uploads.
The raw email, HTML and attachments fall out of scope when the request ends;
only individually device-sealed structured rows reach D1.

`POST /v1/import/pdf` accepts at most 5 MiB and 100 pages and never echoes
extracted text or rows. The row contract is deliberately conservative: a text
row needs a valid date, a description, an amount and an explicit `DR`/`CR` or
`debit`/`credit` marker. A scan, an encrypted file, or a table whose direction
exists only as visual column position returns `422` — Wafra does not guess
whether money came in or went out. This path is why the "no history" limit
below is survivable on iOS.

`POST /v1/import/csv` accepts at most 1 MiB and 200 data rows. It supports
comma-, tab-, and semicolon-delimited UTF-8 exports with English or Arabic
named columns. Each accepted row needs a valid date and description, plus one
of: separate debit/credit columns, an amount with a direction column, or an
explicitly signed amount. Quoted fields and Arabic-Indic digits are supported.
Malformed rows, duplicate rows, currency mismatches, and unsigned ambiguous
amounts are counted as rejected; they are never inferred from column position.

## Tests

`scripts/test/worker.test.js` runs the **real** `export default { fetch }`
against a real SQLite database built from this directory's `schema.sql` — D1 is
SQLite, so the adapter in that file renames methods and nothing else.
`scripts/test/relay.test.js` drives the **real** `src/lib/relay.ts` with only
the native surfaces stubbed, and ends by putting the two together: pair against
the real Worker, POST a bank SMS as the Shortcut does, collect the sealed row,
open it, file it, acknowledge it, and assert the message text is nowhere in the
database.

`server/test/*.cjs` cover the PDF/CSV/email parser, the push-token encryption and
this schema. They run from the repo root's `npm test` — they used to run only
from `npm --prefix server test`, which nothing called.

`npm test` at the root also typechecks this directory against
`@cloudflare/workers-types`. It used to be excluded from typecheck and CI both.

## The Shortcut the user builds

In **Shortcuts → Automation → New → When I get a message**, then either:

- select the existing bank conversations Wafra lists, which keeps the filter
  narrow and is much better for privacy; or
- leave Sender empty and set **Message Contains** to `AED`, if the trigger's
  Sender field turns out to accept only contacts and phone numbers — UAE bank
  alerts arrive from alphanumeric sender IDs, which are not contacts.

**Which of those two is actually available has not been verified on a physical
device, and nothing may be claimed in a store listing until it is.** They differ
in exactly the way that matters: the first sends only bank messages to this
Worker, the second sends every message containing "AED".

Then, whichever trigger is used:

1. **Run Immediately.** This is the make-or-break step: left on "Run After
   Confirmation" the product silently does nothing and the user blames Wafra.
   Since iOS 17 an automation set to Run Immediately always posts a
   notification when it fires — there is no way to turn that off, and the setup
   flow has to set that expectation rather than let it be a surprise.
2. Action: **Get Contents of URL**
   - URL: the `ingestUrl` the app shows after pairing
   - Method: `POST`
   - Headers: `Authorization: Bearer <ingest token>`, `Content-Type: application/json`
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
why the statement-file and forwarded-email import above matters far more on iOS
than on Android.

**A `Message Contains` filter is coarse.** If that is the trigger that works,
every message containing "AED" is POSTed here, bank or not. Nothing is stored
for the ones that are not transactions, but the text still left the device.
That belongs in the setup flow and in the App Store privacy label, stated
plainly.

**Setup friction.** Four taps in Wafra, then roughly ten in an app most people
have never opened. A meaningful share will not finish it. The app must be
complete with manual entry regardless — both because that is honest, and because
App Review Guideline 4.2 is unkind to apps whose value depends on setup
performed outside them.

### Detecting a setup that never finished

If the user misses the "Run Immediately" tap, nothing works and there is no
error anywhere — the absence of rows is the only signal, so the app has to read
it. Pairing therefore has three states, not two: `paired` (credentials exist),
`configured` (the user says the automation is built) and `verified` (a
synthetic probe travelled Shortcut → relay → encrypted sync).

`verified` still only proves the *pipe*. The stronger proof is a separate
timestamp written exclusively by the headless task after it stages a parsed
**bank** row with the UI uninvolved — that is the only evidence a Message
automation is actually firing. A phone that is paired and verified but has never
recorded that proof is the case a "your automation may still be asking before it
runs" repair card should hang off. Letting the ledger quietly stay empty is the
worst available outcome.

### How fast a row actually lands

Three layers, each of which degrades to the one below it without losing a
transaction:

| Layer | Latency | Dies when |
| --- | --- | --- |
| Content-available push from this Worker | seconds | notifications declined, no `EXPO_PROJECT_ID`/`PUSH_TOKEN_KEY` configured, or the app was force-quit from the switcher |
| The app's periodic background task | minutes to overnight — iOS decides | Background App Refresh off, Low Power Mode, force-quit |
| Foreground sync (launch, background→active, pull-to-refresh) | when the app is opened | never |

The floor is the third layer, and it is the one that makes the design correct
rather than merely fast: rows are not deleted until the phone acknowledges them
and the queue holds them for 30 days, so **as long as Wafra is opened once a
month, nothing is lost**. Everything above that line is latency, not
correctness.

Only the foreground layer writes the main ledger. A background wake stages the
opened rows into a separate encrypted inbox and stops there; the app folds that
into the ledger on its next render and acknowledges afterwards. A headless task
that wrote the ledger directly would be silently overwritten by the store's own
persister.

### Not verified from here

These need a real device before anything is promised in a listing:

- **Which Message-automation trigger actually works** for UAE alphanumeric
  sender IDs (see above). This is the highest-value unknown, and the privacy
  copy depends on the answer.
- Whether Message automations fire at all for SMS routed into **Filter Unknown
  Senders**, where UAE bank alerts often land. If they do not, the iOS design
  fails for a large share of users.
- Whether silencing Shortcuts notifications suppresses the mandatory
  automation banner.
- **The wake layers have never run on hardware.** Content-available push needs
  APNs and a physical device, and iOS background tasks do not run on simulators
  at all. The crypto and the routes are observed — `relay.test.js` drives the
  real client through the real Worker end to end — but *delivery* is read from
  Apple's and the SDK 55 docs, not seen.
- Whether Apple's throttle tolerates one wake per device per 10 minutes on a
  heavy day. If it does not, the symptom is invisible: iOS simply stops
  delivering, and only the foreground layer would still be filling the ledger.
