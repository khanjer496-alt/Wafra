# iPhone UI Release QA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce trustworthy, localized, signed-build evidence for the polished iPhone UI and hand one verified candidate to Wafra's sole existing EAS/TestFlight release owner.

**Architecture:** Static gates establish a clean candidate before any screenshot or remote mutation. A local signed Release simulator build drives exact English/Arabic Maestro store stories; a provenance manifest binds each PNG to source, binary, device, locale, appearance, route/state, and hash. The combined Shortcuts release plan remains the only build/submission lane, and physical-device acceptance occurs against its exact TestFlight build.

**Tech Stack:** Node 22.22.3, Expo/EAS SDK 55 tooling, Xcode signed Release simulator build, Maestro, Argent 0.22.x, App Store Connect CLI preview tools, store metadata/asset gates, physical iPhone.

**Spec:** `docs/superpowers/specs/2026-09-04-ios-release-ui-polish-design.md`

## Global Constraints

- Complete and independently review the accepted foundation, core-screen, and setup/import plans. Native navigation may be accepted or rejected; release is valid in either state.
- `docs/superpowers/plans/2026-08-25-ios-shortcuts-release.md` remains the sole production/EAS/TestFlight owner. This plan prepares evidence and hands it one candidate; it does not create another submission.
- The combined historical plan's Any Sender/empty-filter and old history-graph instructions are superseded. The selected-sender one-page setup and V3 prepared-history artifacts are authoritative.
- Run from a clean candidate checkout. Preserve the user's dirty working tree and never use reset/stash/rebase to manufacture cleanliness.
- Do not invent URLs, keys, legal conclusions, build IDs, device results, screenshot provenance, or physical-iPhone evidence.
- The currently required production values—relay/Shortcut URLs, RevenueCat iOS key, Privacy URL, Terms URL, Support URL—must come from the real production environment. Missing values stop release.
- Do not change App Store encryption answers until the actual app behavior and counsel/export classification are reconciled.
- The Debug `CODE_SIGNING_ALLOWED=NO`/Metro screenshot workflow is review-only and cannot prove SQLCipher/keychain launch behavior.
- Screenshots use only controlled synthetic data. Never include a real message body, bank sender, amount, account/card digits, GUID, phone number, token, or authorization value.
- Capture Apple English first, then Arabic, at exactly 1320×2868 opaque RGB. Official store filenames remain the eight `appstore-6.9-dark-{en|ar}-NN-*` files expected by repository gates.
- Light-mode frames are required for design QA but remain outside the official dark store set unless the human explicitly changes store strategy.
- Every remote metadata/screenshot apply, production build, submission, or upload requires explicit human authorization at execution time.
- Commit commands require separate user authorization.

---

### Task 1: Reconcile release truth before capture

**Files:**
- Create: `docs/test-evidence/ios-ui-release-reconciliation-2026-09-04.md`
- Reference only: `docs/store-metadata.json`
- Reference only: `docs/store-launch-package.md`
- Reference only: `docs/launch-readiness.md`
- Reference only: `docs/app-store-release.md`
- Reference only: `docs/testflight.md`
- Reference only: `docs/store-listing.md`
- Reference only: `app.json`
- Reference only: `eas.json`
- Reference only: `scripts/test/release-readiness.test.js`
- Reference only: `scripts/test/store-package.test.js`

**Interfaces:**
- Consumes: actual current app/EAS/ASC configuration and approved UI/setup claims.
- Produces: one read-only reconciliation/evidence report handed to the combined
  release owner; that owner alone changes production config/shared release
  files. Configuration blockers remain explicit failures rather than prose
  guesses.

- [ ] **Step 1: Snapshot the real configuration state**

Run:

```bash
node --version
npx eas-cli@22.4.0 whoami
npx expo config --type public
npm run release:check
npm run check:launch
npm run check:store
npm run check:store-assets
```

Expected: Node reports 22.22.3 for the release lane. Record every failing key by name. Do not edit configuration merely to silence the checks.

- [ ] **Step 2: Record stale factual documentation for the release owner**

