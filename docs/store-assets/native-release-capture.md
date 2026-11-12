# Native Release screenshot artifacts

Workflow: `.github/workflows/ios-store-capture.yml`. Manual only, repository
read permission, no Apple/EAS login, signing, store upload, live tunnel or
session key. Do not dispatch until CEO/App QA freeze the combined candidate
with the reviewed workflow included. Supply that full40 SHA as `expected_sha`
and select the same workflow ref. A mismatch stops before dependency install.

## Exact matrix

| Language / ledger | Device | Pixels | Surfaces |
| --- | --- | --- | --- |
| English / AE, AED | iPhone17 Pro Max |1320×2868|8|
| Arabic / SA, SAR | iPhone17 Pro Max |1320×2868|8|
| English / AE, AED | iPhone14 Plus |1284×2778|8|
| Arabic / SA, SAR | iPhone14 Plus |1284×2778|8|

All32 are dark appearance: Home, statement Import, Bills, detected Netflix
subscription detail, Accounts, Spending, category limit, Settings. The Netflix
detail is a ledger feature, **not** Wafra's Pro purchase-plan screen. Authentic
Wafra StoreKit prices, paywall and subscription review evidence remain separate.
No silent device substitution, resizing, web rendering, copied old image or
optional destination assertion is allowed.

## Build and fixture path

Build once on an isolated `macos-15` runner, select an installed Xcode26.2+,
normal locked `npm ci` and postinstall, Expo prebuild, CocoaPods, unsigned
`Release` / `iphonesimulator` with bundled `main.jsbundle`. Resolve only the
checked-in `production-candidate` profile's inherited public environment;
assert founder unlock, auto-founder, parser research and corpus flags are0.
Export `EAS_BUILD_PROFILE=production-candidate` before prebuild, including the
Release-metadata cleanup plugin's evaluation. `NODE_ENV=production` is scoped
to the build step, so `npm ci` still includes the locked test/build dependencies.
No shipping fixture/demo flag or code seam is added.

One capture-only generated configuration change is recorded: Expo OTA is off
in generated `Expo.plist`, so repeated launches cannot load JS from another
commit. This simulator configuration is **not** a signed production archive.
Host/widget version equality is checked by the shipping product checker.

`backup.cjs` creates a small ordinary portable backup for each language with
six months of fictional manual transactions, fictional person/account names
and masked tails, UAE/Saudi merchant wording, salary, groceries, dining,
transport, realistic recurring Netflix/Spotify charges, a card due and limits.
It never reads a real ledger, injects entitlement/trial fields or sends a
backup to Wafra's service. The shipping backup validator and subscription
detector must accept it before the native build.

The synthetic capture backups set Private Mode **off** so Import shows its
normal chooser; online merchant logos remain **off** independently. The flow
requires the real enabled `statement-choose` control before taking Import's
image, then navigates away without choosing or uploading a statement. Old
retained Private-Mode-on fixtures are reference evidence, not capture inputs.

Each pass uses a **new** exact simulator. A temporary loopback-only HTTP server
serves just the two synthetic attachments. Simulator Safari downloads the
chosen attachment through its real UI; Wafra welcome's existing Restore opens
the system DocumentPicker; the flow selects the file and confirms the normal
Restore. No database write, SecureStore modification or privileged app route.
The downloaded fixture is not publicly hosted. The app is then restarted
with the recorded Apple language/locale arguments; the restored app preference
also selects the same language. UTC runner calendar,9:41 status bar, full
battery and signal and dark appearance keep the matrix consistent.

**Native validation still required:** Safari's first-run Download and
DocumentPicker Recents selectors are source-planned, not yet proven on this
runner/runtime. If they fail, the job fails and retains its traces; it does
not fall back to a product backdoor. First investigate normal Restore before
considering the separately approved simulator-only seam. Local Mac Xcode is
not upgraded and no local simulator build is part of this workflow work.

## Labels, provenance and acceptance

Apple2.3.9 asks for fictional account information,2.3.3 for the app in use.
Those rules do not specify an on-image sample-data label. Per CEO's explicit
capture decision, there is no inserted label or overlay; provenance and fixture
validation clearly identify the data as synthetic. This supersedes the older
recapture document's mandatory sample-label proposal. Sources:
https://developer.apple.com/app-store/review/guidelines/#accurate-metadata
https://docs.expo.dev/versions/v55.0.0/sdk/document-picker/

`provenance.json` stays `complete:false` until all32 files, exact dimensions,
SHA/date/device/runtime/locale/configuration, fixture hashes and unique image
hashes pass. Old `docs/store-assets` hashes are rejected. The manifest records
run/attempt, runner/Xcode/SDK, app tree/executable/embedded-JS hashes, host build
and version, flags, capture differences and timestamps. Maestro2.12.1 is pinned
with its published release SHA256; its traces and incomplete sets are retained
for7days even if a later pass fails. Only task-created simulators are removed.

`complete:true` means the mechanical matrix passed. It is never upload approval.
App QA must inspect full-resolution safe areas, unique/correct content, Arabic
joining/RTL/hamza and money order, plus a native Arabic reader's review. Do not
automatically replace `docs/store-assets` or upload to App Store Connect.

Focused checks: `python3 -m unittest discover -s scripts/store-capture -p 'test_*.py'`;
`node scripts/store-capture/check-backups.cjs <generated-fixture-directory>` after
the normal `scripts/test/build.sh` compile. Full/local synthetic stress testing
is unnecessary and forbidden on the shared Mac.
