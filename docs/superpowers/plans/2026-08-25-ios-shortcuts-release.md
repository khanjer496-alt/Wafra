# iOS Shortcuts Combined Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Release the completed local-capture and history-import features together with two exact, physically tested iCloud Shortcuts, one scoped relay migration, consistent public copy, and exactly one combined TestFlight submission.

**Architecture:** This is a serialized integration and release plan, not a third feature implementation. It consumes the feature outputs from Local Capture Tasks 0–8 and History Import Tasks 1–5 only after Local Task 9 and History Task 6 have passed their feature-verification handoffs, deploys the additive D1 scope before the Worker that reads it, qualifies the two signed Shortcut artifacts on physical iPhones, publishes those exact artifacts under distinct iCloud URLs, and then updates all shared release surfaces once. One final repository gate and one read-only review precede the single production iOS build and submission.

**Tech Stack:** Expo SDK 55, React Native 0.83, Apple Shortcuts and App Intents, physical iPhone testing, EAS Build/Submit, App Store Connect/TestFlight, Cloudflare Workers/D1/Pages, TypeScript, Node and Swift test harnesses.

**Spec:** `docs/superpowers/specs/2026-08-25-ios-local-capture-design.md` and `docs/superpowers/specs/2026-08-25-ios-history-import-design.md`

## Global Constraints

- Read the exact Expo SDK 55 documentation at `https://docs.expo.dev/versions/v55.0.0/` before changing Expo or React Native release code.
- Start this plan only after Local Capture Tasks 0–9 and History Import Tasks 1–6 are complete. Tasks 0–8 and 1–5 provide the feature outputs; Local Task 9 and History Task 6 provide the passing feature-verification handoff evidence.
- Do not run either feature plan's former release/configuration/submission tasks; this plan is the sole owner of shared release files, production deployment, public URLs, Cloudflare landing publication, and TestFlight submission.
- Execute this plan serially under one release owner. Do not run a feature-writing worker while its output is being qualified or deployed here.
- The two Shortcut names are exactly `Wafra Local Capture` and `Wafra History Import`; they require two distinct HTTPS iCloud URLs.
- A public URL is valid only when its path is `/shortcuts/` followed by exactly 32 hexadecimal characters and it resolves to the exact physically tested graph.
- Do not reuse the retired capture URL `https://www.icloud.com/shortcuts/03d2ab22a33f4fef9d503142575a70fb` for either feature.
- Do not invent private Shortcut action metadata, sender aliases, iCloud URLs, device results, Cloudflare output, EAS build IDs, App Store Connect states, or TestFlight evidence.
- No simulator, generated plist, source inspection, screenshot, local signature, build metadata, or verbal confirmation substitutes for a required physical-iPhone result.
- Local capture requires the current stable iOS release to accept Message + Any Sender + empty Message Contains + Run Immediately and to deliver the complete Received Message while locked.
- History import requires an iOS 26.0-or-later physical iPhone and the exact date-only Find Messages graph; older iOS testing does not satisfy that gate.
- Use a dedicated release iPhone/account containing only controlled synthetic history wherever the history matrix would otherwise expose private Messages.
- Every required Apple-automation delivery observation must use a real future bank alert. Never copy its body, amount, account/card digits, GUID, phone number, or authorization data into source, logs, screenshots, evidence, or chat.
- Add a production sender alias only when its exact sender label was physically observed and the same institution/market is already backed by a parser fixture. Unsupported observations block the claim; they do not authorize a guessed alias.
- The production registry remains fail-closed. Substring, prefix, regex, fuzzy, body-name, and display-name-only aliases are prohibited.
- The live Shortcut and history Shortcut must contain no network, URL-request, Files, clipboard, logging, analytics, notification, embedded credential, or source-data output action.
- The legacy relay remains in dual-run until the first qualifying local alert is durable. Retirement disables only old `/v1/ingest`; email, PDF, CSV, sync, trusted devices, queue contents, and wake-only push behavior remain available.
- Retirement and `/v1/ingest` admission must share one atomic D1 boundary. A request authenticated before retirement may not enqueue a Shortcut row after retirement commits.
- Use only `server/migrations/2026-08-25-shortcut-ingest-retirement.sql` for the existing-D1 column addition, and only when the target column is absent. `server/schema.sql` remains the fresh-database source and may be reapplied idempotently by the repository's documented `predeploy` guard; it is not a second `ALTER TABLE` migration.
- Confirm the exact Cloudflare account, Worker, D1 binding, Pages project, Apple account, EAS project, bundle ID, and App Store Connect app before any production mutation.
- The authenticated EAS release identity must remain owner account `@nnnkk`, project `@nnnkk/wafra`, project ID `fa920e7b-c661-4517-917d-26e8b4878721`; any mismatch stops the build.
- Public/legal/store copy must distinguish Wafra's no-network local paths from Apple Messages' separate iCloud synchronization and the disclosed legacy relay dual-run period.
- Preserve all unrelated worktree changes. Do not clean, stash, reset, rebase, or broadly reformat the tree.
- This plan produces one integrated production iOS build and one automatic submission. Do not submit local capture and history import in separate builds.
- Commit checkboxes define review boundaries only. Skip every commit command unless the user separately authorizes repository commits.

---

### Task 1: Freeze and Verify Both Feature Handoffs

**Files:**
- Reference: `docs/superpowers/plans/2026-08-25-ios-local-capture.md`
- Reference: `docs/superpowers/plans/2026-08-25-ios-history-import.md`
- Reference: `docs/ios-local-capture-shortcut-source.json`
- Reference: `docs/ios-history-shortcut-source.json`
- Reference: `scripts/build-ios-capture-shortcut.mjs`
- Reference: `scripts/build-ios-history-shortcut.mjs`
- Reference: `scripts/check-ios-shortcut-artifact.sh`
- Reference: `scripts/check-ios-history-shortcut-artifact.sh`
- Create after the first observed result: `docs/test-evidence/ios-shortcuts-release-2026-08-25.md`

**Interfaces:**
- Consumes: feature outputs from completed Local Capture Tasks 0–8 and History Import Tasks 1–5, their exact audited action graphs, and passing handoff evidence from Local Task 9 and History Task 6.
- Produces: one frozen release input identified by Git state, graph checksums, app version, native action availability, device/OS facts, and a source-free release evidence record.