In the new reconciliation report, record the exact source lines that still say
the app is not EAS-linked or has an empty submit config when
`extra.eas.projectId`, bundle ID, and ASC app ID are present. Recommend that the
release owner describe current store assets as format-valid but
provenance-untrusted until Task 4, not as absent or upload-ready.

Keep legal/encryption/storefront-territory items open until their real evidence exists; do not convert uncertainty into a pass.

- [ ] **Step 3: Record the exact store-copy patch for the release owner**

In the reconciliation report, include exact replacement English/Arabic copy
for these `docs/store-metadata.json` claims:

- Home alt text describes the current-period net position, income, and spending—not “safe to spend” or a new remaining-budget model.
- Bills copy describes subscriptions, card dues, and existing utilities/other commitments without claiming a two-group Upcoming/Recurring classifier.
- Import copy distinguishes Future Alerts, Past Alerts, manual paste/document input, and user review.
- Storefront availability is stated separately from launch-tested AED/SAR ledger behavior.

Keep both English and Arabic recommendations semantically equivalent. Do not
edit `docs/store-metadata.json` in this task.

Use these exact replacement alt-text values in the report:

```json
{
  "home": {
    "en-US": "Wafra Home showing current-period net position, income and spending in AED.",
    "ar-SA": "شاشة وفرة الرئيسية تعرض صافي الفترة الحالية والدخل والإنفاق بالدرهم الإماراتي."
  },
  "import": {
    "en-US": "Setup and import choices distinguish future alerts, past alerts, manual paste and document review.",
    "ar-SA": "خيارات الإعداد والاستيراد تميّز بين التنبيهات المستقبلية والتنبيهات السابقة واللصق اليدوي ومراجعة المستندات."
  },
  "bills": {
    "en-US": "Bills grouped as subscriptions, card statement dues, and utilities or other recurring commitments.",
    "ar-SA": "الفواتير مجمعة إلى اشتراكات ومستحقات كشوف البطاقات والمرافق أو الالتزامات المتكررة الأخرى."
  }
}
```

Recommend this English territory clarification for the launch/store documents:
“Storefront availability and launch-tested ledger/import coverage are separate:
this release validates AED/UAE and SAR/Saudi ledger behavior only.” Include its
Arabic equivalent: “إتاحة التطبيق في المتجر منفصلة عن تغطية السجل والاستيراد
المختبرة عند الإطلاق؛ هذا الإصدار يتحقق فقط من سلوك سجل الإمارات بالدرهم
والسعودية بالريال.”

- [ ] **Step 4: Hand real production values to the sole owner**

If the authorized owner provides the real Privacy, Terms, Support, relay,
Shortcut, and RevenueCat values, hand them to the combined release task for its
owned config/environment update. `app.json` owns RevenueCat/privacy/terms/
support values; the EAS production environment owns relay and both
`EXPO_PUBLIC_*_SHORTCUT_URL` values. This UI task does not write either surface.
If any value is missing, stop before screenshot promotion or build.

- [ ] **Step 5: Verify release truth tests**

```bash
node scripts/test/release-readiness.test.js
node scripts/test/store-package.test.js
npm run check:store
npm run check:store-pricing
npx eas-cli@22.4.0 env:exec production "npm run release:check -- --intent build --platform ios --profile production --submit true" --non-interactive
git diff --check -- app.json eas.json docs/store-metadata.json docs/store-launch-package.md docs/launch-readiness.md docs/app-store-release.md docs/testflight.md docs/store-listing.md
```

Expected after the combined release owner applies its owned patch: repository
tests pass and production `release:check` has no blocker. A remaining blocker
stops the plan.

- [ ] **Step 6: Commit if authorized**

```bash
git add docs/test-evidence/ios-ui-release-reconciliation-2026-09-04.md
git commit -m "docs: reconcile iPhone UI release truth"
```

---

### Task 2: Make screenshot provenance a candidate gate

**Files:**
- Create: `scripts/write-store-screenshot-provenance.mjs`
- Create: `scripts/check-ui-screenshot-provenance.mjs`
- Create: `scripts/promote-ui-screenshot-candidate.mjs`
- Create: `scripts/release-tests/ui-screenshot-provenance.test.mjs`
- Create during an actual capture: `artifacts/ui-release-candidate/provenance.json`

