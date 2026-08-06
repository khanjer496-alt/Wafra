# Getting Wafra onto your iPhone via TestFlight, from a phone

You have an Android phone and no Mac. That is fine: **EAS Build compiles iOS on
Expo's own macOS machines**, so nothing on this page needs a Mac. What it needs
is a terminal — exactly once, and there is a way to get one in a browser tab.

After that once, shipping a new build to your iPhone is:

> **Actions → iOS build (TestFlight) → Run workflow → submit = on → Run workflow**

and about forty minutes of waiting, none of which you have to watch.

---

## The shape of it

| # | Step | You do it | Takes | Repeat? |
| --- | --- | --- | --- | --- |
| 1 | Enrol in the Apple Developer Program | Apple Developer app on the iPhone | minutes to submit, then Apple's approval | once a year |
| 2 | Expo account + access token | expo.dev in a browser | 5 min | once |
| 3 | App Store Connect API key + repository secrets | App Store Connect, then GitHub | 10 min | once |
| 4 | **The one interactive run** | GitHub Codespace (browser terminal) | 30-45 min, mostly waiting | **once, ever** |
| 5 | Run the workflow | GitHub Actions tab | 3 min of job, then 20-40 min of EAS | every build |
| 6 | Add yourself as an internal tester | App Store Connect | 5 min | once |

Steps 1-4 are setup. Step 5 is the button. Step 6 is what makes step 5 land on
your phone in fifteen minutes instead of a day.

**Read step 4 before you start.** It is the part that has no way around it, and
it is better to know that at the beginning.

---

## Step 1 — Enrol in the Apple Developer Program

99 USD per membership year. Individuals do **not** need a D-U-N-S Number; that
is an organisation requirement.

Apple's requirements for an individual enrolment:

- an Apple Account with **two-factor authentication turned on**;
- legal age of majority in your region;
- your **legal name** in the first/last name fields — not an alias, a nickname
  or a company name. Apple says using one of those "will cause a delay in the
  approval of your enrollment";
- confirmation of your legal name, email, phone and address. **P.O. boxes are
  not accepted.**

The path Apple recommends from a phone is the **Apple Developer** app on the
iPhone — enrol there rather than fighting the web form on a small screen.

Apple does not publish how long approval takes. Do not plan around it being
instant.

> The Apple Account you enrol with is the one that owns everything downstream:
> the certificate, the app record, the TestFlight builds. Use the one that is
> already signed in on the iPhone you want to install onto — it saves you an
> Apple Account switch later.

---

## Step 2 — Expo account and access token

EAS Build is Expo's cloud build service. The free tier queues behind paid
builds but does build iOS.

1. Create an account at <https://expo.dev> if you have not.
2. Go to <https://expo.dev/settings/access-tokens>.
3. **Create token**. Name it something like `wafra github actions`.
4. **Copy it now** — this is the only time it is shown.

That value becomes the `EXPO_TOKEN` repository secret in step 3.

---

## Step 3 — The App Store Connect API key, and the secrets

### Why an API key and not your Apple ID

EAS Submit accepts two ways of talking to Apple:

| | App Store Connect API key | Apple ID + app-specific password |
| --- | --- | --- |
| What CI holds | a `.p8` private key, a key id, an issuer id | your Apple ID and a password |
| Scope | the roles you grant the key | your entire Apple Account |
| Revoking it | one click, breaks nothing else | changes a password you use elsewhere |
| 2FA | not involved | the app-specific password exists to work around 2FA |
| Expo's own CI guidance | this | not mentioned |

**Use the API key.** The app-specific-password route puts a credential for your
whole Apple Account into a GitHub secret, and revoking it is a bigger event.
The workflow supports the API key only.

### Create the key

You need the **Account Holder or Admin** role, which as a solo individual
enrolment you are.

1. Open <https://appstoreconnect.apple.com> and sign in.
2. Go to **Users and Access**, then click **Integrations**. It opens with
   **App Store Connect API** selected.
