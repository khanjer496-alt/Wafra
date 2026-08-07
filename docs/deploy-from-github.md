# Deploying the relay from a phone

The iOS half of Wafra does not work until the Cloudflare Worker in `server/` is
deployed. Android never touches it.

`server/DEPLOY.md` is the canonical description of what a deploy *is*, and you
should read it once. But it assumes a laptop: Node, `npm ci`, and a browser for
`wrangler login`. This page is the same deployment done from the GitHub Actions
tab, which works from a phone.

You need to do three things, once each:

1. make a Cloudflare API token and save two repository secrets;
2. run the workflow once with **action = create-database**, and commit one line;
3. run it again with **action = deploy**.

After that, deploying is one tap and takes about two minutes.

---

## Before you start

You need a Cloudflare account (the free tier is enough — `server/DEPLOY.md` has
the numbers) and write access to this repository. Nothing else. No terminal.

---

## Step 1 — Register a workers.dev subdomain

Do this first, because it is the one thing the workflow cannot do for you.

The Worker declares no custom route, so it is published at
`https://wafra-relay.<your-subdomain>.workers.dev`. Cloudflare asks you to
choose `<your-subdomain>` the first time, interactively. A GitHub runner has no
terminal to answer that question, so if it has never been chosen the deploy
stops with a link instead of hanging.

On your phone:

1. Go to <https://dash.cloudflare.com>.
2. In the left menu, tap **Compute (Workers)**.
3. If Cloudflare asks you to choose a subdomain, choose one and save it. If it
   does not ask, your account already has one and you are done with this step.

*Not verified from here: exactly which screen prompts for this on an account
that has never used Workers, since there is no Cloudflare account in this
environment. If you cannot find the prompt, run the workflow anyway — when the
subdomain is missing the job stops early and prints a direct link to the page
that registers one.*

---

## Step 2 — Create the API token

`wrangler login` opens a browser and cannot work in CI, so the workflow
authenticates with an API token instead.

**Do not use the Global API Key.** It is a password for your entire Cloudflare
account, it cannot be scoped, and it would sit in a repository secret forever.
A scoped token can do exactly two things and nothing else.

On your phone:

1. Go to <https://dash.cloudflare.com/profile/api-tokens>.
2. Tap **Create Token**.
3. Scroll past the templates to **Create Custom Token** and tap **Get started**.
4. Give it a name, e.g. `wafra-relay deploy from github`.
5. Under **Permissions**, add these two rows. Each row is three dropdowns:
   *(scope) · (permission) · (level)*.

   | Scope | Permission | Level | What it is for |
   | --- | --- | --- | --- |
   | Account | **Workers Scripts** | **Edit** | Upload the Worker, set its secrets, publish it to workers.dev |
   | Account | **D1** | **Edit** | Create the database, apply `schema.sql`, list databases |

6. Under **Account Resources**, choose **Include → \<your account\>**. Do not
   leave it on "All accounts".
7. Leave **Zone Resources** empty. The Worker has no custom domain, so it needs
   no zone permissions at all.
8. Tap **Continue to summary**, then **Create Token**.
9. **Copy the token now.** Cloudflare shows it exactly once.

### Why those two and nothing else

`Workers Scripts: Edit` covers uploading the script, `wrangler secret put`, and
enabling the `workers.dev` route. `D1: Edit` covers `d1 list`, `d1 create` and
`d1 execute`. The workflow never reads your account's billing, DNS, zones, R2,
KV, or email routing, so it asks for none of them.

**If a step fails with a permissions error**, the two most likely additions,
in order, are:

- **Account → Account Settings → Read** — the workflow's preflight reads
  `/accounts/<id>/workers/subdomain` to learn your workers.dev subdomain. It is
  not certain from here whether `Workers Scripts: Edit` alone authorises that
  endpoint. If it does not, the preflight prints a *warning* and carries on —
  it is not fatal, and the URL is taken from wrangler's output instead — so add
  this permission only if you want the warning gone.
- **User → User Details → Read** and **User → Memberships → Read** — only
  needed if you ever run `npm run setup` or `wrangler whoami` yourself. The
  workflow deliberately avoids both.

### Get your account ID

1. On <https://dash.cloudflare.com>, open your account.
2. The account ID is a 32-character hex string. It is shown on the account's
   overview page, and it is also the long string in the dashboard URL right
   after `dash.cloudflare.com/`.

---

## Step 3 — Save the repository secrets

In this repository on github.com:

**Settings → Secrets and variables → Actions → New repository secret.**

Create these. The first two are required; the workflow refuses to start without
them and tells you which one is missing.