**Interfaces:**
- Consumes: eight English and eight Arabic PNGs plus explicit candidate/build/device/capture arguments.
- Produces: schema-versioned hashes and metadata for a candidate directory;
  official store paths/gates remain owned by the combined release task.

- [ ] **Step 1: Add failing provenance tests**

Create the standalone Node test with a temporary-directory fixture and assert
the writer rejects missing `appSourceCommit`, `buildId`, `binarySha256`,
`device`, `osVersion`, `locale`, `appearance`, `capturedAt`, and route/state
metadata. Assert the standalone checker rejects a changed PNG hash. Keep this
test outside `scripts/test/*.test.js` so it does not alter the strict app-suite
registry.

Also test that the promotion tool rejects a missing confirmation string,
preserves unrelated 6.5-inch files, replaces exactly the sixteen 6.9-inch
files plus provenance, and leaves a recoverable previous directory.

- [ ] **Step 2: Implement the provenance writer**

The CLI accepts only explicit arguments and rejects an empty value:

```text
--app-source-commit
--build-id
--binary-sha256
--device
--os-version
--locale
--appearance
--captured-at
--directory
--story-json
--output
```

`--story-json` points to the Task 3 array containing exactly eight objects with
`index`, `slug`, `route`, and optional `state`. For the selected locale, the
writer derives the exact filename
`appstore-6.9-dark-{en|ar}-{index}-{slug}.png`, reads it, validates 1320×2868
RGB, computes SHA-256, and writes:

```ts
type StoreScreenshotProvenance = {
  schemaVersion: 1;
  candidate: { appSourceCommit: string; buildId: string; binarySha256: string };
  captures: {
    device: string;
    osVersion: string;
    locale: 'en-US' | 'ar-SA';
    appearance: 'dark';
    capturedAt: string;
    frames: { file: string; route: string; state?: string; sha256: string }[];
  }[];
};
```

The writer creates the first locale capture or replaces the capture with that
same locale; it never discards the other locale. It permits one locale while
capture is in progress. Reject non-ISO timestamps, duplicate filenames, wrong
frame count, missing files, and an unclean/non-resolving source commit.

- [ ] **Step 3: Gate the candidate directory against provenance**

Implement `check-ui-screenshot-provenance.mjs` to require both locale captures
before candidate promotion and compare every recorded hash/route/state to the
eight-item story JSON. It validates count, 1320×2868, opaque RGB, uniqueness,
one en-US plus one ar-SA capture, and source-commit ancestry. It does not write
official store assets.

Implement the promotion CLI with this exact interface:

```text
node scripts/promote-ui-screenshot-candidate.mjs \
  --source artifacts/ui-release-candidate \
  --destination docs/store-assets/appstore \
  --story-json .maestro/store/apple-69-story.json \
  --confirm PROMOTE_REVIEWED_IPHONE_69_SCREENSHOTS
```

It runs the checker first, copies the current destination to a sibling staging
directory, replaces exactly the sixteen `appstore-6.9-dark-{en|ar}-*` files and
`provenance.json`, preserves all other files, renames the current directory to
a timestamped `.previous-*` sibling, then renames staging into place. It prints
the recovery directory and never deletes it. Only the combined release owner
may run this confirmation-gated command.

Before any copy/rename, resolve the repository root and both arguments with
`realpath`. Require source to equal exactly
`path.join(repositoryRoot, 'artifacts/ui-release-candidate')` and destination
to equal exactly `path.join(repositoryRoot, 'docs/store-assets/appstore')`;
require both `lstat` results to be
directories and not symbolic links. Reject the filesystem root, home directory,
repository root, missing parents, paths outside the repository, globs, and any
different source/destination. The standalone test exercises every rejection
before testing the recoverable swap.

- [ ] **Step 4: Verify the tooling**

```bash
node --test scripts/release-tests/ui-screenshot-provenance.test.mjs
node scripts/check-ui-screenshot-provenance.mjs --directory docs/store-assets/appstore --story-json .maestro/store/apple-69-story.json --provenance docs/store-assets/appstore/provenance.json
```