- [ ] **Step 1: Prove both feature plans reached their release handoff**

Read both approved specs and both implementation plans completely. Inspect the
task-owned diff and verify that every non-commit checkbox in Local Tasks 0–9
and History Tasks 1–6 is complete. A conditional commit checkbox may instead
be explicitly recorded as skipped because no separate commit authorization was
given. Confirm that neither feature plan contains or executed a separate
publish/configuration/deployment/submission phase.

Run:

```bash
git status --short
git diff --stat
git diff --check
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD
```

Expected: the branch and commit are recorded; unrelated dirty files are
identified and excluded from release ownership; no whitespace error exists.
An incomplete feature task stops this plan and returns to that feature plan.

- [ ] **Step 2: Run the focused feature handoff suites**

Run:

```bash
bash scripts/test/native-live-capture-store.sh
bash scripts/test/native-history-store.sh
node scripts/test/ios-capture-setup.test.js
node scripts/test/ios-shortcut-artifact.test.js
node scripts/test/ios-history-shortcut-artifact.test.js
node scripts/test/ios-setup-ux.test.js
node scripts/test/history-import.test.js
node scripts/test/historical-import.test.js
node scripts/test/import-plan.test.js
node scripts/test/relay.test.js
node scripts/test/worker.test.js
npm run typecheck
npm run lint
```

Expected: every suite exits 0. The native suites include interprocess locking;
the artifact suites reject guessed/private or forbidden actions; the local
coordinator tests cover forced-market alignment and qualifying-milestone rules;
the history tests reject raw GUIDs and accept only 64-character lowercase
SHA-256 IDs. If a named suite does not exist, the corresponding feature
handoff is incomplete rather than implicitly passing.

- [ ] **Step 3: Confirm the native actions in one generated app build**

Run:

```bash
npx expo prebuild --platform ios
npx expo run:ios --device
```

Expected: a physical iPhone shows the two local-capture actions and all three
history-import actions, with English and Arabic titles/errors loaded from the
actual bundled resources. Inspect the generated Xcode diff and confirm no
manual edit under `ios/Pods/**` and no unbundled localization file.

- [ ] **Step 4: Start the release evidence without manufacturing values**

Create the evidence file only from observed facts. Record the branch/commit,
app version/build source, physical device model, exact iOS build, Apple account
owner responsible for publication, local/history normalized source SHA-256
checksums, and pass/fail status for every gate in this plan. Do not add blank
success rows, example URLs, guessed IDs, raw sender conversations, Message
content, or secrets. A missing fact is recorded as a blocking failure.

---

### Task 2: Qualify and Deploy Scoped Relay Retirement

**Files:**
- Reference: `server/migrations/2026-08-25-shortcut-ingest-retirement.sql`
- Reference: `server/schema.sql`
- Reference: `server/src/index.ts`
- Reference: `server/wrangler.toml`
- Reference: `server/README.md`
- Reference: `server/DEPLOY.md`
- Reference: `scripts/test/worker.test.js`
- Reference: `scripts/test/relay.test.js`
- Reference: `scripts/test/db.test.js`
- Modify with observed results only: `docs/test-evidence/ios-shortcuts-release-2026-08-25.md`

**Interfaces:**
- Consumes: Local Capture Task 5's additive migration, atomic ingest/retirement implementation, and idempotent retirement client.
- Produces: a migrated production D1 binding, one deployed Worker version, passing atomic-race evidence, and source-free authenticated smoke results.

- [ ] **Step 1: Require the deliberate retirement/ingest interleaving test**

Inspect `scripts/test/worker.test.js` and confirm it deliberately pauses an
authenticated `/v1/ingest` between authentication and its conditional insert,
commits retirement, resumes ingest, and proves no queue or replay receipt was
created. It must also cover the opposite serialization order and prove that
email, PDF, CSV, sync, queue, trusted-device, and push registrations survive.

Run:

```bash
bash scripts/test/build.sh
node scripts/test/worker.test.js
node scripts/test/relay.test.js
node scripts/test/db.test.js
npm run check:server
```

Expected: every command exits 0 and the output names the atomic race and scoped
survival assertions. A test that merely checks the enabled flag during initial
authentication is insufficient; return to Local Capture Task 5 if the
conditional insert/retirement boundary is not exercised.

- [ ] **Step 2: Resolve the exact production Cloudflare targets read-only**

Run from the repository root:

```bash
(cd server && npx wrangler whoami)
(cd server && npx wrangler d1 info wafra --json)
(cd server && npx wrangler d1 execute wafra --remote --command "PRAGMA table_info(devices)" --json)
(cd server && npx wrangler deployments list)
```

Expected: the authenticated account owns Worker `wafra-relay`; D1 name `wafra`
resolves to the exact `database_id` in `server/wrangler.toml`; the previous
Worker version is recorded for rollback; no command prints a bearer secret.
Stop if the account, name, or binding is ambiguous.

- [ ] **Step 3: Capture a rollback anchor and apply the one exact existing-D1 migration**

Inspect the PRAGMA output. If `shortcut_ingest_enabled` is absent, run:

```bash
(cd server && npx wrangler d1 time-travel info wafra --json)
(cd server && npx wrangler d1 execute wafra --remote --file=./migrations/2026-08-25-shortcut-ingest-retirement.sql --yes)
```

Record only the Time Travel bookmark/timestamp needed to identify the
pre-migration restore point. Do not export the production database or copy user
rows to local disk for this additive migration.

If the column is already present, do not reapply the migration. In either case,
verify its exact remote shape:

```bash
(cd server && npx wrangler d1 execute wafra --remote --command "SELECT name, type, \"notnull\", dflt_value FROM pragma_table_info('devices') WHERE name = 'shortcut_ingest_enabled'" --json)
```

Expected: exactly one `shortcut_ingest_enabled` INTEGER column exists, it is
non-null, and its default is `1`. Do not improvise a second migration or edit
production rows by hand.

- [ ] **Step 4: Deploy the Worker only after the column exists**

Return to the repository root and run:

