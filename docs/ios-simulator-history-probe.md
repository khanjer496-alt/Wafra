# iOS simulator history probe

`.github/workflows/ios-sim-history-probe.yml` answers one question on a
GitHub-hosted macOS runner, without a Mac or an iPhone: how far can the
Shortcuts history route be exercised on an iOS Simulator? It seeds the
simulator's Messages store with the repository's public, redacted bank-alert
corpus, installs the Apple-signed History shortcut the app ships, runs it, and
records what Wafra imported.

It is a probe, not a gate. Every stage keeps going after a failure and leaves
screenshots and files in the `ios-sim-history-probe-<sha>` artifact, so a
single run says, stage by stage, what the simulator can and cannot do.

## What a run proves, and what it never proves

A green stage proves the step finished on a simulator. Read the screenshots and
the paged-store files before claiming anything more.

Nothing in this workflow is physical-iPhone evidence. The Message personal
automation trigger, the sender field, locked-phone delivery, reboot and
force-quit recovery remain the physical gates in
[`ios-beta-readiness.md`](./ios-beta-readiness.md), and the simulator has no
carrier, no iMessage account and cannot receive a message. The seeded rows are
fixtures from `scripts/test/fixtures`, not a person's messages, and the store
they go into belongs to a throwaway simulator device on a throwaway runner.

## Stages

| Stage | What it does | Where it can stop |
| --- | --- | --- |
| 1 | Lists the runtime's apps; requires Shortcuts and Messages. | A runtime without Shortcuts ends the route. |
| 2 | Writes the corpus into `Library/SMS/sms.db` with `scripts/ios-sim/seed-sms-db.py` while the device is shut down, boots, opens Messages. | Run 1 (iOS 26.2): a fresh device has no `sms.db` at all, even after Messages ran, so there is nothing to write into; the stage records a search of the runtime for a template store and fails. The simulator's Messages keeps conversations in memory. |
| 2b | Fallback: sends a bounded number of bodies through the Messages UI. The runtime ships two stub conversations; a message sent in one arrives in the other as an incoming message. | Slow (one Maestro flow per message); capped by `ui_fallback_rows`. |
| 3 | Builds the simulator app (fingerprint-cached under the probe's own key), installs and launches it with the v6 history record configured, and records the first screen plus the app's log lines. | Run 1: a build made with `CODE_SIGNING_ALLOWED=NO` has no entitlements, SecureStore cannot reach the keychain, and Wafra opens on "Your ledger could not be opened". The probe builds with ad-hoc signing instead; `native-sim.yml` still disables signing. |
| 4 | Tries `shortcuts://import-shortcut` with the public https release-asset URL, then the Safari-download route the app's own help text describes; "installed" means `open-shortcut` by name opens the editor rather than a "Could not find the shortcut" sheet. | Run 1: the import URL scheme refused a loopback http URL ("The shortcut URL provided was invalid"), and the first version of the installed check false-matched that sheet. |
| 5 | Opens `shortcuts://run-shortcut?name=…` and answers only affirmative prompts (Allow, OK, Continue) for a bounded number of rounds; captures the unified log for Shortcuts and Wafra. | The shortcut's own "History paused" alerts, a missing Find Messages result, or an intent refusal. |
| 6 | Opens Wafra's history section and paging screen, screenshots them, lists the `WafraPagedHistory` store and copies its small manifests. | Nothing imported, or the app never received the callback. |

## Runtime choice

Shortcuts on the iOS 26.5 and newer simulators cannot run any app's App
Intents ("Unable to run App Shortcut", Apple Developer Forums thread 836585,
FB23342158; no fix reported at the time of writing). The `macos-26` image pairs
Xcode 26.5 and 26.6 with that runtime, so the workflow selects Xcode 26.3 and
creates its device on the iOS 26.2 runtime. `native-sim.yml` still selects the
newest Xcode; a native-sim session on that image therefore runs on an iOS 26.5
simulator where Wafra's intents cannot be invoked from Shortcuts.

## Seeding details

`scripts/ios-sim/build-seed-messages.mjs` turns the UAE and Saudi fixtures,
the two app-exported accuracy reports and the global near-real templates into
rows with a stable GUID each, a sender label inferred from the bank the body
names, and distinct second-resolution dates spread over `seed_days` before the
run. Distinct seconds matter: the paged graph withholds the last whole second
of a page as overlap and requires the next page to return exactly those rows.

`scripts/ios-sim/seed-sms-db.py` introspects every table with `PRAGMA
table_info` and writes only columns that exist, stubs the SQL functions the
store's own triggers call (`verify_chat`, `guid_for_chat`, `is_mic_enabled`
and whatever else the trigger SQL names), writes both `text` and a typedstream
`attributedBody`, and refuses to double-insert a GUID. `scripts/test/ios-sim-seed.test.js`
covers both scripts against a Messages-shaped schema.

## Reading the artifact

- `device.txt`, `xcode.txt`, `listapps.txt`: what ran.
- `sms-schema.sql`, `seed-report.json`: the real store schema on that runtime
  and what the seeder wrote, dropped or defaulted. Use the schema to extend the
  seeder when a runtime adds a NOT NULL column.
- `02-messages*/`, `02b-messages-ui/`: whether Messages shows the rows.
- `04-install/`: which install route worked, with the open-shortcut check.
- `05-run/run-N.png`, `05-run/unified-log.txt`: each prompt round and the
  Shortcuts and Wafra log lines while it ran.
- `06-wafra/`: Wafra's history section, paging screen and store listing.