Expected before recapture: the checker fails because the candidate directory is
not complete. Official `npm run check:store-assets` is unchanged.

- [ ] **Step 5: Commit if authorized**

```bash
git add scripts/write-store-screenshot-provenance.mjs scripts/check-ui-screenshot-provenance.mjs scripts/promote-ui-screenshot-candidate.mjs scripts/release-tests/ui-screenshot-provenance.test.mjs
git commit -m "test: bind store screenshots to release provenance"
```

---

### Task 3: Build exact English and Arabic store stories

**Files:**
- Create: `.maestro/store/apple-69-en-US.yaml`
- Create: `.maestro/store/apple-69-ar-SA.yaml`
- Create: `.maestro/store/apple-69-story.json`
- Create: `scripts/capture-ios-store-screenshots.sh`
- Modify: `.github/workflows/device-shots.yml`

**Interfaces:**
- Consumes: signed Release simulator app, synthetic sample ledger, exact store story.
- Produces: sixteen dark official candidates plus separate light/dark review frames; unsigned CI shots remain clearly labeled informal.

- [ ] **Step 1: Encode the exact story**

Create `apple-69-story.json` with these ordered records and no additional frame:

```json
[
  {"index":1,"slug":"home","route":"/"},
  {"index":2,"slug":"import","route":"/import-sms"},
  {"index":3,"slug":"bills","route":"/bills"},
  {"index":4,"slug":"subscription-detail","route":"/bills","state":"subscription-detail"},
  {"index":5,"slug":"wallet","route":"/wallet"},
  {"index":6,"slug":"flow","route":"/flow"},
  {"index":7,"slug":"limits","route":"/flow","state":"limits"},
  {"index":8,"slug":"settings","route":"/settings"}
]
```

- [ ] **Step 2: Create deterministic English flow**

The English Maestro flow:

1. clears state and selects Start with Sample Data;
2. waits for Home's seeded ledger;
3. captures Home;
4. opens the repository-tested `wafra://import-sms` link and captures the import-choice state with no private content;
5. returns, opens Bills, captures its default segment;
6. opens the first seeded subscription detail and captures it;
7. opens Wallet and captures statement/due rows;
8. opens Flow and captures its comparison/chart;
9. opens the first limit detail and captures limits;
10. opens Settings and captures the Privacy group in view.

Use stable accessibility labels/test IDs, not headline text, for taps. Name files exactly `appstore-6.9-dark-en-01-home` through `08-settings`.

- [ ] **Step 3: Create deterministic Arabic flow**

The Arabic flow starts from the same synthetic ledger, switches language through the tested Settings choice, relaunches when required for router/gesture direction, verifies Arabic tab labels, then repeats the same route/state sequence. Name files `appstore-6.9-dark-ar-01-home` through `08-settings`.

Do not mirror English images or replace Arabic labels in post-processing.

- [ ] **Step 4: Create the signed capture script**

The script exposes this exact interface:

```bash
bash scripts/capture-ios-store-screenshots.sh \
  --app-source-commit "$(git rev-parse HEAD)" \
  --device-name 'iPhone 16 Pro Max' \
  --derived-data /tmp/wafra-store-capture \
  --candidate-dir artifacts/ui-release-candidate \
  --review-dir artifacts/ui-review
```

It rejects unknown/missing arguments, a non-macOS host, non-clean source state,
or an `--app-source-commit` different from `HEAD`. Implement these exact stages:

1. require `xcrun`, `jq`, `maestro`, `shasum`, Node 22.22.3, EAS CLI 22.4.0,
   and the production EAS identity;
2. run `npx expo prebuild --platform ios --no-install` only when
   `ios/Wafra.xcworkspace` is absent, and `npx pod-install` only when
   `ios/Pods` is absent;
3. resolve the named available simulator with `simctl ... -j`, require a
   non-empty UDID, boot it, and wait with `simctl bootstatus -b`;