```bash
npm --prefix server ci
npm --prefix server run typecheck
npm --prefix server test
npm --prefix server run build:check
npm --prefix server run deploy
```

Expected: Step 3's verified targeted column migration finishes first. The
documented `predeploy` then rechecks the configured binding and reapplies the
idempotent fresh-database schema before Wrangler publishes. It must not execute
a second column-adding migration. Record the exact Worker deployment version
and URL. If the targeted migration, binding check, schema guard, or any build
check fails, Wrangler must not publish the new Worker.

- [ ] **Step 5: Run source-free production smoke checks**

Use the throwaway pair/delete procedure in `server/DEPLOY.md` with a freshly
generated X25519 public key. Keep the returned ingest, sync, and admin tokens
only in process memory or a mode-0600 temporary file; never paste them into the
evidence file or terminal transcript. On that throwaway device verify, in this
order:

1. `/v1/health` returns `200` with `{"ok":true}` and exercises the new column.
2. A `WAFRA_CAPTURE_TEST_V1` ingest returns `202` before retirement.
3. Sync returns `200` and exposes only the throwaway encrypted marker.
4. `POST /v1/device/retire-shortcut-capture` returns `204` twice.
5. The old ingest token returns `401` after retirement.
6. Sync and device listing still return `200`.
7. Import capabilities still return `200`; invalid PDF/CSV probes reach their
   ordinary validation response rather than `401`.
8. Email-token creation is still authorized: `201` when Email Routing is
   configured or the documented `503 email_not_configured` when it is not,
   never `401` because of Shortcut retirement.
9. Delete the throwaway device with its admin credential and confirm `204`.

Expected: every scoped result matches. Record only status codes, the source-free
health response, deployment version, migration result, and cleanup result.

- [ ] **Step 6: Record the deploy boundary and rollback anchor**

Add the pre-deploy Worker version, new version, D1 database ID, migration
present/applied result, Time Travel rollback bookmark/timestamp, health result,
scoped smoke table, and UTC time to the evidence file. The evidence must not
claim that the real user's relay was retired; that occurs only after the later
qualifying local alert.

---

### Task 3: Populate Physically Evidenced Sender Aliases and Sign Both Candidates

**Files:**
- Modify: `config/ios-bank-senders.json`
- Regenerate: `src/lib/ios-bank-senders.generated.ts`
- Regenerate: `modules/wafra-live-capture/ios/WafraBankSenderRegistry.generated.swift`
- Reference: `scripts/test/fixtures/uae-bank-formats.js`
- Reference: `scripts/test/fixtures/saudi-bank-formats.js`
- Create locally and keep ignored: `artifacts/WafraLocalCapture.signed.shortcut`
- Create locally and keep ignored: `artifacts/WafraHistoryImport.signed.shortcut`
- Modify with observed results only: `docs/test-evidence/ios-shortcuts-release-2026-08-25.md`

**Interfaces:**
- Consumes: exact sender labels observed on physical devices, the already implemented canonical generator, and both audited Apple-exported action graphs.
- Produces: fail-closed production sender data, one installed candidate app, two verifier-approved signed artifacts, and immutable SHA-256 checksums for the physical gates.

- [ ] **Step 1: Qualify each sender observation before editing the registry**

On the physical release iPhone, inspect only the sender label/title of an
existing bank-alert conversation. The release owner must create an external
encrypted evidence record before any registry edit. Access is limited to the
release owner and the independent release reviewer; it must remain available
for as long as the alias ships and then follow the owner's documented private-
evidence deletion policy. If no approved encrypted evidence location or
deletion policy exists, this release step is blocked rather than creating an
unprotected local substitute.
Generate its source-free ID with `uuidgen | tr '[:upper:]' '[:lower:]'` and use
the exact registry evidence form `external-release-owner:ios-sender:` followed
by that UUID; the complete value must match
`^external-release-owner:ios-sender:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`.
The external mapping contains the masked physical-message record, observed
sender label, institution, market, device/iOS, observation date, and reviewer
attestation, but no Message body, amount, account/card digits, GUID, phone
number, or credential. Confirm the institution and market against an existing
parser fixture. If the external record or reviewer mapping is unavailable,
do not add the alias.

For every proposed alias, add exactly the four schema fields `alias`, `market`,
`bankId`, and `evidence`. Use the verbatim physically observed sender label,
the matching fixture's literal `AE` or `SA` market and canonical bank ID, and
the source-free private evidence identifier assigned in this step. Never put
example or redacted stand-in values in the production registry. If the alias
has no matching parser fixture, leave it out and return to parser research
instead of broadening native admission.

- [ ] **Step 2: Regenerate both language representations and run admission tests**

Run:

```bash
node scripts/generate-ios-bank-senders.mjs config/ios-bank-senders.json src/lib/ios-bank-senders.generated.ts modules/wafra-live-capture/ios/WafraBankSenderRegistry.generated.swift
bash scripts/test/build.sh
node scripts/test/ios-capture-setup.test.js
bash scripts/test/native-live-capture-store.sh
git diff --check -- config/ios-bank-senders.json src/lib/ios-bank-senders.generated.ts modules/wafra-live-capture/ios/WafraBankSenderRegistry.generated.swift
```

Expected: exact observed forms normalize to the same AE/SA identities in Swift
and TypeScript; unknown, substring, control, bidi, and display-name-only inputs
remain rejected. Claims in setup copy list only markets/institutions actually
represented by this registry.

- [ ] **Step 3: Rebuild and install the app containing the final registry**

Run:

```bash
npx expo prebuild --platform ios
npx expo run:ios --device
```

Expected: the physical release iPhone runs the candidate containing the exact
generated registry and all five App Intents. Reinspect the generated Xcode
resource membership and record the app version, local build identifier, device
model, and exact iOS build.

- [ ] **Step 4: Build, sign, verify, and hash the local-capture artifact**

Run:

```bash
mkdir -p artifacts
node scripts/build-ios-capture-shortcut.mjs artifacts/WafraLocalCapture.json
bash scripts/check-ios-shortcut-artifact.sh artifacts/WafraLocalCapture.json
plutil -convert binary1 -o artifacts/WafraLocalCapture.shortcut artifacts/WafraLocalCapture.json
shortcuts sign --mode anyone --input artifacts/WafraLocalCapture.shortcut --output artifacts/WafraLocalCapture.signed.shortcut
bash scripts/check-ios-shortcut-artifact.sh artifacts/WafraLocalCapture.signed.shortcut
shasum -a 256 artifacts/WafraLocalCapture.signed.shortcut
```