| Secret name | Required | Value |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | **yes** | The token from step 2 |
| `CLOUDFLARE_ACCOUNT_ID` | **yes** | Your 32-character account ID |
| `PUSH_TOKEN_KEY` | no | Base64 of 32 random bytes — see below |
| `EXPO_ACCESS_TOKEN` | no | From expo.dev, only if EAS enhanced push security is on |

That is the complete list. Four names, two of them optional.

### About `PUSH_TOKEN_KEY`

It encrypts the stored Expo push tokens. It must be **standard base64 of
exactly 32 random bytes** — 44 characters, ending in `=`. On a laptop that is
`openssl rand -base64 32`.

The workflow checks the shape before uploading it, because a wrong key does not
fail the deploy: it fails silently at runtime, months later, as push wakes that
never arrive.

**Leaving both optional secrets out is a supported configuration**, not a broken
deploy. The relay then registers no push tokens and sends no wakes; iOS capture
still works on foreground and background sync, just later.
`server/DEPLOY.md` says the same.

`CLOUDFLARE_ACCOUNT_ID` is required rather than optional on purpose. With it
set, wrangler never has to ask Cloudflare which accounts you belong to — which
keeps the API token narrow, and removes the "more than one account available
but unable to select one in non-interactive mode" failure entirely.

---

## Step 4 — Create the D1 database (once)

1. Open the **Actions** tab.
2. Choose **Deploy relay** in the left-hand list.
3. Tap **Run workflow**.
4. Set **action** to `create-database`. Leave the rest alone.
5. Tap the green **Run workflow** button.

It takes a minute or two. **It will finish red, on purpose.** Open the run and
read the summary at the top — it says *"Action required — one line to commit"*
and shows the new database's id.

### Then commit that one line

The summary links straight to `server/wrangler.toml`. On the phone:

1. Tap the link, then the pencil icon.
2. Find `database_id = "REPLACE_WITH_D1_DATABASE_ID"`.
3. Replace the text between the quotes with the id from the summary.
4. **Commit changes.**

#### Why you do this and not the workflow

A D1 binding is resolved when the Worker is built, and wrangler has no way to
take it from an environment variable — so the id has to live in the file. The
workflow could have committed it for itself, but that would mean giving a deploy
job write access to the branch, and the single line it would ever write is the
one that decides *which database every future deploy talks to*. That is a line
worth a human's eye. So the job stops red with the id in the summary, which
costs you one commit and buys a class of accident that cannot happen.

The id is not a secret. It is useless without credentials for the account that
owns it, which is why it is committed rather than stored as a secret.

Re-running `create-database` is safe: it looks for an existing database called
`wafra` before creating one, so you cannot end up with two.

---

## Step 5 — Deploy

1. **Actions → Deploy relay → Run workflow.**
2. Leave **action** on `deploy`.
3. Tap **Run workflow**.

Two minutes later the run summary says:

> # ✅ Relay is live
> ## https://wafra-relay.your-subdomain.workers.dev

with the URL again in a code block you can tap and copy, and a table showing
which optional secrets were set.

**Re-running is always safe.** Nothing in the deploy path is destructive: the
schema is `CREATE TABLE IF NOT EXISTS` throughout, a redeploy replaces the code,
and setting a secret replaces its value.

### The other two inputs

- **apply_schema** (default on) re-applies `server/schema.sql` to the live
  database. It is additive and idempotent, and the workflow refuses to run the
  file at all if anyone ever adds a `DROP`, `DELETE` or `TRUNCATE` to it. Turn
  it off to deploy code only.
- **relay_url** is only for the rare case where the job cannot work out the
  URL it deployed to. It tells you when that happens; leave it empty otherwise.

---

## How to tell it worked

The green run is the answer. Specifically, before it goes green the job has:

- **deployed the Worker** — `wrangler deploy` succeeded;
- **checked the health endpoint** — `GET <url>/v1/health` answered `200` with
  `{"ok":true}`. It retries for 75 seconds, because a workers.dev DNS record
  registered minutes ago may still be propagating;
- **checked the database** — read the remote table list and confirmed that every
  table declared in `server/schema.sql` is there. Today that is eight:
  `device_invites`, `devices`, `ingest_limits`, `ingest_receipts`,
  `pair_limits`, `push_registrations`, `queue`, `vaults`. The list is read out
  of the schema file at run time, so a table added later is checked too.

What that still does **not** prove: that the Worker's *binding* to D1 resolves.
`/v1/health` returns a constant and never touches the database, and the table
check talks to D1 directly rather than through the Worker. The only test that
covers the binding is pairing a throwaway device and deleting it again — it is
written out in `server/DEPLOY.md` under "Verify it worked", and it needs a
terminal.

You can also just open the URL in your phone's browser and add `/v1/health` to
it. It should show `{"ok":true}`.