4. store the parsed arguments as `CAPTURE_DEVICE_ID` and
   `CAPTURE_DERIVED_DATA`, then run
   `npx eas-cli@22.4.0 env:exec production "DEVICE_ID=$CAPTURE_DEVICE_ID CONFIGURATION=Release DERIVED_DATA=$CAPTURE_DERIVED_DATA bash scripts/e2e/adversarial/build-ios-simulator.sh" --non-interactive`;
5. require the returned app at
   `$CAPTURE_DERIVED_DATA/Build/Products/Release-iphonesimulator/Wafra.app`, verify signing,
   install it, and read `CFBundleShortVersionString` plus `CFBundleVersion` with
   `/usr/libexec/PlistBuddy` as the build ID;
6. derive `binarySha256` from the signed executable and CodeResources:

```bash
CAPTURE_BINARY_SHA=$(
  {
    shasum -a 256 "$CAPTURE_APP_PATH/Wafra"
    shasum -a 256 "$CAPTURE_APP_PATH/_CodeSignature/CodeResources"
  } | shasum -a 256 | awk '{print $1}'
)
```

7. set dark appearance, then run English and Arabic with
   `maestro test --udid "$CAPTURE_DEVICE_ID" --test-output-dir "$CAPTURE_RAW_LOCALE_DIR"
   -e APP_ID=app.wafra.ios "$CAPTURE_FLOW"`; copy the named `takeScreenshot` PNGs into
   the candidate directory and require the exact eight names per locale;
8. import `stripAlpha()`/`readPngHeader()` from `scripts/e2e/png-rgb.mjs` in a
   Node ESM loop, rewrite each candidate PNG, and require 1320×2868 type-2 RGB;
9. run both flows again in light appearance into the review directory only;
10. invoke `write-store-screenshot-provenance.mjs` once per locale with actual
    source commit, derived build ID/binary hash, device, runtime from
    `simctl getenv ... SIMULATOR_RUNTIME_VERSION`, ISO capture time, story,
    candidate directory, and the same provenance output;
11. run `check-ui-screenshot-provenance.mjs` and exit 0 only when both locales
    pass.

The two writer calls and final checker are:

```bash
for CAPTURE_LOCALE in en-US ar-SA; do
  node scripts/write-store-screenshot-provenance.mjs \
    --app-source-commit "$CAPTURE_APP_SOURCE_COMMIT" \
    --build-id "$CAPTURE_BUILD_ID" \
    --binary-sha256 "$CAPTURE_BINARY_SHA" \
    --device "$CAPTURE_DEVICE_NAME" \
    --os-version "$CAPTURE_OS_VERSION" \
    --locale "$CAPTURE_LOCALE" \
    --appearance dark \
    --captured-at "$CAPTURED_AT" \
    --directory "$CAPTURE_CANDIDATE_DIR" \
    --story-json .maestro/store/apple-69-story.json \
    --output "$CAPTURE_CANDIDATE_DIR/provenance.json"
done
node scripts/check-ui-screenshot-provenance.mjs \
  --directory "$CAPTURE_CANDIDATE_DIR" \
  --story-json .maestro/store/apple-69-story.json \
  --provenance "$CAPTURE_CANDIDATE_DIR/provenance.json"
```

The script never writes `docs/store-assets/appstore` and has no promotion flag.

Operationally it therefore:

- requires macOS, `xcrun`, Maestro, `jq`, and a clean candidate commit;
- calls `scripts/e2e/adversarial/build-ios-simulator.sh` rather than unsigned Debug xcodebuild;
- invokes that build inside `eas env:exec production` so the local Release
  bundle consumes the same public production configuration as the release
  candidate;
- requires an iPhone 16 Pro Max simulator whose screenshot is exactly 1320×2868;
- hashes the signed main executable plus `_CodeSignature/CodeResources` before launch;
- sets dark appearance and runs English before Arabic;
- writes raw captures under a temporary candidate directory first;
- imports `stripAlpha()` from `scripts/e2e/png-rgb.mjs` in a Node ESM step and
  rewrites each candidate PNG to opaque RGB before validation;