3. Click **Team Keys**.
4. Click **Generate API Key** (or the **+** button if you already have one).
5. Name it — the name is for your reference only, e.g. `wafra ci`.
6. Under **Access**, pick a role. **App Manager** is enough to upload builds to
   TestFlight; **Admin** is the safe answer if something later complains about
   permissions. Team keys apply across all your apps and cannot be limited to
   one.
7. Click **Generate**.

Now collect three values from that page:

| Value | Where it is |
| --- | --- |
| **Issuer ID** | near the top of the Integrations page, with a **Copy** button next to it. It is a UUID |
| **Key ID** | the row for the key you just made. Ten characters, uppercase letters and digits |
| **The `.p8` file** | click **Download** on that row |

> **You can download the `.p8` exactly once.** Apple: "API keys are private and
> can only be downloaded once. After downloading, store it securely. Revoke a
> key immediately if it becomes lost or compromised." Apple does not keep a
> copy. If you lose it, revoke the key and generate another — no harm done, it
> just costs you this step again.

### Getting a file into a secret

GitHub secrets hold strings. The `.p8` is a file. It is, however, a *text*
file — PEM, starting with `-----BEGIN PRIVATE KEY-----` — so the fix is to put
its contents in the secret and have the workflow write them back out to a file
on the runner.

The workflow accepts **either** form and works out which it got:

- **the raw contents**, pasted in as-is, newlines and all; or
- **base64 of the file** (`base64 -w0 AuthKey_XXXXXXXXXX.p8`).

On a phone the raw contents are usually easier. On iOS: **Files** → find
`AuthKey_XXXXXXXXXX.p8` in Downloads → long-press → **Rename** → change the
extension to `.txt` → tap it → select all → copy. On Android any text editor
opens it directly.

If you would rather do it in a terminal, you will have one open in step 4 —
upload the file there and `cat` it, or `base64 -w0` it.

On the runner the key is written to `$RUNNER_TEMP/asc-api-key.p8` with mode
`600`, outside the workspace so no later step can archive it, and deleted at
the end of the job.

### Create the secrets

In this repository: **Settings → Secrets and variables → Actions → New
repository secret.**

| Secret name | Required | Value | Where it came from |
| --- | --- | --- | --- |
| `EXPO_TOKEN` | **yes** | the Expo access token | step 2 |
| `EXPO_ASC_API_KEY_P8` | recommended | the `.p8` contents, or base64 of them | the Download button |
| `EXPO_ASC_KEY_ID` | with the above | 10 uppercase alphanumerics | the key's row |
| `EXPO_ASC_ISSUER_ID` | with the above | a UUID | top of the Integrations page |
| `EXPO_APPLE_TEAM_ID` | optional | 10 uppercase alphanumerics | <https://developer.apple.com/account> → **Membership details** |
| `EXPO_APPLE_TEAM_TYPE` | optional | `INDIVIDUAL` for a solo enrolment | — |

Six names, one of which is genuinely required. The names match the environment
variables Expo reads (`EXPO_ASC_KEY_ID`, `EXPO_ASC_ISSUER_ID`,
`EXPO_APPLE_TEAM_ID`, `EXPO_APPLE_TEAM_TYPE`, and `EXPO_ASC_API_KEY_PATH` which
the workflow sets to the file it wrote), so there is nothing to translate.

The three ASC secrets are **all or nothing** — the workflow refuses to start on
one or two of them, because a half-configured key looks configured and is not.

> **You can skip the three ASC secrets entirely.** In step 4 you will be in a
> terminal, and `eas credentials --platform ios` can store the same API key
> against the project on Expo's servers, where `eas submit` finds it by itself.
> That is fewer secrets and one less copy of a private key. The reason to put
> it in GitHub anyway is that Expo also uses this key to *repair* iOS
> credentials in CI — a provisioning profile that needs re-signing, for
> instance — and it can only do that if the key is in the environment. Both
> work. Doing both is fine and is what the workflow assumes.

---

## Step 4 — The one interactive run

**This is the honest caveat, and it is the reason this page is longer than
"press the button".**

### What cannot be automated, and why

