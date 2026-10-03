# Actual iOS setup recordings — 30 September 2026

## Integrated footage

The app registers four actual iOS 26.1 Simulator recordings in
`src/lib/ios-setup-recordings.ts`. English and Arabic captions use the same
English native interface; Arabic playback identifies that interface language.
Full native screens remain visible, with captions outside the recorded UI.

| Recording | Coverage | Duration | Frames | MP4 bytes |
| --- | --- | ---: | ---: | ---: |
| `capture-automation-en.mp4` | Create Message automation | 47.291667 s | 1135 | 857,839 |
| `capture-automation-ar.mp4` | Create Message automation | 47.291667 s | 1135 | 809,628 |
| `history-install-start-en.mp4` | Install and start history import | 67 s | 1608 | 1,826,247 |
| `history-install-start-ar.mp4` | Install and start history import | 67 s | 1608 | 1,780,273 |

All four are silent 720×1740, 24 fps, H.264/yuv420p with fast-start playback.
Their combined MP4 payload is **5,273,987 bytes (about 5.03 MiB)**. Clips, posters,
source/output hashes, caption timing, actual coverage and original-source lineage
are recorded in `assets/videos/ios-setup/recordings-manifest.json`.

### Message automation

The actual signed Wafra Capture v3 Shortcut was installed in an iPhone 16 Pro
simulator. The integrated clip shows New Automation → Message → one space in
Message Contains → Run Immediately → Wafra Capture v3 → the saved automation.
A two-second editorial hold uses the genuine final saved-automation frame.

Its scope is **automation creation only**. The clip does not show Wafra
installation, the permission check or a real incoming bank message. Saving an
automation is not evidence that message delivery or financial capture works.

### History installation and start

The two original takes, `raw/history-setup.mov` and `raw/history-start.mov`, show
Wafra Settings → Data and help → Import past SMS (experimental) → Start history
import → Add the history Shortcut → the system share sheet → Shortcuts → Add
Wafra History v8. The installed Shortcut appears in All Shortcuts. Returning to
Wafra and starting it reaches the real **Import your message history** notice,
then OK and **No available messages / Nothing was added to Wafra**.

The simulator contains no Messages. There is **no recorded Apple Messages
permission prompt, populated import, Review transactions screen or entry filing**.
The Shortcut's own explanatory notice is not an OS permission prompt. The final
chapter gives the remaining phone steps as written instructions explicitly
marked **Not recorded here** over the actual empty-result footage. This is
installation/start evidence, not successful populated-history qualification.

Both raw recordings were normalized to 24 fps before trimming to preserve held
screens in sparse variable-frame-rate footage. One two-second hold uses a real
Wafra frame; a development Refreshing banner between recorded before/after states
was omitted. No interface or result was fabricated. Raw hashes, exact source
parts and editing notes are retained under `history-edit/` and in the integrated
manifest. The reviewed timeline is
`scripts/shortcut-videos/recorded/history-install-start.json`.

## App behavior and remaining media

Only actual recordings are registered as runtime media. Historical illustrations
remain separate, unused artifacts. Apple Pay currently offers written steps only:
no illustrated poster, play button, invented duration or player import. The
Apple Pay setup gate remains iOS 27 or later. Written steps not represented in
the capture or History footage have no invented playback timestamps.

The player is configured to use the recorded aspect ratio, load after Watch,
provide native controls and an explicit full-screen button, and release on
dismissal. Watching or reading does not confirm setup or mutate the ledger.
Browser and native playback qualification are reported separately below.

## Verified checks

- **23 focused video/asset/band tests passed**, recorded in `recording-tests.log`.
  These cover the four-recording registration, media provenance/integrity,
  filmed timestamps, written-only fallbacks and player/component contracts.
- **48 setup/copy tests passed**, recorded in `setup-copy-tests.log`.
- The final **118-test combined setup run passed** in `final-setup-tests.log`,
  including the promoted graph, verification predicate, video integration,
  version gates and static media range handling. These are overlapping suites,
  not counts to add together.
- The bank-text verification predicate repair passed **51 focused tests** and
  independent review. The native UI now correctly waits for a bank text instead
  of treating a nonfinancial queue receipt as confirmed bank capture.