- captures a separate light/dark review matrix under `artifacts/ui-review/` without copying light images into official store assets;
- invokes the provenance writer with actual commit/build/device/OS/time values;
- exits after candidate validation without replacing `docs/store-assets/appstore`.

- [ ] **Step 5: Mark unsigned CI shots as informal**

Rename workflow steps/artifacts in `device-shots.yml` to contain `review-only-unsigned-debug`. Add a job summary warning that its `CODE_SIGNING_ALLOWED=NO`/Metro frames cannot prove the encrypted ledger or be copied into App Store assets. Keep the workflow useful for quick visual review.

- [ ] **Step 6: Verify flow/tool syntax**

```bash
ruby -e "require 'yaml'; ARGV.each { |file| YAML.load_stream(File.read(file)); puts file }" .maestro/store/apple-69-en-US.yaml .maestro/store/apple-69-ar-SA.yaml
bash -n scripts/capture-ios-store-screenshots.sh
node scripts/test/store-package.test.js
git diff --check -- .maestro .github/workflows/device-shots.yml scripts/capture-ios-store-screenshots.sh
```

Expected: both flows parse, shell syntax passes, and no real store asset is changed yet.

- [ ] **Step 7: Commit if authorized**

```bash
git add .maestro/store scripts/capture-ios-store-screenshots.sh .github/workflows/device-shots.yml
git commit -m "test: add signed localized App Store capture flows"
```

---

### Task 4: Capture, review, and promote exact store frames

**Files:**
- Create: `artifacts/ui-release-candidate/appstore-6.9-dark-en-*.png`
- Create: `artifacts/ui-release-candidate/appstore-6.9-dark-ar-*.png`
- Create: `artifacts/ui-release-candidate/provenance.json`
- Create with actual evidence: `docs/test-evidence/ios-ui-polish-release-2026-09-04.md`
- Release-owner promotion only: `docs/store-assets/appstore/appstore-6.9-dark-{en,ar}-*.png`
- Release-owner promotion only: `docs/store-assets/appstore/provenance.json`

**Interfaces:**
- Consumes: clean source commit, signed Release simulator binary, Task 3 flows.
- Produces: reviewed English/Arabic candidate tied to actual app source/build;
  the combined release owner alone promotes it to official store paths.

- [ ] **Step 1: Run the signed capture**

Run the exact Task 3 CLI with `--app-source-commit "$(git rev-parse
HEAD)"`. Do not pass guessed values and do not capture from a personal ledger.

- [ ] **Step 2: Review every raw frame before promotion**

For all sixteen official candidates and the light/dark review set, inspect:

- focal hierarchy and exact financial labels;
- no clipping, overlap, keyboard, safe-area, tab-bar, or sheet issue;
- correct English/Arabic direction, text, numerals, currency, and icons;
- no placeholder/legal/debug/sample-control UI;
- no real/private data;
- correct route/state story order;
- distinct but semantically equivalent localization.

Use screenshot diff only to locate change; human review decides whether the new hierarchy is correct.

- [ ] **Step 3: Hand the validated promotion command to the release owner**

Only after all sixteen pass, hand the candidate checker output and this exact
confirmation-gated command to the combined release owner:

```bash
node scripts/promote-ui-screenshot-candidate.mjs \
  --source artifacts/ui-release-candidate \
  --destination docs/store-assets/appstore \
  --story-json .maestro/store/apple-69-story.json \
  --confirm PROMOTE_REVIEWED_IPHONE_69_SCREENSHOTS
```

The UI task does not execute it. The owner verifies the printed recovery path
and never mixes old/new frames or a partial locale.

- [ ] **Step 4: Write source-free evidence**

The evidence file records `appSourceCommit`, the local signed executable/
CodeResources hash, device/OS, locale/appearance, capture time, frame hashes,
test commands/results, reviewer, and blocked physical-only rows. A later
evidence/assets commit may descend from `appSourceCommit` only when
`git diff --name-only appSourceCommit..HEAD` is restricted to reviewed
assets/docs/evidence/tooling and contains no app/server/native source change.
This avoids the impossible capture-then-recommit loop while proving the built
app source is unchanged. The file contains no message/source content or
invented result.

