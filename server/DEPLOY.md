# Deploying the relay

The iOS half of Wafra does not work until this is done. Android never touches
it. There is exactly one thing to deploy — a Cloudflare Worker plus the one D1
database it binds to — and it needs a Cloudflare account, which is why it
cannot be done from a development checkout.

Everything here was walked through by reading `wrangler` 4.116.0's own command
definitions in `server/node_modules`. Where Cloudflare's behaviour could not be
observed without an account, this document says so rather than guessing.

## What you must supply

| Thing | Why | Cost |
| --- | --- | --- |
| A Cloudflare account | Owns the Worker and the D1 database | Free tier is enough — see [Cost](#cost) |
| A browser, once, for `wrangler login` | Wrangler stores an OAuth token locally | — |
| Node.js 22 or newer | `server/package.json` `engines` | — |
| An EAS project UUID | Push wakes are rejected unless it matches the app's | — |
| *(optional)* A domain on Cloudflare | Only for the forwarded-email supplement | Registration only |

Nothing else. No database server, no container, no CI account, no secrets
manager. Two secrets are typed into `wrangler secret put` and never land in the
repository.

## The sequence

Run all of it from the repository root. Each command is described below it;
none of them is interactive except where it says so.

```bash
npm --prefix server ci
npx --prefix server wrangler login
npm --prefix server run setup
npm --prefix server run deploy
```

That is the whole deployment. In detail:

### 1. `npm --prefix server ci`

Installs wrangler and the two runtime dependencies (`postal-mime`, `unpdf`)
from `server/package-lock.json`. Everything after this point runs the wrangler
binary in `server/node_modules`, never a globally installed one, so the version
is the one this repository was tested against.

### 2. `npx --prefix server wrangler login`

Opens a browser and stores an OAuth token in your user profile. Do this as its
own step: the scripts below run wrangler with stdin closed, which makes it
non-interactive, and a non-interactive wrangler cannot start a login — it
errors instead of hanging, but it errors.

On a headless machine, set `CLOUDFLARE_API_TOKEN` instead of logging in. The
token needs permission to edit Workers and D1.

**If your login can see more than one Cloudflare account**, also set
`CLOUDFLARE_ACCOUNT_ID` (or add `account_id = "..."` to `server/wrangler.toml`).
Wrangler refuses to guess and, with stdin closed, cannot ask. `npm run setup`
warns you about this before it creates anything.

### 3. `npm --prefix server run setup`

This is `server/scripts/d1.mjs setup`. It:

1. checks wrangler is installed and logged in, and stops with a sentence if not;
2. runs `wrangler d1 list --json` and looks for a database named `wafra`;
3. creates one with `wrangler d1 create wafra` if there is none;
4. writes the uuid into `server/wrangler.toml` as `database_id`, then reads the
   file back to confirm the write took;
5. applies `server/schema.sql` with `wrangler d1 execute wafra --remote --file=... --yes`.

It is idempotent and safe to re-run. Every step is a lookup before it is a
creation, `schema.sql` is `CREATE TABLE IF NOT EXISTS` throughout, and a
failure at step 5 leaves the database and its recorded id intact so a re-run
only retries the schema.

**`server/wrangler.toml` is modified by this step and the change must be
committed** (or re-run on every machine that deploys). A D1 binding is resolved
at build time and wrangler has no environment-variable substitution for it, so
the id cannot be injected — it has to be in the file. The id is not a secret;
it is useless without credentials for the account that owns it.

### 4. Secrets, before the first deploy

```bash
cd server
npx wrangler secret put PUSH_TOKEN_KEY     # paste: openssl rand -base64 32
npx wrangler secret put EXPO_ACCESS_TOKEN  # from expo.dev, if EAS enhanced push security is on
```

Both prompt for the value on stdin and print nothing back. `PUSH_TOKEN_KEY`
must be standard base64 of exactly 32 random bytes — `openssl rand -base64 32`
produces one.

Because the Worker does not exist yet at this point, wrangler will ask *"There
doesn't seem to be a Worker called `wafra-relay`. Do you want to create a new
Worker with that name and add secrets to it?"* — answer yes. It creates an
empty draft that step 5 then overwrites with the real code.

Skipping both secrets is a supported configuration: the Worker registers no
push tokens and sends no wakes, and capture still works on foreground and
background sync, just later. It is not a broken deploy.

Then set the two non-secret values by uncommenting the `[vars]` block at the
bottom of `server/wrangler.toml`:

- `EXPO_PROJECT_ID` — the same EAS project UUID the app passes to
  `Notifications.getExpoPushTokenAsync({ projectId })`. A mismatch is rejected
  at registration rather than discovered later as silence.
- `EMAIL_DOMAIN` — only if you have set up Cloudflare Email Routing to this
  Worker. Leave it out otherwise; the email supplement reports itself disabled.

`wrangler secret put` also works for these two, if you would rather not have
them in the file. The Worker reads them the same way either way.

### 5. `npm --prefix server run deploy`

`predeploy` runs `node scripts/d1.mjs check` first, which exits 1 while
`database_id` is still `REPLACE_WITH_D1_DATABASE_ID`, and npm then refuses to
run `deploy` at all. That guard is verified: with the placeholder in place the
check exits 1 with the message telling you to run `npm run setup`, and npm does
not proceed to the deploy script when a `pre` script fails.

Two things the guard does *not* cover, so that they are not a surprise:

- `npx wrangler deploy` run directly bypasses it. Use the npm script.
- `npm run build:check` (`wrangler deploy --dry-run`, part of
  `npm run check:server`) passes with the placeholder still present, because a
  dry run bundles the code without resolving the D1 id against the API. CI
  staying green on a fresh clone is deliberate; it is not evidence that the
  relay is configured.

A first deploy on an account with no `workers.dev` subdomain will ask *"Would
you like to register a workers.dev subdomain now?"*. Say yes unless you are
attaching a custom route. With stdin closed it defaults to no and fails, so run
this one in a real terminal.

On success wrangler prints the deployed URL. It will be:

```
https://wafra-relay.<your-subdomain>.workers.dev
```

`wafra-relay` is the `name` in `wrangler.toml`; `<your-subdomain>` is the one
you just registered. `wrangler.toml` declares no routes, and with no routes
wrangler enables the `workers.dev` URL by default.

## Verify it worked

Three checks, weakest to strongest. Do all three.

**The Worker is up** — unauthenticated, touches nothing:

```bash
curl -sS https://wafra-relay.<your-subdomain>.workers.dev/v1/health
# {"ok":true}
```

Note what this does *not* prove: `/v1/health` returns a constant and never
touches D1. A green health check with a broken binding is possible.

**The schema is really in the remote database:**

```bash
cd server
npx wrangler d1 execute wafra --remote --command \
  "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
```

Expect these eight: `device_invites`, `devices`, `ingest_limits`,
`ingest_receipts`, `pair_limits`, `push_registrations`, `queue`, `vaults`.
D1 keeps internal tables of its own (`_cf_KV` and similar) in the same
catalogue, so extra names beginning with an underscore are normal. There is no
messages table — that is the design, not a missed migration.

**The Worker can actually reach D1** — pairs a throwaway device, then deletes
it. This is the only check that exercises the binding:

```bash
URL=https://wafra-relay.<your-subdomain>.workers.dev
PK=$(node -e "const{generateKeyPairSync}=require('crypto');\
console.log(generateKeyPairSync('x25519').publicKey\
.export({type:'spki',format:'der'}).subarray(-32).toString('base64'))")

curl -sS -X POST "$URL/v1/pair" -H 'content-type: application/json' \
  -d "{\"publicKey\":\"$PK\",\"deviceName\":\"deploy smoke test\"}"
# {"deviceId":"...","ingestToken":"...","syncToken":"...","adminToken":"...","market":"AE"}

curl -sS -i -X DELETE "$URL/v1/device" -H "authorization: Bearer <adminToken>"
# HTTP/2 204
```

The delete removes the device, its queue and its now-empty vault, so the
database is back where it started. A freshly paired device is the only one in
its vault, so it deletes cleanly rather than returning `409 last_owner`.

## Point the app at it

The deployed base URL is the only value the app needs from this deployment. It
is a build-time public setting — Expo inlines it — so **changing it requires a
new build**, not a config push.

| Variable | Value | Read by |
| --- | --- | --- |
| `EXPO_PUBLIC_WAFRA_RELAY_URL` | `https://wafra-relay.<your-subdomain>.workers.dev` | `src/lib/relay.ts` → `DEFAULT_RELAY_URL` |
| `EXPO_PUBLIC_WAFRA_SHORTCUT_URL` | `https://www.icloud.com/shortcuts/<published-id>` | `src/lib/relay.ts` → `DEFAULT_SHORTCUT_URL` |
| `EXPO_PUBLIC_WAFRA_PROJECT_ID` | the EAS project UUID, same one as `EXPO_PROJECT_ID` on the Worker | `scripts/check-release-config.mjs`, push registration |

Rules the app enforces on the URL, from `normalizeRelayBaseUrl`:

- HTTPS only (an `http://localhost` origin is accepted in dev builds only);
- no username, password, query string or fragment;
- a trailing slash is stripped, so `.../` and `...` are the same value.

There is deliberately **no fallback**. A build with no
`EXPO_PUBLIC_WAFRA_RELAY_URL` refuses to pair rather than posting bank messages
at a hostname that merely looks plausible. `npm run release:check` gates all
three, plus a real D1 uuid in `server/wrangler.toml`, among its other release
gates.

**These variables are not wired into `eas.json` yet.** Its `production` build
profile has no `env` block, so a cloud build will not pick them up from your
shell. Before the first release build, either add them to the profile in
`eas.json` or define them as EAS environment variables in the project. Local
builds can export them in the shell.

## Rolling back

Deploys are versioned server-side; nothing here is destructive to data.

```bash
cd server
npx wrangler deployments list    # the 10 most recent
npx wrangler versions list       # the 10 most recent versions, with ids
npx wrangler rollback [version-id] -m "why"
```

`wrangler rollback` with no version id rolls back to the previous one and
prompts for confirmation (`-y` accepts). Code rolls back; **the database does
not follow it**. The schema is additive and `IF NOT EXISTS` throughout, so an
older Worker runs fine against a newer database — but that stops being true the
day someone adds a destructive migration.

For the data side there are two separate tools, and they are not the same thing
as a code rollback:

```bash
npx wrangler d1 export wafra --remote --output=wafra-backup.sql   # take a copy first
npx wrangler d1 time-travel info wafra                            # what restore points exist
npx wrangler d1 time-travel restore wafra --timestamp 2026-08-06T09:00:00Z
```

Time Travel restores a D1 database to a point in time; wrangler's own help says
a timestamp "within the last 30 days", and the retention you actually get may
depend on your plan — check
<https://developers.cloudflare.com/d1/reference/time-travel/> before relying on
it. Nothing in a normal deploy needs either command; they are here so that the
answer to "the migration was wrong" is not improvised.

Secrets survive a rollback — they belong to the Worker, not to a version.
Rotating one is `wrangler secret put` again; re-run `npm run deploy` afterwards
if you want to be certain the running version has picked it up.

To take the relay down entirely: `npx wrangler delete` removes the Worker (the
D1 database survives), and `npx wrangler d1 delete wafra` removes the database
and everything queued in it. The second one is irreversible. Neither is needed
for a normal rollback.

## Cost

Figures below are Cloudflare's published free-tier limits as of August 2026.
**Re-check them on Cloudflare's pricing page before launch** — they have
changed before and this document cannot see the current page.

| Free tier | Limit |
| --- | --- |
| Workers requests | 100,000 / day |
| Workers CPU time | 10 ms per invocation |
| Worker size | 3 MB compressed |
| D1 storage | 5 GB |
| D1 rows read | 5,000,000 / day |
| D1 rows written | 100,000 / day |

Against what this app actually does:

- **Requests.** One per captured bank message, one per sync, one per ack, plus
  the half-hourly cron (48/day). A heavy single user is on the order of 150
  invocations a day, so the 100k/day allowance is roughly hundreds of active
  users, not tens. *Not verified: whether scheduled (cron) invocations count
  against the free daily request allowance. Assume they do.*
- **Rows.** An ingest writes two rows (a sealed queue row and a replay
  receipt); an ack deletes. 100k writes/day is far past the request ceiling, so
  requests bind first.
- **Storage.** The queue holds rows only until the phone collects them, with a
  30-day sweep as the ceiling. 5 GB is not a constraint for this design.
- **Worker size.** `npm run build:check` reports 2681.58 KiB raw / **648.94 KiB
  gzipped** — measured, not estimated. Comfortably inside 3 MB compressed, and
  worth re-reading after any dependency change, because `unpdf` is most of it.
- **CPU.** This is the one real risk on the free plan. Sealing a row is
  microseconds, but `POST /v1/import/pdf` accepts up to 5 MiB and 100 pages and
  runs text extraction. *Not measured from here — no account.* If PDF import
  starts returning errors under load while SMS capture stays fine, the 10 ms
  free-plan CPU limit is the first thing to suspect, and Workers Paid ($5/month
  at time of writing, with a much higher CPU allowance) is the fix.

So: **free to run at launch scale**, with a plausible $5/month if statement
import gets real use or the user base passes a few hundred. Email Routing is
free but needs a domain you own on Cloudflare.

## When something goes wrong

| Symptom | Cause |
| --- | --- |
| `wrangler is not installed in server/` | `npm --prefix server ci` was skipped |
| `wrangler is not logged in to a Cloudflare account` | Run `npx wrangler login` in a terminal, or set `CLOUDFLARE_API_TOKEN` |
| `More than one account available but unable to select one` | Set `CLOUDFLARE_ACCOUNT_ID` or `account_id` in `wrangler.toml` |
| `wrangler.toml still has no D1 database_id` | `npm run setup` has not run, or its change to `wrangler.toml` was reverted |
| Health check passes, pairing returns 500 | The D1 binding — confirm `database_id` matches a database that `wrangler d1 list` shows |
| Push wakes never arrive | `PUSH_TOKEN_KEY` or `EXPO_PROJECT_ID` missing, or the project id does not match the app's. Registration is refused, not queued |
| `/v1/email-token` returns 503 | `EMAIL_DOMAIN` is unset — expected until Email Routing is configured |

## Not verified from here

Stated plainly so nobody mistakes this document for a deployment that happened:

- **No part of this has been run against Cloudflare.** There is no account in
  this environment. The command shapes, flags and prompts were read out of
  wrangler 4.116.0's own definitions; the API responses were not observed.
- The exact wording of `wrangler deploy`'s success output, and therefore the
  precise line the deployed URL appears on.
- Whether the account will need a `workers.dev` subdomain registered
  interactively (it depends on whether one already exists on the account).
- Everything in `server/README.md` under *Not verified from here* — the iOS
  Shortcut trigger, background wake delivery on hardware — is untouched by
  deploying this. Deploying the relay is necessary for iOS capture and nowhere
  near sufficient.