- Final source typecheck and lint completed with exit 0 and no diagnostics
  after the predicate repair (`final-typecheck.log`, `final-source-lint.log`).
  The SDK 55 web export completed in `export.log` and produced the tested `web/`
  snapshot.
- **All four final browser scenarios passed**: English/Arabic × light/dark,
  exercising the integrated capture and History recordings, full-screen
  playback, pause/seek/replay, and Apple Pay's written-only fallback. Checks
  found no media request before Watch, no setup-state mutation and no page
  errors. Results are in `final-browser-tests.log` and `ui/results.json`.
- All four encoded clips fully decoded with FFmpeg. Codec, dimensions, frame
  count, duration, absence of audio, hashes and fast-start structure were checked.
- English/Arabic contact sheets and encoded endings were visually inspected.
  Capture ends on the saved automation; History ends on the empty-simulator
  result with explicitly unrecorded remaining steps.
- The reproducible real-footage renderer lives in
  `scripts/shortcut-videos/recorded/`. Its focused source-hash, range, timing and
  overwrite-safety checks passed; actual source preflight was also exercised.

Two native player checks passed through simulator UI interaction:

- Capture playback and full-screen enter/exit, recorded in
  `native-capture-fullscreen.png`.
- History inline playback at `wafra://ios-paging-beta`, recorded in
  `native-history-playback.png`.

Restarting the task's Metro instance resolved the earlier hot-reload provider
error. These are native video-player checks, not proof of populated History
processing or incoming-message capture. The predicate repair separately prevents
a nonfinancial plain-text receipt from claiming bank capture when
`firstCapturedAt` is null; the native UI now correctly displays a waiting state.

**Remaining qualification:** typed-Message/incoming-bank-message runtime checks,
History import on a physical iPhone with retained Messages, and iOS 27/Apple Pay
footage. The generic progress-save error has been traced to the simulator
file-protection limitation below; its cause is no longer undetermined.

## Native build, signing and setup proof

The local native simulator app now builds after the normal Pod installation and
SQLite module-cache refresh. The app-target signing build reports
`BUILD SUCCEEDED`. **Xcode app-target simulator signing is the working launch
path.** It resolved the initial signing/Keychain configuration problem sufficiently
to run the app and setup proof; that app was used for the Wafra setup and History
recordings. The separate progress-save message comes from the simulator's
file-protection behavior described below, not an established signing failure.

Evidence under `artifacts/real-ios-setup-20260930/`:

- `native-build-verification.json`: arm64 simulator executable, native capture,
  history and video module symbols, App Intents metadata, and matching bundled
  Capture v3 / History v8 resource hashes. This is a Debug simulator app using
  Metro, not a self-contained release binary.
- `xcode-simulator-signing-verification.json` and
  `build-app-target-simulator-signing.log`: successful app-target build,
  signature verification and matching embedded resources.
- `history-v8-metadata-verification.json`: all six required History actions
  present in the extracted App Intents metadata.
- `raw/capture-permission-preflight.mov` and native probe snapshots: the no-input
  setup check produced version-3 native setup proof. This proves the local setup
  connection only; it does not prove ordinary text, typed Message or bank-SMS
  delivery through every capture path.

`adhoc-signing-verification.json` belongs to a **failed launch attempt**. Although
the manually signed copy passed static signature/resource checks, the simulator
denied its launch. It is not the working app or evidence of successful native
execution; only the Xcode simulator-signing path above established that.

These build receipts describe the recorded local simulator builds. They do not
prove that a subsequently promoted Shortcut is already embedded in a freshly
rebuilt app.

The separate capture graph repair remains **pending final qualification**.
`capture-repair/typed-input/runtime-qualification.json` records the earlier
candidate's passing marker check and failing plain-text condition.
`capture-repair/typed-input-v2/candidate-verification.json` records a signed,
graph-verified replacement probe. Later native snapshots establish additional
evidence: its marker advanced version-3 proof at **16:34:15 UTC**, and the
plain-text probe advanced `lastReceivedAt` at **16:35:05 UTC**, leaving one pending
native record and zero acknowledgements. The setup proof stayed unchanged during
that plain-text observation. These facts are in
`typed-input-v2/native-probe-after-marker.json` and
`typed-input-v2/native-probe-after-text.json`.