Expected: the verifier proves the exact two-branch credential-free graph and
rejects every network/file/clipboard/log/output action. Record the signed-file
SHA-256; do not commit the signed artifact or signing material.

- [ ] **Step 5: Build, sign, verify, and hash the history artifact**

Run:

```bash
node scripts/build-ios-history-shortcut.mjs artifacts/WafraHistoryImport.json
bash scripts/check-ios-history-shortcut-artifact.sh artifacts/WafraHistoryImport.json
plutil -convert binary1 -o artifacts/WafraHistoryImport.shortcut artifacts/WafraHistoryImport.json
shortcuts sign --mode anyone --input artifacts/WafraHistoryImport.shortcut --output artifacts/WafraHistoryImport.signed.shortcut
bash scripts/check-ios-history-shortcut-artifact.sh artifacts/WafraHistoryImport.signed.shortcut
shasum -a 256 artifacts/WafraHistoryImport.signed.shortcut
```

Expected: the verifier follows variable dataflow through date choice, exact
count, 64-lowercase-hex GUID hashing, sentinel generation, 50-item chunks,
Begin/Stage/Finish authorization, and complete-session deep link. Record the
signed-file SHA-256 and no session secret.

- [ ] **Step 6: Commit only production alias data if commits are authorized**

```bash
git add config/ios-bank-senders.json src/lib/ios-bank-senders.generated.ts modules/wafra-live-capture/ios/WafraBankSenderRegistry.generated.swift
git commit -m "data: qualify physical iOS bank senders"
```

---

### Task 4: Pass the Local-Capture Physical Gate and Publish Its Exact Artifact

**Files:**
- Read: `artifacts/WafraLocalCapture.signed.shortcut`
- Create locally and keep ignored: `artifacts/WafraLocalCapture.from-icloud.shortcut`
- Modify with observed results only: `docs/test-evidence/ios-shortcuts-release-2026-08-25.md`

**Interfaces:**
- Consumes: the final native app build, final sender registry, deployed scoped relay, and signed local-capture checksum from Task 3.
- Produces: a passing current-stable-iOS local matrix and the exact public `Wafra Local Capture` iCloud URL.

- [ ] **Step 1: Re-prove the complete Apple Message trigger**

On the current stable iOS release, create a new personal automation with these
exact choices:

```text
Trigger: Message
Sender: Any Sender
Message Contains: empty/unset
Execution: Run Immediately
Action: Run Shortcut -> Wafra Local Capture
Input: complete Received Message object
```

Expected: Apple enables Next/Done without a Contact or phrase. If either field
is mandatory, stop the release. Do not enter a bank name, currency, amount,
OTP phrase, or other partial keyword.

Use both a fresh-install state and a controlled existing-user upgrade state.
Prepare the upgrade fixture before installing the candidate: install the last
released/TestFlight build, use that release's exact legacy `Wafra Capture`
Shortcut and Message automation, pair it to a throwaway relay device, and prove
the old path works. Then upgrade that same installation to the candidate. This
is legitimate upgrade testing; installing a legacy graph after the candidate
or calling a fresh-user install an upgrade is not migration evidence. Delete
the throwaway relay device and legacy automation after the matrix. If no
controlled upgrade fixture can be prepared, record the migration matrix as
blocked.

- [ ] **Step 2: Install the exact signed file and prove admission lifecycle**

Install `artifacts/WafraLocalCapture.signed.shortcut` on the physical release
iPhone and recompute/compare its pre-install checksum. Verify:

1. Fresh install and Erase Everything leave native admission disabled.
2. The automation cannot stage while admission is disabled.
3. Explicit **I added the automation** enables admission before running the
   exact `WAFRA_LOCAL_CAPTURE_TEST_V1` proof.
4. The sentinel records setup proof but never creates a purchase or marks a
   real alert captured.
5. On the upgrade fixture, sentinel success leaves the old relay ingest scope
   and supplemental relay products active during dual-run.
6. Manual-only and capture-off disable admission before updating UI state.
7. Re-enabling requires the explicit setup confirmation again.

Expected: every transition matches native status and no raw content appears in
UI, logs, analytics, notifications, URLs, UserDefaults, Keychain, or D1.

- [ ] **Step 3: Exercise the local-capture release matrix**

Record a pass/fail result for each item, with no Message content:

- an unrelated personal SMS and an unknown sender are never staged;
- a known-bank OTP, promotion, balance-only notice, parser miss, no-op decline,
  and rejected review candidate are acknowledged without first-alert status;
- Arabic/RTL, non-Latin digits, alphanumeric sender IDs, shortcodes, and dual
  SIM preserve the stated exact-sender and parsing behavior;
- airplane mode queues and later processes locally with no Message-text network
  request;
- queue retry, duplicate automation invocation, capacity warning,
  corrupt-record recovery, and low storage preserve
  acknowledgement-after-durable ordering;
- a relay/local duplicate produces one durable ledger result;
- a qualifying transaction/payment/statement/due records the milestone after
  durable ensure even when semantic dedupe adds no new row;
- a decline qualifies only after actual reconciliation and a review qualifies
  only after at least one admitted review item;
- scoped relay retirement retries visibly after failure and preserves
  email/PDF/CSV/sync/trusted-device/wake behavior after success.

Use native/device test hooks only for failure injection and boundary counts.
App-closed delivery, force-quit delivery, and reboot/first-unlock delivery each
require a physical incoming Message observed through the real automation; do
not satisfy any of those three with a hook or synthetic record. If the system
drops rather than defers a locked alert before the first unlock after reboot,
stop the release instead of weakening file protection or recording a pass.

- [ ] **Step 4: Prove the real locked-phone delivery series end to end**