EAS signs an iOS build with two things from Apple: a **distribution
certificate** and an **App Store provisioning profile**. EAS CLI can create
both for you, but it does so by signing in to your Apple account and walking
you through two-factor authentication. A GitHub runner has no terminal to type
a 2FA code into.

Expo's CI guide says so directly:

> Run `eas build -p [all|android|ios]` from your local terminal for each
> platform you want to support on CI, so the `eas build` command can prompt for
> any additional configuration it needs. That configuration will then be
> available for future non-interactive runs.
>
> — <https://docs.expo.dev/build/building-on-ci/>

**Does the App Store Connect API key remove that requirement?** As far as
Expo's documentation goes, **no.** The ASC key is documented for the case where
"your iOS credentials need to be repaired", for refreshing ad-hoc provisioning
profiles (`--refresh-ad-hoc-provisioning-profile`, EAS CLI 19.1.0+), and for
federated Apple accounts that cannot log in interactively at all. There is no
documented flag or environment variable that creates a *store* distribution
certificate from nothing in non-interactive mode, and when the credentials do
not exist EAS CLI stops with:

> Credentials are not set up. Please run this command again in interactive mode.

The workflow recognises that exact error and says all of this in its run
summary rather than leaving you with a stack trace.

*This is a statement about what Expo documents, not a claim to have tested it —
there is no Apple Developer account in the environment where this was written.
See "What is not verified" at the bottom.*

### Getting a terminal without a computer

**GitHub Codespaces.** It is a Linux container with a VS Code terminal in a
browser tab, it runs on this repository, and it works on a phone. Free accounts
get a monthly allowance; this uses a fraction of it.

1. Open this repository on github.com.
2. **Code → Codespaces → Create codespace on `main`** (or on your working
   branch).
3. Wait for it to build, then open the **Terminal** panel.

Rotate the phone to landscape. It is cramped but it is a real shell.

### The run

In the Codespace terminal:

```bash
npm install -g eas-cli
eas login
npx testflight
```

`npx testflight` is Expo's one-command first run. It does, in order: set up the
EAS project, confirm the bundle identifier, sign you in to Apple with 2FA,
**generate or reuse the distribution certificate and provisioning profile**,
build a production `.ipa`, check App Store Connect API access, and submit to
TestFlight for internal testing.

The 2FA code arrives on the same iPhone. Have it in your hand.

If you would rather do it in pieces, the equivalent is:

```bash
eas init                 # creates the project, writes extra.eas.projectId
eas credentials --platform ios     # sign in to Apple; also where you store the ASC key
eas build --platform ios --profile production   # answer any remaining prompts
```

### Then commit one line

`eas init` writes the EAS project UUID into `app.json`:

```json
  "extra": {
    "eas": { "projectId": "00000000-0000-0000-0000-000000000000" },
    "revenueCatAndroidKey": "",
    "revenueCatIosKey": ""
  }
```

**Commit that.** It is not a secret — it is useless without an Expo token for
the account that owns it — and it is what every later run of the workflow uses
to know what it is building. The workflow checks for it first and refuses to
start without it, naming it explicitly, because the same UUID is also what push
notifications are keyed to on *both* platforms (`EXPO_PROJECT_ID` in
`server/wrangler.toml` is the relay's copy of it, and
`scripts/check-release-config.mjs` blocks a release build without it).

From the Codespace: `git add app.json && git commit -m "eas: project id" &&
git push`. Or read the UUID out of the file, delete the Codespace, and edit
`app.json` on github.com with the pencil icon.

You are done with terminals.

---

## Step 5 — Run the workflow

1. Open the **Actions** tab.
2. Choose **iOS build (TestFlight)** in the left-hand list.
3. Tap **Run workflow**.

Four inputs:

| Input | Default | What it means |
| --- | --- | --- |
| **profile** | `production` | `production` is App Store signing — the only kind TestFlight accepts. `preview` is ad-hoc, for side-loading onto one registered device; see [`ios-device-install.md`](./ios-device-install.md) |
| **submit** | off | On = the finished build goes to TestFlight. Off = it builds and stops, and nothing reaches Apple |
| **wait** | off | On = the job sits there until EAS finishes, so the summary can carry the artifact link. Costs 20-40 GitHub minutes to learn what the EAS build page shows live. Leave it off |
| **what_to_test** | empty | The note testers see in TestFlight. Only used when submitting |