The canonical 37-action artifact is now present in the bundled source resource.
`capture-repair/canonical/canonical-verification.json` verifies its signature and
that its graph matches the tested probe except for the installed name. Its
SHA-256 is `e3d04e986a0d14a1ffd510c6ad6257fbe907496cd7c160716ddf0ba5c45a1f76`,
which matches the current bundled source file. That receipt explicitly records
typed-Message delivery as **not runtime qualified**. Artifact promotion and final
runtime qualification are separate from the earlier probe receipt. Native queue
admission is not ledger filing, typed-Message automation delivery or real bank-SMS
capture. Neither the marker proof nor that single pending record qualifies all
capture paths.

The canonical setup-only paths now have their own native evidence:
`canonical/native-canonical-after-marker.json` records proof advancing at
**16:43:55 UTC**, and `canonical/native-canonical-after-no-input.json` records a
further advance at **16:47:14 UTC**. Both retained version 3 and changed no queue
counts, receive/handled clocks, first-capture timestamp, dropped count or
corruption state. At these observations the earlier nonfinancial receipt had
already been acknowledged (zero pending, one acknowledged), and
`firstCapturedAt` was still null. These snapshots qualify the canonical marker
and no-input setup checks only; they do not establish bank-message delivery.

## Confirmed simulator History storage limitation

Temporary closed-vocabulary diagnostic tags traced the generic progress-save
message to native `recoverCompletedSession`, which returned
`StoreError.storageFailure` (`NSError` code 16). A Foundation probe compiled for
the iOS 26.1 Simulator reproduced the specific condition: after setting complete
file protection, reading the directory's attributes returned no `.protectionKey`.
The existing Wafra History root showed the same missing attribute. Both paths
were directories with the required `0700` permissions.

`history-simulator-protection-probe.txt` retains only those boolean observations:
the directory/permissions checks are true, while protection-presence and complete
protection checks are false. The native guard in
`modules/wafra-message-history/ios/WafraMessageHistoryStore.swift`,
`validateProtectedDirectory` (around line 663), requires
`attributes[.protectionKey] == FileProtectionType.complete` and therefore refuses
the simulator directory. This establishes the cause of this observed failure;
it is not evidence that protected storage fails the same way on a real iPhone.

No native security check was bypassed or weakened. Temporary source logging was
removed, and `src/lib/ios-history-setup.ts` has no remaining diagnostic diff.
Actual-phone History import still needs verification. The empty-simulator
installation/start recording and successful video playback do not qualify
protected page recovery, populated import or durable filing.

## iOS 27 / Apple Pay blocker

The official iOS 27.0 arm64 runtime (24A434) downloaded and installed. Two boots
stalled at BackBoard readiness before a usable home screen. SpringBoard and
BackBoard remained alive with startup IPC waits; no crash, missing-symbol failure
or explicit host-version rejection was established. The underlying cause remains
unproven. The stalled device was stopped and its runtime retained. Focused samples
are in `ios27-diagnostics/`. Apple Pay footage and native iOS 27 qualification
therefore remain pending; the app provides written instructions only.

No physical-phone message delivery, populated History completion or store
release is established by this evidence. The canonical graph and remaining
native setup behavior remain subject to the final checks noted above.

## Release integration follow-up

The release separates progress-read errors from optional History refresh errors.
History failures are shown in History and no longer obscure a successful Message
setup check. Successful refreshes clear only their own error; real save/check
failures remain visible. Failed hidden History recovery still retries on
foreground, with the existing operation and generation guards. No native file
protection, recovery or receipt behavior was weakened.

The merged route passed 48 source-executed setup tests, including read, write,
recovery and stale-error scenarios. The integrated app passed type checking,
438 generated iOS capture contracts after a fresh prebuild, 74 focused
setup/graph/media tests, and four browser language/theme playback scenarios.
Category creation and UI backup restore were rechecked in both themes after
integration. These checks do not replace the physical-iPhone gates above.