Using new real alphanumeric UAE bank alerts from one physically qualified
sender, observe all three source-free cases: (1) Wafra closed and the iPhone
locked after a normal unlock, (2) Wafra force-quit and the iPhone locked, and
(3) the iPhone rebooted, unlocked once, Wafra still closed, and locked again.
For each case confirm the automation runs without a prompt, the alert is
staged, Wafra parses it on next foreground, the ledger/review receipt is
durable, and the raw native record is then acknowledged/deleted. Confirm the
first qualifying result triggers only scoped relay retirement and the old
Shortcut ingest credential receives `401` afterward; later observations remain
local and do not recreate relay ingest.

Expected: the complete result passes on the current stable iOS build. Record
only source-free timing, status, sender evidence ID, market, parser outcome
kind, dedupe result, and retirement status. A screenshot or synthetic alert
does not replace this observation.

- [ ] **Step 5: Inspect network and protected-storage behavior**

Repeat a controlled run through a device-visible network inspector and in
airplane mode. Confirm the Shortcut graph initiates no URL request and no raw
Message text leaves the phone. Inspect only source-free queue/status metadata
after processing and prove the record is gone. Do not capture TLS payloads or
store real alert content in evidence.

- [ ] **Step 6: Publish the exact tested local artifact**

From the owning Apple account, share the installed and just-tested `Wafra Local
Capture` Shortcut to iCloud. Copy the resulting public URL exactly. Open that
URL on a physical iPhone, add the link-provided copy, export it to
`artifacts/WafraLocalCapture.from-icloud.shortcut`, and run:

```bash
bash scripts/check-ios-shortcut-artifact.sh artifacts/WafraLocalCapture.from-icloud.shortcut
```

Expected: the public copy normalizes to the same audited graph as the signed
candidate. Its URL matches the 32-hex iCloud rule and is not the retired URL.
Record the URL and both verifier results only after they pass. If Apple cannot
publish or the link-provided graph differs, stop without configuring EAS.

---

### Task 5: Pass the History-Import Physical Gate and Publish Its Exact Artifact

**Files:**
- Read: `artifacts/WafraHistoryImport.signed.shortcut`
- Create locally and keep ignored: `artifacts/WafraHistoryImport.from-icloud.shortcut`
- Modify with observed results only: `docs/test-evidence/ios-shortcuts-release-2026-08-25.md`

**Interfaces:**
- Consumes: the final iOS 26+ app build and signed history checksum from Task 3.
- Produces: a passing physical history matrix and the exact public `Wafra History Import` iCloud URL, distinct from local capture.

- [ ] **Step 1: Prepare a privacy-safe physical history corpus**

Use an iOS 26.0-or-later release iPhone/account containing only controlled
synthetic SMS/iMessage history for ordinary boundary testing. Preserve one
separate, masked real-bank record only when needed to prove the parser on
carrier SMS; do not place private conversations into the test account,
screenshots, exports, logs, or evidence.

Expected: the corpus has known counts for zero, ordinary, 49, 50, 51, near
10,000, and over 10,000 paths; inclusive end-day boundaries; UTC/date-zone
edges; malformed property sentinels; Arabic/RTL; non-Latin digits;
alphanumeric senders; shortcodes; and dual-SIM delivery.

- [ ] **Step 2: Install the exact signed history file and exercise authorization**

Install `artifacts/WafraHistoryImport.signed.shortcut`, compare its checksum,
and verify Begin creates exactly one local-device-authentication boundary for
the run. Stage every zero-based `[String]` chunk with the returned in-memory
secret, and Finish only after exact count reconciliation. Confirm the shared
artifact embeds no secret and Wafra's bridge never receives one.

Expected: unlocked-device policy may satisfy Begin without displaying Face ID,
but the result must be recorded honestly. No chunk prompts again, and wrong,
reused, expired, or post-Finish secrets fail closed without source output.

- [ ] **Step 3: Exercise the complete history matrix**

Record a pass/fail result for each required behavior:

- Find Messages discovers carrier SMS as well as iMessage with a date-only
  query and no body/sender filter;
- Last 30 days, This year, and Choose dates use inclusive start and exclusive
  next-day end;
- zero stops before Begin, ordinary counts match, and over 10,000 stops before
  staging with a smaller-range prompt;
- GUID, Content, Sender, and real Message Date coerce correctly; IDs are exactly
  64 lowercase SHA-256 hex and a raw UUID/GUID is rejected;
- unextractable required properties contribute exactly `{"v":0}` so found,
  attempted, accepted, and skipped reconcile;
- chunks of 1, 49, and 50 pass; 51 in one native call fails before filtering;
  all-skipped chunks persist their attempted/skipped counts;
- only Finish-complete sessions deep-link into review; open, partial, invalid,
  expired, and tombstoned sessions remain invisible;
- pending handoff returns to Try again/Reinstall after 15 minutes and cancel
  clears it immediately;
- review contains no raw body/sender/GUID, confirmation replans against the
  latest ledger, and native deletion follows only the durable receipt;
- cancel, cleanup failure/retry, one-hour expiry, four-session/24-MiB limits,
  both just-below and just-over the per-session 8-MiB boundary, low storage,
  interruption/retry, lock/reboot, and cross-process contention preserve the
  specified state machine;
- partially downloaded iCloud Messages are described honestly and unavailable
  or deleted history is never claimed as recoverable;
- airplane-mode import succeeds and inspection sees no historical Message text;
- one overlapping live alert and retained-history record produce one ledger
  result without advancing Android's inbox cursor.

Expected: every release requirement passes on the current stable iOS 26+
release. Source review or simulator results may supplement but never replace
this matrix.

- [ ] **Step 4: Verify English and Arabic device-visible behavior**

Switch the physical device/app between English and Arabic. Confirm all five
App Intent titles, parameters, source-free errors, date choices, progress,
matched/skipped totals, review, retry, cleanup, and unsupported-iOS copy load
from the bundled resources with usable RTL order and dynamic type.

Expected: neither locale exposes source data, secret values, or a dead primary
action. iOS 15.1–25.x retains manual paste/PDF paths and clearly states the
iOS 26 requirement.

- [ ] **Step 5: Publish the exact tested history artifact**

From the same owning Apple account, share the installed and just-tested `Wafra
History Import` Shortcut to iCloud. Open the resulting URL on a physical
iPhone, add the link-provided copy, export it to
`artifacts/WafraHistoryImport.from-icloud.shortcut`, and run:

