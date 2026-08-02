# Wafra iOS capture relay

This Cloudflare Worker is the transport for Wafra's user-configured iOS
Shortcut. iOS does not expose the SMS inbox to third-party apps, so a personal
Message automation sends each selected bank alert to this relay. Android reads
permitted SMS and bank-app notifications on-device and does not use this
service.

## Retention and cryptography

The Worker parses an incoming alert, RFC822 email, or PDF in memory and
immediately discards the raw input. Raw message bodies, MIME, HTML, attachments,
and PDF bytes/text are never written to D1, logged, or returned.

Only the structured transaction is queued. Before storage it is sealed to the
device's X25519 public key with an ephemeral key and AES-GCM. The ephemeral
private key is discarded, so the Worker cannot decrypt the queued row. The app
acknowledges imported rows and the Worker deletes them; unacknowledged rows are
deleted after at most 30 days.

D1 also holds the device public key, hashes of its scoped bearer tokens,
pairing and last-seen timestamps, rate-limit counters, and an encrypted Expo
push token.
Push notifications contain only a `wafra.sync` wake marker—never a merchant,
amount, queue id, or other transaction data. Push registration is refreshed
whenever the app opens and has a 180-day stale-registration ceiling; Expo/APNs
invalidations remove dead tokens immediately. While a sealed row is waiting,
the Worker retries the collapsed wake-only signal twice an hour. Inactive device registrations
are removed after one year. Deleting the capture connection removes the device,
its queued rows, and rate-limit state.

Trusted additional phones join through a one-use, ten-minute invitation made
by an already-paired app. Each phone generates its own X25519 keypair and gets
separate ingest, sync, and admin credentials. The after-first-unlock background
path stores only the sync/ack bearer; device and vault management require the
foreground-only admin bearer. Future relay transactions are sealed once
per joined device, so no phone shares a private key and each acknowledges its
own queue independently. The relay does not keep an account-wide readable
ledger and therefore cannot backfill transactions that predate the join.
The first phone is the vault owner. Only it can invite or revoke family
devices; members may rename or disconnect themselves. The last owner cannot be
revoked while members remain—`DELETE /v1/vault` is the explicit whole-vault
deletion path.

Private Mode is local-only. Enabling it disconnects the iOS relay, so automatic
iOS bank-alert capture is unavailable until the user reconnects.

## One parser

`src/index.ts` imports `parseSms` from the app's
`src/lib/sms-parser.ts`. Parser changes and the UAE bank corpus therefore cover
both Android capture and the iOS relay. Do not fork the parser.

## Configure and deploy

Requirements: Node.js 22 or newer and an authenticated Wrangler session.

```bash
cd server
npm ci
npm run typecheck
npx wrangler login
npx wrangler d1 create wafra
npx wrangler secret put PUSH_TOKEN_KEY
npx wrangler secret put EXPO_ACCESS_TOKEN
```

Copy the returned D1 UUID into `wrangler.toml`. The checked-in placeholder is
intentional: `npm run migrate` and `npm run deploy` refuse to continue until a
real UUID is configured.

```bash
npm run migrate
npm run deploy
curl https://wafra-relay.<your-subdomain>.workers.dev/v1/health
```

Before production, add edge-level abuse protection for the unauthenticated
`/v1/pair` route (for example, a Cloudflare rate-limit rule). Authenticated
ingest also has per-device application limits and a bounded queue.

Configure the app at build time:

```bash
EXPO_PUBLIC_WAFRA_RELAY_URL=https://wafra-relay.<your-subdomain>.workers.dev
EXPO_PUBLIC_WAFRA_SHORTCUT_URL=https://www.icloud.com/shortcuts/<published-id>
```

Set `EXPO_PROJECT_ID` on the Worker to the same EAS project UUID passed to SDK
55's `Notifications.getExpoPushTokenAsync({ projectId })`. `PUSH_TOKEN_KEY` is
standard base64 containing exactly 32 random bytes. Enable enhanced push
security in EAS so `EXPO_ACCESS_TOKEN` is required by Expo's push API.
Set `EMAIL_DOMAIN` to a domain routed to this Worker with Cloudflare Email
Routing. `POST /v1/email-token` returns a separate inject-only `emailToken`
and `<emailToken>@<EMAIL_DOMAIN>` as `forwardingAddress`. Creating another one
rotates the address immediately; deleting it revokes forwarding. Never use the
app's admin or Shortcut ingest token as an email address.

