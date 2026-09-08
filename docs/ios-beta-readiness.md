# iOS beta builds and SMS acceptance

Use `/Users/naserkhanjar/Documents/Wafra`, branch `main`, and the normal
`.github/workflows/ios-testflight.yml` workflow. Dated release workflows and
the older checkout are historical records.

## Build and submission

The `history-beta` profile is the founder beta with the current local-capture
and history Shortcuts. Production billing and legal configuration are separate
requirements; founder unlock is not evidence that purchases or restore work.

Before building, verify the source commit, tests and profile:

```sh
git status --short --branch
git rev-parse HEAD origin/main
node scripts/check-design-baseline.mjs
node scripts/check-release-config.mjs --intent build --platform ios --profile history-beta --submit false
npm run update:check
```

After authorization to build, run **Actions → iOS build (TestFlight)** on
`main`, choose `history-beta`, leave `what_to_test` empty and select whether
the request also authorizes submission. `submit=false` produces the signed
IPA without uploading it to Apple. `wait=false` lets GitHub finish once EAS
accepts the job; track the EAS build until it finishes before reporting a
successful build.

Submission is a separate action. An existing successful store-signed build
can be submitted using its exact EAS build ID; do not rebuild to retry an
upload. Confirm Apple processing and the intended tester group separately.
The public TestFlight link is <https://testflight.apple.com/join/jbwzCgZ6>;
the link's existence does not establish which build is available.

The local build route needs the versioned Expo SDK 55 toolchain, Xcode 26.2+
and CocoaPods. EAS generates native projects from current source/configuration;
an old generated native directory is not the cloud build's source of truth.
See [Expo SDK 55](https://docs.expo.dev/versions/v55.0.0/).

## Current Shortcuts and setup

The shipping profile provides **Wafra Local Capture** for future Messages and
**Wafra History Import** for retained history. Their generators and complete
artifact validators live in `scripts/`. Validate the published graphs and
compiled App Intent metadata whenever either changes.

Future iPhone capture follows:

1. A user-configured Apple Message automation invokes Wafra Local Capture.
2. The App Intent stores the supplied message in the protected native queue.
3. Opening Wafra imports it into the ledger or review tray.

This path does not require the relay. Supplemental/legacy relay imports are
separate; relay health and successful push registration do not prove local
Message automation delivery.

Fresh setup starts with future alerts. Past-message import is a separate, optional
section. Users may explicitly defer past messages and finish once future capture
is configured and the automation is confirmed. Existing saved sections and
protected pending-history recovery keep their prior state.
Deferral is persisted as a choice, never as a completed history import or proof
of a real received SMS. Past-message import remains available from Settings;
starting it again clears the deferral. Any protected partial session must be
successfully discarded before recording the choice to defer.

The current history graph can safely refuse an inbox retaining 3,000 or more
Messages when its newest/oldest sets do not overlap. An empty inbox also does
not produce a completed history callback. The explicit deferral path permits
future-only setup in both cases. Do not claim unlimited history import or a
new date-window extractor: neither is provided by this change.

## Physical-iPhone acceptance

Record the installed version/build and source before testing. Artifact checks,
simulator screens and a TestFlight upload do not replace these checks:

- Install the matching Shortcuts and configure the Message automation to run
  automatically with the intended bank messages as input.
- Receive a real bank alert while locked with Wafra closed; verify sender/body
  preservation and one correctly attributed ledger/review entry after opening.
- Repeat while offline, after force-quit and after reboot. Distinguish behavior
  before first unlock from after first unlock; report restrictions accurately.
- Check duplicate/retry delivery and card/account attribution.
- Test real history import, cancellation/return, explicit deferral, relaunch,
  and later history resumption. Verify empty/large inboxes remain usable without
  any false claim of completed history coverage.

For separately enabled relay delivery, also test pairing, encrypted staging,
acknowledgements, offline retry and revocation. A full local staging queue must
reject a new over-capacity batch before writes or acknowledgement. Existing
acknowledged rows stay available; foreground draining frees capacity for retry.
Unacknowledged relay rows expire after 30 days under the server retention
policy, so open Wafra to drain a full queue before that window expires.

## Release claims

Keep the exact source commit, build ID, version, artifact hash and signing
verification with each candidate. Publish/update the website's Android link
only after the corresponding APK is actually available at the target URL.
Building an artifact does not automatically publish it or deploy the website.

Production iOS preflight still requires the real RevenueCat Apple key, hosted
privacy/terms/support URLs and completed contact/operator/jurisdiction/store
details. Do not insert invented values to make that gate green.

## History extraction UX limitation

The current Shortcut extracts messages before returning to Wafra for review.
Keep Shortcuts foreground and the iPhone unlocked during extraction. The app
does not have live preparation counts before native staging. An app-started
handoff reopens Shortcuts without launching another run; a run started manually
inside Shortcuts before that handoff cannot be identified during preparation.
Future-first ordering and optionality do not improve extraction throughput.
Fast first useful real transactions remain a physical-device acceptance target.