```bash
bash scripts/check-ios-history-shortcut-artifact.sh artifacts/WafraHistoryImport.from-icloud.shortcut
```

Expected: the public copy normalizes to the same audited graph as the signed
candidate. The URL matches the 32-hex rule and differs from both the local URL
and the retired URL. Record it only after the verifier passes.

- [ ] **Step 6: Validate both public URLs together**

Copy the two observed URLs into process-local variables and run this validator
without replacing either value with an example:

```bash
node -e 'const [capture,history]=process.argv.slice(1); const re=/^https:\/\/www\.icloud\.com\/shortcuts\/[0-9a-f]{32}$/i; const c=capture.toLowerCase(),h=history.toLowerCase(),retired="https://www.icloud.com/shortcuts/03d2ab22a33f4fef9d503142575a70fb"; if(!re.test(capture)||!re.test(history)||c===h||c===retired||h===retired) process.exit(1)' "$WAFRA_CAPTURE_URL" "$WAFRA_HISTORY_URL"
```

Expected: exit 0. Both URLs resolve through Apple and both link-installed
artifacts pass their dedicated semantic verifier.

---

### Task 6: Update the One Shared Release Configuration and Public Copy

**Files:**
- Modify: `eas.json`
- Modify: `scripts/check-release-config.mjs`
- Modify: `scripts/lib/release-readiness.mjs`
- Modify: `scripts/test/release-readiness.test.js`
- Modify if the observed TestFlight public link changed: `scripts/check-web-seo.mjs`
- Modify if the observed TestFlight public link changed: `scripts/test/web-seo.test.js`
- Modify: `docs/ios-shortcut-spec.md`
- Modify: `docs/ios-shortcut-build.md`
- Modify: `docs/ios-shortcut-verifier.md`
- Modify: `docs/ios-history-shortcut-spec.md`
- Modify: `docs/privacy-policy.md`
- Modify: `docs/terms-of-use.md`
- Modify: `docs/store-listing.md`
- Modify: `docs/store-launch-package.md`
- Modify: `docs/app-store-release.md`
- Modify: `docs/testflight.md`
- Modify: `docs/launch-readiness.md`
- Modify: `docs/deploy-from-github.md`
- Modify: `README.md`
- Modify: `src/marketing/content.ts`
- Modify: `src/marketing/home.tsx`
- Modify: `src/marketing/home.web.tsx`

**Interfaces:**
- Consumes: both Task 4/5 physically verified public URLs and the actual scoped relay deployment behavior.
- Produces: one consistent EAS configuration, release gate, landing page, legal policy, store listing, launch package, TestFlight guide, and App Review narrative.

- [ ] **Step 1: Write failing shared release-readiness tests**

Extend `scripts/test/release-readiness.test.js` with one table-driven contract
for both `capture-beta` and `production`:

```js
const ICLOUD_SHORTCUT = /^https:\/\/www\.icloud\.com\/shortcuts\/[0-9a-f]{32}$/i;
for (const profile of ['capture-beta', 'production']) {
  const env = eas.build[profile].env;
  ok(`${profile}: local capture URL is an exact public Shortcut`,
    ICLOUD_SHORTCUT.test(env.EXPO_PUBLIC_WAFRA_SHORTCUT_URL));
  ok(`${profile}: history URL is an exact public Shortcut`,
    ICLOUD_SHORTCUT.test(env.EXPO_PUBLIC_WAFRA_HISTORY_SHORTCUT_URL));
  ok(`${profile}: the two graphs stay distinct`,
    env.EXPO_PUBLIC_WAFRA_SHORTCUT_URL !== env.EXPO_PUBLIC_WAFRA_HISTORY_SHORTCUT_URL);
  ok(`${profile}: retired capture URL is absent`,
    !Object.values(env).includes('https://www.icloud.com/shortcuts/03d2ab22a33f4fef9d503142575a70fb'));
  ok(`${profile}: no beta file fallback ships`,
    !Object.hasOwn(env, 'EXPO_PUBLIC_WAFRA_SHORTCUT_FILE_BETA'));
}
```

Add fixture-backed copy assertions for every claim listed in Step 3 and a
negative assertion that no shipping surface says users select Contacts/bank
conversations, that setup proves the personal automation, that Wafra searches
Messages continuously, or that unavailable history can be recovered.

- [ ] **Step 2: Run the release tests and verify they fail before configuration**

Run:

```bash
node scripts/test/release-readiness.test.js
npm run release:check -- --intent build --platform ios --profile production --submit true
```

Expected: FAIL because the exact new local/history URLs are not both present
and the current public copy still describes the retired relay or history
prototype. A failure here must occur before editing shipping profiles.

- [ ] **Step 3: Insert only the two observed public URLs and align claims**

Copy Task 4's local URL byte-for-byte into
`EXPO_PUBLIC_WAFRA_SHORTCUT_URL` and Task 5's history URL byte-for-byte into
`EXPO_PUBLIC_WAFRA_HISTORY_SHORTCUT_URL` in both `capture-beta` and
`production`. Remove `EXPO_PUBLIC_WAFRA_SHORTCUT_FILE_BETA`.

Make app, landing, legal, store, launch, TestFlight, and App Review copy agree
on these exact facts:

- live setup is one ordinary Shortcut plus one Apple Message automation using
  Any Sender, empty Message Contains, Run Immediately, and complete Received
  Message input;
- live candidates are sender-filtered, parsed, saved, and deleted on this
  iPhone; a protected accepted record may wait no more than 30 days;
- the new live Shortcut has no network action, but a user's old relay Shortcut
  may continue its previously disclosed upload during dual-run until the first
  qualifying local alert retires only its Shortcut-ingest scope;
- Apple does not grant Wafra general background inbox access and setup proof
  does not prove Apple's personal automation;
- history import is explicitly user-started on iOS 26+, searches only the
  chosen retained date range, reviews before filing, deletes on confirm/cancel,
  and expires protected staging after one hour;
- Wafra and the history Shortcut do not transmit historical Message text;
  Apple Messages may separately download retained content through the user's
  iCloud settings;