**The default combination builds and sends nothing to Apple.** For TestFlight,
turn **submit** on.

`preview` + `submit` is refused before anything starts, for three reasons the
summary spells out: ad-hoc binaries are not accepted by TestFlight, the
`preview` profile has no `autoIncrement` so it would re-use build number 1
which App Store Connect rejects, and `eas.json` has no `submit.preview` profile.

### What the job checks before spending a build minute

In order, each stopping with an explanation in the summary rather than a stack
trace:

| It stops when | Because |
| --- | --- |
| `EXPO_TOKEN` is missing | the first EAS command would fail |
| `preview` + `submit` | cannot reach TestFlight; three separate reasons |
| `expo.extra.eas.projectId` is missing or malformed | `eas build` cannot resolve the project, and the same UUID gates push on both platforms |
| `expo.ios.bundleIdentifier` is missing | Apple identifies the app by it |
| the chosen build (or submit) profile is not in `eas.json` | nothing to build with |
| one or two of the three ASC secrets are set | half a key looks configured and is not |
| `EXPO_ASC_API_KEY_P8` is neither PEM nor base64, or decodes to something with no private key in it | Apple would reject it at submission — after the build was paid for |
| `EXPO_ASC_KEY_ID` / `EXPO_ASC_ISSUER_ID` / `EXPO_APPLE_TEAM_ID` are the wrong shape | same |
| `EXPO_APPLE_TEAM_TYPE` is not one of the three Apple values | same |
| `EXPO_TOKEN` is set but Expo rejects it | otherwise it surfaces later as something that reads like a credentials problem |

All of that runs in about a minute.

### What the summary gives you

- the **EAS build page** URL — open it on the iPhone; it updates live, shows
  the log, and carries the **Install** button when the build is done;
- the **artifact** link, when the run waited for it;
- the **TestFlight** phase table, if you submitted;
- what will not work in the build, so you are not surprised.

### Why the job ends before the build does

By default the workflow hands the build to EAS and exits in about three
minutes. An iOS build is 20-40 minutes of queue plus compile on Expo's
machines; sitting in a GitHub runner watching it burns GitHub Actions minutes
to learn nothing the build page would not have told you. This repository has
run out of GitHub minutes before — see the note at the top of
`.github/workflows/build-apk.yml`.

The submission is handed to EAS too (`--auto-submit-with-profile production`),
so it happens on Expo's servers when the build finishes. The job ending does
not stop it.

---

## Step 6 — Add yourself as an internal tester

**This is the part people miss, and it is the difference between fifteen
minutes and a day.**

TestFlight has two kinds of tester:

| | Internal | External |
| --- | --- | --- |
| Who | up to **100** App Store Connect users with access to your content | up to **10,000** anyone |
| Beta App Review | **no** | **yes** — a full review for the first build |
| Available | as soon as Apple finishes processing the build | after that review |

You are an App Store Connect user with access to your own content, so you can
be an internal tester. **Be one.** Every build then reaches your phone as soon
as processing finishes, with no review in the path at all.

In App Store Connect (roles that qualify: Account Holder, Admin, App Manager,
Developer, or Marketing — you are the Account Holder):

**Create the group, once:**

1. **Apps** → select Wafra.
2. **TestFlight** tab.
3. In the sidebar, the **+** next to **Internal Testing**.
4. Name the group, **Create**.

**Add yourself, once:**

1. **Apps** → Wafra → **TestFlight**.
2. In the sidebar under **Internal Testing**, click your group.
3. **Invite Testers**, tick yourself, **Add**.

**Add a build** — needed the first time, and after that only if you did not tick
automatic distribution:

1. **Apps** → Wafra → **TestFlight**.
2. Click the group.
3. **Add Builds**, choose the build, **Next**.
4. Enter the **What to Test** text, **Add**.