---

## What the workflow refuses to do

These are the guards, in the order they run. Each one stops the job with an
explanation in the summary rather than a stack trace.

| It stops when | Because |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_ACCOUNT_ID` is missing | Nothing downstream can work, and the failure would otherwise be an opaque wrangler auth error |
| `database_id` is still `REPLACE_WITH_D1_DATABASE_ID` | Deploying would bind the live Worker to a database that does not exist |
| The account has no workers.dev subdomain | Wrangler would ask an interactive question mid-deploy and take "no" for an answer |
| `schema.sql` contains `DROP`, `DELETE` or `TRUNCATE` | This job applies that file to a live database. A destructive migration is a deliberate act, taken with a backup |
| The configured `database_id` is not on this account | The account secret is wrong, or the id came from a different Cloudflare account. Either way it is not the database you think it is |
| That id belongs to a database with a different name | Something was renamed, or the wrong id was pasted |
| `PUSH_TOKEN_KEY` is not 32 bytes of base64 | A bad key fails silently at runtime instead of loudly here |
| The health check does not return `{"ok":true}` | A deploy that is not checked is a rumour |

It also never commits, pushes, or writes to the branch. Its GitHub token is
`contents: read`.

---

## When something goes wrong

| The summary says | What to do |
| --- | --- |
| *repository secrets are missing* | Step 3. The message names the missing one |
| *this Cloudflare account has no workers.dev subdomain yet* | Tap the link in the summary and register one, then re-run |
| *no D1 database is configured* | Run with **action = create-database** first (step 4) |
| *the configured database is not on this account* | `CLOUDFLARE_ACCOUNT_ID` is probably a different account than the one where the database was created |
| *could not list this account's D1 databases* | The token is missing **D1 → Edit**, or is scoped to the wrong account |
| *PUSH_TOKEN_KEY was rejected* | The Worker deployed fine. Regenerate the key as 32 random bytes in base64 and re-run |
| *Deployed, but the health check failed* | If this was the first ever deploy, wait two minutes and re-run — the DNS record may still be propagating |
| *Deployed, but not verified* | The deploy worked; the job could not guess the URL. Find it under **Cloudflare dashboard → Compute (Workers) → wafra-relay** and re-run with it in **relay_url** |

---

## After the first successful deploy

The URL is the only thing the app needs from this deployment, and it is a
**build-time** setting — Expo inlines it, so changing it needs a new app build,
not a config push.

| Variable | Value |
| --- | --- |
| `EXPO_PUBLIC_WAFRA_RELAY_URL` | The URL from the run summary |
| `EXPO_PUBLIC_WAFRA_SHORTCUT_URL` | `https://www.icloud.com/shortcuts/<published-id>` |
| `EXPO_PUBLIC_WAFRA_PROJECT_ID` | The EAS project UUID |

`server/DEPLOY.md` has the full table including what reads each one, and the
note that these are not wired into `eas.json` yet.

If you want push wakes, also uncomment `EXPO_PROJECT_ID` in the `[vars]` block
at the bottom of `server/wrangler.toml`, set it to the same EAS project UUID,
commit, and re-run the deploy. Without it — or without `PUSH_TOKEN_KEY` — the
relay refuses push registration by design, and the app falls back to foreground
and background sync.

---

## Rolling back

The workflow does not roll back; that path needs a terminal and is written up in
`server/DEPLOY.md` under "Rolling back" (`wrangler deployments list`,
`wrangler rollback`, and, separately, D1 Time Travel for data).

The nearest phone-only equivalent is to revert the commit you want gone and run
the workflow again, which deploys the reverted code as a new version.

---

## What is not verified

Stated plainly, so nothing here is mistaken for a deployment that happened:

- **None of this has been run against Cloudflare.** There is no account in the
  environment where this workflow was written. Every wrangler flag, prompt and
  non-interactive default it relies on was read out of wrangler 4.116.0's own
  code in `server/node_modules`; the Cloudflare API responses were not observed.
- Specifically verified by reading that code, and worth knowing:
  `wrangler secret put` reads its value from stdin whenever stdin is not a TTY
  (so piping works); creating a draft Worker for a secret defaults to *yes* in
  CI; and the workers.dev registration prompt defaults to *no* in CI, which is
  why step 1 exists.
- **Not** verified: whether `Workers Scripts: Edit` alone authorises reading
  `/accounts/<id>/workers/subdomain`. The workflow treats a failure there as a
  warning, not an error, precisely because of that uncertainty.
- Cloudflare's dashboard wording and menu layout change. The permission names in
  step 2 are the ones in Cloudflare's own permissions reference; if a dropdown
  reads slightly differently, match on the words *Workers Scripts* and *D1*.