- deleted, expired, unindexed, or unavailable history cannot be recovered;
- manual tracking, paste, PDF, CSV, and other explicit imports remain usable.

App Review instructions use only a controlled synthetic demonstration. They
must not include the real release alert, sender conversation, account/card
digits, Message GUIDs, authorization secrets, or a claim that review staff can
reproduce a personal Message automation in the simulator.

Preserve the existing public TestFlight URL only after opening the actual App
Store Connect public-link page and confirming it. If Apple shows a different
link, copy that observed URL into `src/marketing/content.ts`,
`scripts/check-web-seo.mjs`, and `scripts/test/web-seo.test.js`; never construct
a TestFlight code. Update `docs/deploy-from-github.md` so its shipping-iOS
configuration contract names both distinct Shortcut variables.

- [ ] **Step 4: Implement fail-closed release evaluation**

Update `scripts/lib/release-readiness.mjs` and
`scripts/check-release-config.mjs` so an iOS `capture-beta` or `production`
release fails when either Shortcut URL is absent, malformed, retired, equal to
the other, or overridden by a conflicting process environment value. Keep
development/simulator builds available without pretending they satisfy the
physical gates.

Run:

```bash
node scripts/test/release-readiness.test.js
npm run release:check -- --intent build --platform ios --profile capture-beta --submit false
npm run release:check -- --intent build --platform ios --profile production --submit true
```

Expected: PASS with the exact two observed URLs and no beta file fallback.

- [ ] **Step 5: Export and verify the shared landing page**

Resolve the owned HTTPS site origin from the current production Pages custom
domain. Set that exact value in `WAFRA_SITE_ORIGIN`, then run:

```bash
EXPO_PUBLIC_WAFRA_SITE_URL="$WAFRA_SITE_ORIGIN" npm run web:export
EXPO_PUBLIC_WAFRA_SITE_URL="$WAFRA_SITE_ORIGIN" npm run check:web-seo
node scripts/test/web-seo.test.js
```

Expected: the static root has no JavaScript, preserves the verified TestFlight
link, describes both iPhone flows truthfully, and carries the owned canonical,
Open Graph, and sitemap origin. Private QA routes remain `noindex`.

- [ ] **Step 6: Commit the shared release configuration only if authorized**

```bash
git add eas.json scripts/check-release-config.mjs scripts/lib/release-readiness.mjs scripts/test/release-readiness.test.js scripts/check-web-seo.mjs scripts/test/web-seo.test.js docs/ios-shortcut-spec.md docs/ios-shortcut-build.md docs/ios-shortcut-verifier.md docs/ios-history-shortcut-spec.md docs/privacy-policy.md docs/terms-of-use.md docs/store-listing.md docs/store-launch-package.md docs/app-store-release.md docs/testflight.md docs/launch-readiness.md docs/deploy-from-github.md README.md src/marketing/content.ts src/marketing/home.tsx src/marketing/home.web.tsx
git commit -m "docs: prepare combined iOS Shortcuts release"
```

---

### Task 7: Deploy and Verify the Cloudflare Landing Page

**Files:**
- Read generated output: `dist/index.html`
- Modify with observed results only: `docs/test-evidence/ios-shortcuts-release-2026-08-25.md`

**Interfaces:**
- Consumes: Task 6's verified static export, exact owned site origin, and authenticated Cloudflare account.
- Produces: one Pages deployment whose production custom domain shows the same TestFlight link and privacy claims as repository source.

- [ ] **Step 1: Resolve the exact Pages project without mutating it**

Run:

```bash
cd server
npx wrangler whoami
npx wrangler pages project list --json
```

Expected: exactly one project maps to `WAFRA_SITE_ORIGIN`. Record its exact
project name and current production deployment ID. If no unique mapping exists,
stop; do not guess a project name from the repository or Worker name.

- [ ] **Step 2: Recheck the bytes about to be deployed**

From the repository root run:

```bash
rg -n "testflight\.apple\.com/join|local|history|iCloud|30 days|one hour" dist/index.html
EXPO_PUBLIC_WAFRA_SITE_URL="$WAFRA_SITE_ORIGIN" npm run check:web-seo
```

Expected: the rendered TestFlight URL is the one observed in App Store
Connect, privacy wording agrees with Task 6, and no retired iCloud URL or relay-
only live-capture claim remains.

- [ ] **Step 3: Deploy this exact export to the resolved project**

Set `WAFRA_PAGES_PROJECT` to the exact value returned by Step 1, then run the
documented production Direct Upload form without a preview branch:

```bash
cd server
npx wrangler pages deploy ../dist --project-name "$WAFRA_PAGES_PROJECT"
```

Expected: Wrangler reports one new production Pages deployment. Record its
deployment ID and generated Pages URL; do not equate that success with
custom-domain success.

- [ ] **Step 4: Verify the production custom domain**

After propagation, open the custom domain in a clean browser and run:

```bash
curl -fsSL "$WAFRA_SITE_ORIGIN" -o /tmp/wafra-landing-release.html
rg -n "testflight\.apple\.com/join|local|history|iCloud|30 days|one hour" /tmp/wafra-landing-release.html
```

Expected: the custom domain serves the just-deployed claims and exact verified
TestFlight link over HTTPS. Test the CTA on an iPhone and confirm it opens the
real TestFlight page. Record the Pages deployment ID, custom origin, HTTP
result, and CTA result without fabricating analytics or install counts.

---

### Task 8: Full Integrated Verification and Independent Release Review

**Files:**
- Modify only on discovered failure: files owned by the originating feature task or Tasks 2–7.
- Modify with observed results only: `docs/test-evidence/ios-shortcuts-release-2026-08-25.md`

**Interfaces:**
- Consumes: passing physical matrices, exact published URLs, deployed Worker/D1, deployed landing page, and shared shipping configuration.
- Produces: one reviewed release candidate that is either explicitly ready or explicitly blocked before any EAS production build.

- [ ] **Step 1: Run the complete repository and release gates**

Run:

```bash
npm run typecheck
npm run lint
npm test
npm run check
npm run check:store
npm run check:store-assets
npm run check:store-pricing
npm run store:plan
npm run release:check -- --intent build --platform ios --profile production --submit true
node scripts/test/ios-shortcut-artifact.test.js
node scripts/test/ios-history-shortcut-artifact.test.js
bash scripts/test/native-live-capture-store.sh
bash scripts/test/native-history-store.sh
npm run check:server
git diff --check
```