Then install **TestFlight** from the App Store on the iPhone, sign in with the
same Apple Account, and Wafra is there.

Builds stay installable for **90 days**, after which that build expires and you
need a new one.

---

## How long each phase takes

| Phase | Where you watch it | Typical |
| --- | --- | --- |
| The GitHub job | the Actions run | ~3 min (default), 20-40 min with **wait** on |
| EAS queue + iOS build | the EAS build page in the summary | 20-40 min, longer on the free tier when it is busy |
| EAS → App Store Connect upload | the **Submissions** tab on expo.dev | 2-5 min |
| Apple processing the build | App Store Connect → **TestFlight** | 10-15 min |
| Appearing in the TestFlight app | the iPhone | immediately after processing, for internal testers |
| Beta App Review | — | **not in this path.** Internal only |

So: press the button, put the phone down, and it is installable in roughly an
hour.

---

## What this build cannot do yet

A TestFlight build of Wafra today is a real, working ledger. Several things
that the App Store version will do are **inert**, and none of them is a bug.
Read this before concluding something is broken.

### Automatic bank capture does not work yet

iOS does not let an app read Messages, and Wafra does not claim to. Automatic
capture on iOS is a chain of three things, and **two of them are external state
that does not exist yet**:

1. **The relay must be deployed.** The Cloudflare Worker in `server/` is what
   receives a forwarded bank alert, parses it in memory and stores only the
   structured transaction. `eas.json` already points the build at
   `https://wafra-relay.khanjer496.workers.dev` — but pointing at a URL is not
   the same as that URL answering. Deploy it first:
   [`deploy-from-github.md`](./deploy-from-github.md), which is the same
   phone-only shape as this page.
2. **The Wafra Capture Shortcut must be built and published** to iCloud, from
   [`ios-shortcut-spec.md`](./ios-shortcut-spec.md), and its public URL put in
   `EXPO_PUBLIC_WAFRA_SHORTCUT_URL`.

   **That variable is not in `eas.json`.** Only `EXPO_PUBLIC_WAFRA_RELAY_URL`
   is. Expo inlines these at build time, so in this build the Shortcut URL is
   **empty** and the setup flow has no Shortcut to offer you. `src/lib/relay.ts`
   deliberately provides no fallback: "a release with no deployed relay must
   fail setup visibly, not send financial messages to a domain that merely
   looks plausible."
3. **You must create the personal Message automation** in Shortcuts yourself,
   pointed at the bank conversations you choose. That part is yours and works
   fine — once 1 and 2 exist.

Until then, the iOS setup flow will not complete. Expect that.

### Push wakes probably do not arrive

The relay only registers push tokens when it has both `PUSH_TOKEN_KEY` and
`EXPO_PROJECT_ID` set — see `deploy-from-github.md`. Without them it refuses
registration by design and the app falls back to syncing when it is opened.
That is a supported configuration, not a broken one.

### In-app purchases are inert

`app.json` has `"revenueCatIosKey": ""`. `src/lib/billing.ts` reads it. With no
key, RevenueCat is not configured and nothing about Pro, the trial, or
restoring a purchase will work in this build.

### `npm run release:check` will still fail

`scripts/check-release-config.mjs` blocks on RevenueCat keys, the D1 database
id, the Shortcut URL, the legal-entity placeholders and more. **This workflow
does not run it**, on purpose — it would refuse every build for reasons that do
not stop a TestFlight build being useful. It is the gate for an actual App
Store submission, and that is a different day.
[`app-store-release.md`](./app-store-release.md) is that checklist.

### What does work

Manual entry, the SQLCipher ledger, biometric lock, statement and text-PDF
import, the whole UI in English and Arabic, notifications you schedule
yourself, and demo data. Which is most of the app.

---

## When something goes wrong