- [ ] **Step 5: Run store gates**

```bash
npx eas-cli@22.4.0 whoami
npm run asc:auth:doctor
npm run check:asc
npm run check:store-assets
npm run store:plan
npm run store:prepare:assets
npm run asc:screenshots:preview
git diff --check -- docs/store-assets/appstore docs/test-evidence/ios-ui-polish-release-2026-09-04.md
```

Expected after the combined release owner promotes the candidate: counts,
dimensions, RGB, localization uniqueness, provenance hashes, story
routes/states, package preparation, and dry-run ASC preview pass.

- [ ] **Step 6: Commit evidence; leave official assets to the release owner**

```bash
git add docs/test-evidence/ios-ui-polish-release-2026-09-04.md
git commit -m "docs: record reviewed iPhone screenshot evidence"
```

The combined release owner separately reviews/stages the exact sixteen official
assets plus provenance. Do not stage its shared store directory from this task.

---

### Task 5: Run the clean candidate gate

**Files:**
- Review only: exact candidate checkout and generated configuration

**Interfaces:**
- Consumes: candidate commit with accepted UI/navigation and reviewed assets.
- Produces: one source/build handoff to the combined Shortcuts release owner.

- [ ] **Step 1: Create a disposable clean checkout**

Do not choose a candidate commit until the combined release owner has run the
validated promotion tool, reviewed its recovery directory, and committed the
sixteen official 6.9-inch frames plus `docs/store-assets/appstore/provenance.json`.
Require the provenance file and all sixteen paths to be tracked by Git.

Create a detached disposable worktree from the reviewed candidate commit; do
not clean the user's active checkout:

```bash
UI_CANDIDATE_COMMIT=$(git rev-parse HEAD)
UI_GATE_DIR=$(mktemp -d /tmp/wafra-ui-release-gate.XXXXXX)
git worktree add --detach "$UI_GATE_DIR" "$UI_CANDIDATE_COMMIT"
cd "$UI_GATE_DIR"
test -z "$(git status --short)"
test "$(git rev-parse HEAD)" = "$UI_CANDIDATE_COMMIT"
```

After every gate/evidence read is complete, leave the directory and run
`git worktree remove "$UI_GATE_DIR"` from the original checkout. Do not use
`--force`; a non-clean disposable worktree must be inspected.

Read `appSourceCommit` from screenshot provenance into
`UI_APP_SOURCE_COMMIT`, require
`git merge-base --is-ancestor "$UI_APP_SOURCE_COMMIT" HEAD`, and inspect:

```bash
git diff --name-only "$UI_APP_SOURCE_COMMIT"..HEAD
```

Allow only reviewed assets/docs/evidence/release-tooling paths. Any app,
server, native-module, package, or runtime-config change requires a new signed
capture from the new source commit.

- [ ] **Step 2: Run source/dependency gates with Node 22.22.3**

```bash
npm ci
npm --prefix server ci
npx expo install --check
npm run doctor
npm run check
npm run test:e2e
npm audit --omit=dev
npm --prefix server audit --omit=dev
node --test scripts/release-tests/ui-screenshot-provenance.test.mjs
node scripts/check-ui-screenshot-provenance.mjs --directory docs/store-assets/appstore --story-json .maestro/store/apple-69-story.json --provenance docs/store-assets/appstore/provenance.json
npm run check:store-assets
npm run store:plan
```

Expected: all commands exit 0. Audit findings require explicit review; do not auto-upgrade Expo/React Native during release.

- [ ] **Step 3: Run production configuration gates**

```bash
npx eas-cli@22.4.0 env:exec production "npm run release:check -- --intent build --platform ios --profile production --submit true" --non-interactive
npx eas-cli@22.4.0 env:exec production "node scripts/check-update-config.mjs --environment production" --non-interactive
npx expo config --type public
npx expo config --type introspect
```

Expected: correct owner/project/bundle/ASC IDs, legal/support URLs, RevenueCat, relay/Shortcut URLs, update runtime/channel, keychain groups, privacy manifests, and App Intent resources. Any mismatch stops the build.

- [ ] **Step 4: Inspect disposable native output**