Expected: every command exits 0, every declared suite runs, both public URLs
remain distinct and exact, the old URL/file fallback is absent, native tests
exercise locks and protection, and server tests exercise the atomic retirement
race. Inspect `git status --short` afterward and ensure task-owned changes do
not absorb unrelated files.

- [ ] **Step 2: Obtain one independent read-only review of the integrated diff**

Give the reviewer both approved specs, all three plans, the complete task-owned
diff, normalized Shortcut sources, verifier outputs, source-free device
matrices, D1/Worker deploy evidence, EAS profile, and public-copy diff. Require
explicit findings for:

- native admission default/opt-out/erase and cross-process queue safety;
- sender overmatch, AE/SA forced-market alignment, mixed-page rejection, and
  acknowledgement-after-durable ordering;
- qualifying milestone semantics and exactly-once scoped relay retirement;
- atomic retirement/ingest ordering and survival of supplemental relay scopes;
- history authorization reuse, exact IDs/counts/chunks, partial visibility,
  tombstones, expiry, and raw-data deletion;
- App Intent availability/localization resource membership;
- exact graph/public-link equivalence and forbidden Shortcut actions;
- distinct shipping URLs, Cloudflare landing consistency, App Review accuracy,
  and absence of fabricated device/deploy/TestFlight claims.

Expected: resolve every P0/P1 finding in its owning feature/release task, rerun
Step 1, and obtain a clean follow-up review. P2 findings are either resolved or
documented with a concrete non-release rationale.

- [ ] **Step 3: Reconcile evidence against every physical requirement**

Compare the evidence file line-by-line with both specs' Physical-iPhone Gate
sections. A gate is ready only when it names the exact physical device/iOS,
exact signed checksum, exact public URL, observed result, and date. Mark the
overall release blocked if any item relies only on a simulator, source review,
generated metadata, a synthetic local-message proof, or an unverified iCloud
link.

- [ ] **Step 4: Verify the final production inputs without building**

Run:

```bash
node -e 'const e=require("./eas.json"); const p=e.build.production.env; console.log(JSON.stringify({relay:p.EXPO_PUBLIC_WAFRA_RELAY_URL,capture:p.EXPO_PUBLIC_WAFRA_SHORTCUT_URL,history:p.EXPO_PUBLIC_WAFRA_HISTORY_SHORTCUT_URL,corpus:p.EXPO_PUBLIC_WAFRA_SMS_CORPUS_EXPORT,founder:p.EXPO_PUBLIC_WAFRA_FOUNDER_UNLOCK},null,2))'
npm run release:check -- --intent build --platform ios --profile production --submit true
eas whoami
eas project:info
npm run check:asc
```

Expected: the printed relay URL is the deployed Worker; capture/history equal
the exact physically verified public links; corpus export and founder unlock
are `0`; EAS reports owner account `@nnnkk`, full project name `@nnnkk/wafra`,
and project ID `fa920e7b-c661-4517-917d-26e8b4878721`; App Store Connect auth
resolves bundle/app ID `6799171482` through the configured production submit
profile. No command creates a build.

---

### Task 9: Make the One Combined iOS Build and TestFlight Submission

**Files:**
- Modify with observed results only: `docs/test-evidence/ios-shortcuts-release-2026-08-25.md`
- Modify only on a discovered pre-build configuration failure: files owned by Task 6.

**Interfaces:**
- Consumes: Task 8's clean integrated release decision and unchanged production configuration.
- Produces: exactly one EAS production iOS build submitted to the configured App Store Connect app, verified in TestFlight on a physical iPhone.

- [ ] **Step 1: Confirm the release has not drifted since review**

Immediately before building, rerun:

```bash
git status --short
git diff --check
git rev-parse HEAD
npm run release:check -- --intent build --platform ios --profile production --submit true
```

Expected: Git state, artifact checksums, public URLs, Worker version, Pages
deployment, and reviewed diff match Task 8. Any drift returns to the owning
task and requires re-review; do not build an unreviewed tree.

- [ ] **Step 2: Invoke the combined build/submission once**

Run exactly once for this integrated release:

```bash
npm run ship:ios
```

Expected: EAS creates one production iOS build and automatically submits that
same build to App Store Connect. Record the EAS build ID, build number, artifact
URL/checksum if exposed, submit request ID, and terminal result. Do not invoke a
second local-only or history-only build. If this invocation fails, record the
exact failure and stop for diagnosis instead of claiming TestFlight was updated.

- [ ] **Step 3: Monitor processing without creating another submission**

Use EAS build details and App Store Connect read-only status checks to follow
the recorded build until Apple reports a terminal processing state. Do not
upload another binary while the first is processing. Record timestamps and the
exact observed state; “submitted,” “processing,” “ready to test,” and “rejected”
are different outcomes.

Expected: the recorded build number appears under TestFlight for App Store
Connect app `6799171482` and reaches **Ready to Test**. A processing failure
leaves the release blocked and is never rewritten as success.

- [ ] **Step 4: Install the exact TestFlight build and verify both embedded links**

On a physical iPhone, install the recorded build from TestFlight. Open the
local-capture and history-import cards and verify each opens its own exact
Task 4/5 iCloud URL. Re-run the source-free sentinel/local admission status and
open a completed synthetic history session; do not repeat or expose the real
bank alert body.

Expected: the TestFlight binary contains both correct links, preserves manual
fallbacks, and matches the reviewed copy. Record device, iOS, build number, and
pass/fail results.

- [ ] **Step 5: Finalize evidence and commit it only if authorized**

Complete the evidence file with the two artifact checksums/URLs, sender
evidence IDs, local/history matrix results, D1 migration/Worker version, Pages
deployment, full verification/review result, EAS build/submission IDs, App
Store Connect status, TestFlight build number, and installed-build check. State
plainly any blocked item; never pre-check an observation.

```bash
git add docs/test-evidence/ios-shortcuts-release-2026-08-25.md
git commit -m "test: record combined iOS Shortcuts release"
```