| The summary says | What to do |
| --- | --- |
| *`EXPO_TOKEN` is not set* | Step 3. Create it at expo.dev/settings/access-tokens |
| *`EXPO_TOKEN` was rejected by Expo* | It was revoked or mistyped. Make a new one and replace the secret |
| *the app is not linked to an EAS project* | Step 4. `eas init` has not run, or its `app.json` change was never committed |
| *`preview` builds cannot go to TestFlight* | Set profile to `production`, or turn submit off |
| *the App Store Connect API key is half configured* | All three of `EXPO_ASC_API_KEY_P8`, `EXPO_ASC_KEY_ID`, `EXPO_ASC_ISSUER_ID`, or none |
| *neither PEM nor base64* / *does not contain a private key* | Re-copy the `.p8`. If it is gone, revoke the key in App Store Connect and make a new one |
| *an App Store Connect value has the wrong shape* | Key id is 10 uppercase alphanumerics; issuer id is a UUID. Both are on **Users and Access → Integrations** |
| **⚠️ *iOS credentials do not exist yet*** | Step 4. This is the interactive run, and no secret substitutes for it |
| *The EAS build command failed* | Open the EAS build page linked in the summary — the real error is in its log, not in the GitHub log |
| The build succeeds but never appears in TestFlight | Check the **Submissions** tab on expo.dev. If the submission failed, it is almost always the ASC key's role (try Admin) or the app record not existing in App Store Connect yet |
| TestFlight on the phone shows nothing | Step 6. Processing finished, but the build has not been added to an internal group, or you are not in it |

---

## What is not verified

Stated plainly, so nothing here is mistaken for something that was tested:

- **None of this has been run against Apple or against EAS.** There is no Apple
  Developer account and no linked EAS project in the environment where the
  workflow and this page were written. Every flag, environment variable and
  behaviour was taken from Expo's and Apple's own documentation, cited above.
- **The claim in step 4 is a claim about Expo's documentation**, not an
  experiment. What is documented: the CI guide's instruction to run
  `eas build -p ios` from a local terminal first; the ASC key being introduced
  for credential *repair* and for federated accounts; and the
  `Credentials are not set up. Please run this command again in interactive
  mode.` error. What is **not** established from here: whether some undocumented
  combination of flags would in fact generate a store distribution certificate
  unattended. If you find one, this page is wrong and should be shortened.
- **Apple does not state "internal testers skip Beta App Review" in one
  sentence.** What Apple's help does show is that the *Invite external testers*
  page has a "submit to TestFlight App Review" step and the *Add internal
  testers* page has no review step at all. That is the basis for step 6. It is
  also how TestFlight is universally used, but the wording here is inference
  from the structure of Apple's docs, not a quotation.
- **The build page URL** in the summary is taken from EAS CLI's own output when
  it prints one. When it does not, it is reconstructed from your account name
  and the app slug, which is wrong if the EAS project belongs to an
  organisation rather than to you. The summary flags it when it reconstructed.
- **Timings** are Expo's figure for App Store Connect processing (10-15 min) and
  ordinary experience for the rest. EAS free-tier queue time is not something
  anyone can promise.
- **App Store Connect's web console on a phone** is usable in the sense that
  every button exists. How pleasant each screen is on a 6-inch display was not
  checked.
- The `.p8` handling was tested against a locally generated EC private key in
  both PEM and base64 form, including the rejection paths. It has never carried
  a real Apple key.

---

## A change to `eas.json` that would help

Not applied here — `eas.json` belongs to another task in flight — but worth
doing:

```json
  "submit": {
    "production": {
      "ascAppId": "<the Apple ID number from App Store Connect → App Information>",
      "appleTeamId": "<your 10-character team id>"
    }
  }
```

`submit.production` is currently `{}`. That is enough when EAS can resolve the
app record itself, but `ascAppId` removes the ambiguity, and it is the one
thing a submission cannot work out from the bundle identifier alone if you ever
end up with two app records. It is found at **App Store Connect → Apps → Wafra
→ App Store → App Information → General Information → Apple ID**.

The other thing worth adding, when the Shortcut is published, is
`EXPO_PUBLIC_WAFRA_SHORTCUT_URL` alongside `EXPO_PUBLIC_WAFRA_RELAY_URL` in the
`production` and `preview` build profiles' `env` blocks. Until then, see "What
this build cannot do yet".