`EXPO_PUBLIC_WAFRA_SHORTCUT_URL` must point to the published, credential-free
**Wafra Capture** Shortcut. Never put a device token or ingest URL in the
published Shortcut; the app supplies both as a one-paste setup code after
pairing. The exact action graph and physical-device release proof are specified
in [`../docs/ios-shortcut-spec.md`](../docs/ios-shortcut-spec.md).

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/v1/pair` | `{publicKey}` (base64 X25519, 32 bytes) → device credentials |
| `POST` | `/v1/ingest` | Ingest bearer and `{text, eventId?}` → `202`, or `204` when no transaction was found |
| `GET` | `/v1/sync` | Bearer token → encrypted queued items |
| `POST` | `/v1/ack` | Bearer token and `{ids}` → acknowledged rows deleted |
| `DELETE` | `/v1/device` | Bearer token → device and queued data deleted |
| `PUT` | `/v1/push` | Admin bearer + `{expoPushToken, projectId}` → register/refresh a wake-only token |
| `DELETE` | `/v1/push` | Admin bearer → remove wake-only delivery |
| `POST` | `/v1/device-invites` | Admin bearer → one-use ten-minute join token |
| `POST` | `/v1/join` | `{publicKey, inviteToken}` → independent credentials in the same vault |
| `GET` | `/v1/devices` | Admin bearer → safe device metadata, roles and current-device marker |
| `PATCH` | `/v1/devices/:id` | Owner (or self) + `{name}` → rename a device |
| `DELETE` | `/v1/devices/:id` | Owner (or member self) → revoke one device; last owner returns `409` |
| `DELETE` | `/v1/vault` | Owner bearer → explicitly erase the vault and every device queue |
| `GET` | `/v1/import/capabilities` | Admin bearer → truthful email/PDF formats and limits |
| `POST` | `/v1/email-token` | Admin bearer → create/rotate `{emailToken, forwardingAddress}` |
| `DELETE` | `/v1/email-token` | Admin bearer → revoke email forwarding |
| `POST` | `/v1/email/ingest` | Email bearer + `{text?, html?, eventId?}` → structured sealed rows |
| `POST` | `/v1/import/pdf` | Admin bearer + `application/pdf` bytes → structured sealed rows |

The server sets the receipt timestamp; it does not trust a client-provided
date. Pull-then-ack sync prevents data loss when a response is interrupted.
`204` from ingest is expected for OTPs, promotions, and other non-transactions.
The published Shortcut should add one random `eventId` per Message automation
run and reuse it if its HTTP action retries. For legacy `{text}` calls, the
Worker uses a normalized-body fallback. Either form is suppressed for 15
minutes using an HMAC keyed by the unstored ingest token, so D1 contains
neither raw text nor a plain body hash.

After a parsed row is durably queued, the Worker sends Expo a silent,
five-minute-TTL notification with `_contentAvailable: true`, normal priority,
collapse id `wafra-relay-sync`, and only `{kind: "wafra.sync", v: 1}` in
`data`. The app must define its SDK 55 notification task at module scope and
register it before relying on background delivery. APNs background delivery is
best-effort, so foreground sync remains the recovery path.

## Email and PDF supplement

Cloudflare Email Routing calls the Worker's email handler for
`<emailToken>@<EMAIL_DOMAIN>`. `postal-mime` parses RFC822/MIME in memory;
plain text is preferred and HTML is reduced to inert text before it reaches the
same bank-alert parser. PDF attachments take the same route as direct PDF
uploads. The raw email, HTML and attachments fall out of scope when the request
ends; only individually device-sealed structured rows reach D1.

`POST /v1/import/pdf` accepts at most 5 MiB and 100 pages, and never echoes
extracted text or rows. `unpdf` extracts text with its serverless PDF.js build. The first
statement-row contract is intentionally conservative: a text row needs a
valid UAE-style date, description, AED amount and an explicit `DR`/`CR` or
`debit`/`credit` marker. A scanned document, encrypted file, or table whose
direction exists only as visual column position returns `422`; Wafra does not
guess whether money came in or went out. `GET /v1/import/capabilities` lets the
client present this support accurately before upload.

## User setup

The app guides the user through:

1. Connect Wafra and copy the generated one-paste setup code.
2. Install **Wafra Capture** from the published iCloud Shortcut link and paste
   the setup code.
3. In Shortcuts, create a personal **Message** automation, select the existing
   bank conversations listed by Wafra,
   choose **Run Immediately**, and run **Wafra Capture** with the message as
   Shortcut Input.
4. Run the in-app pipe test and wait for the encrypted result to sync.

Sender labels vary by carrier and bank. Apple owns the sender picker, so the
user may need to select an existing bank conversation or saved contact.

The synthetic test proves the installed Shortcut, relay, encryption, and app
sync path. It does not mark Message automation active; only a parsed bank row
staged by the headless notification task records that stronger proof. A
received relay item can arrive while the app is closed. After the
first unlock following a reboot, a silent SDK 55 push can stage the parsed row
in a dedicated encrypted SQLCipher inbox whose Keychain key is available to
background execution. The foreground then folds that inbox into the protected
main ledger. APNs is best-effort and iOS suppresses silent wakes after the user
force-quits the app, so foreground sync remains the recovery path.

Before release, prove the closed/locked path on a signed physical device: send
a real bank alert, wait for the Message automation and APNs wake, enable
airplane mode before opening Wafra, then verify the row is present. Repeat from
a reboot after one unlock and document force-quit recovery. Simulator source
inspection is not release evidence.