In the disposable checkout only:

```bash
npx expo prebuild --platform ios --no-install
npx pod-install
```

Inspect generated entitlements, keychain access groups, SQLCipher/native modules, App Intent resources, URL schemes, privacy manifests, Info.plist encryption keys, and Release configuration. Delete the disposable checkout afterward; do not copy generated native projects into the source tree.

- [ ] **Step 5: Hand the exact commit to the sole release owner**

Provide the combined release owner both the candidate/evidence SHA and
`UI_APP_SOURCE_COMMIT`, the restricted descendant diff, clean-gate output,
signed screenshot provenance, accepted/rejected NativeTabs decision, and
outstanding physical-only rows. Do not invoke EAS from this task.

---

### Task 6: Submit once and verify the physical TestFlight build

**Files:**
- Update with actual evidence: `docs/test-evidence/ios-ui-polish-release-2026-09-04.md`
- Release-owner update after exact build exists: release/TestFlight/store launch documents

**Interfaces:**
- Consumes: Task 5 handoff and the sole combined release plan.
- Produces: one submitted build, complete physical matrix, and explicitly authorized store metadata/screenshots.

- [ ] **Step 1: Let the existing release owner run one build lane**

After explicit user authorization, the combined release owner runs its validated production preflight and invokes `npm run ship:ios` exactly once. Record actual EAS build ID, app version/build number, commit, submission ID, and ASC processing result.

- [ ] **Step 2: Wait for and install the exact TestFlight build**

Do not treat EAS completion or ASC processing as device evidence. Install the exact processed build on the designated physical iPhone after the user unlocks it.

- [ ] **Step 3: Run the physical UI/data matrix**

Verify fresh install, onboarding, manual transaction, edit/delete confirmation, Home/Flow/Bills/Wallet, card details, Settings/Pro purchase cancel/restore/manage paths, selected-sender future setup, real future bank alert verified, past-history import, origin-aware return, lock/reboot, VoiceOver, largest Dynamic Type, Arabic RTL/back gestures, Reduce Motion/Transparency, keyboard/sheets, protected erase, and controlled existing-user migration.

Physical rows that cannot be exercised remain failed/blocked; do not substitute simulator evidence.

- [ ] **Step 4: Reconcile evidence to the exact submitted build**

Update the source-free evidence file with the actual TestFlight build and observations. Confirm the screenshot provenance commit/config matches the submitted candidate; recapture if the submitted UI differs.

- [ ] **Step 5: Preview remote metadata and screenshots**

```bash
npm run asc:auth:doctor
npm run check:asc
npm run asc:metadata:validate
npm run asc:metadata:preview
npm run asc:screenshots:preview
```

The current screenshot command uses `--skip-existing`; it does not replace obsolete remote frames. The human must review/remove old frames in the proper App Store Connect version before authorizing upload.

- [ ] **Step 6: Apply only with explicit human authorization**

After the human approves the exact preview and remote replacement sequence, run the repository's confirmation-gated metadata/screenshot apply commands. Never infer approval from earlier permission to write code or create a build.

```bash
WAFRA_ASC_CONFIRM=APPLY_REVIEWED_APPLE_METADATA npm run asc:metadata:apply
WAFRA_ASC_CONFIRM=UPLOAD_REVIEWED_APPLE_SCREENSHOTS npm run asc:screenshots:apply
```

Because screenshot apply is additive/`--skip-existing`, remove/replace obsolete
remote frames only through the separately reviewed App Store Connect migration
the human approved; these commands do not perform that deletion.

- [ ] **Step 7: Final release review**

Require one independent read-only review of candidate SHA/build identity, all command outputs, physical matrix, privacy/legal/store claims, screenshot hashes/provenance, remote preview, and the fact that only one build/submission lane ran.

- [ ] **Step 8: Commit final evidence if authorized**

```bash
git add docs/test-evidence/ios-ui-polish-release-2026-09-04.md
git commit -m "docs: record the verified iPhone UI release candidate"
```

The combined release owner separately updates and stages its owned launch,
TestFlight, App Store, configuration, and submission documents with the exact
build identifiers.
