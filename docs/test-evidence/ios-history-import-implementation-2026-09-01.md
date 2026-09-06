# iOS History Import physical evidence — 2026-09-01

## 2026-09-02 V3 release-candidate run

The exact V3 production Shortcut completed a full retained-history run on the
physical iPhone 16 Pro running iOS 26.6.1 with standalone Wafra build 44. The
Shortcut queried the newest 1,500 and oldest 1,500 Messages, verified Apple's
sort extremes and overlap boundary, and prepared 3,000 references without a
jetsam event. After native duplicate reconciliation, Wafra loaded 2,374
distinct readable Messages, classified 638 financial alerts and 1,736
non-financial or unread Messages, and presented 194 ledger entries for review.
The user filed the review and the transactions appeared in Wafra. The completed
60-chunk source session was then removed; no Message body or sender is recorded
in this evidence file.

The first run displayed Apple's one-time permission asking whether the Shortcut
may share 3,000 Messages with Wafra. The user selected **Always Allow**. The
active preparation took about 23 minutes on this corpus. This is why onboarding
must disclose a 20–25 minute estimate for a large history and tell the user to
keep Shortcuts open.

- Device: iPhone 16 Pro, iOS 26.6.1.
- Standalone app: `app.wafra.ios` 1.0.0 build 44, EAS build
  `ac48fe06-ae2d-4101-80db-59eafed642d8`.
- Physically exercised public Shortcut:
  `https://www.icloud.com/shortcuts/2869584d40ed454691cf3f916cbee158`.
- Canonical signed artifact SHA-256 before iCloud publication:
  `a94a1a54ea14288184f80fbc2bba1ecf29766c8da78747843b61c6379e164acf`.
- The downloadable iCloud action graph matches the canonical 111-action V3
  production graph after normalizing only Apple's share-time name, Watch
  surface and minimum-client metadata.

The release candidate deliberately fails closed when the two 1,500-Message
halves do not overlap. It therefore covers at most 2,999 retained Messages and
does not claim unlimited inbox access. Apple does not grant Wafra direct inbox
permission; the user explicitly runs this Shortcut. Future alerts use the
separate **Wafra Local Capture** personal Message automation.

## 2026-09-02 bounded-window correction

This investigation is superseded by the V3 two-ended production graph above,
but remains here to document why the one-shot and date-window candidates were
retired.

Build 39 on the same physical iPhone 16 Pro, now running iOS 26.6.1, proved the
complete GUID/Body/Sender/Date, native-finalization, deep-link and parser path at
both 50 and 100 retained Messages. The 100-Message run checked 100, understood
13 and classified 87 as unread/non-financial. Prepared and completed source
directories were empty after consumption.

The one-shot **This year** graph then returned 2,392 Message entities. Apple
kept the array alive during Repeat and killed `BackgroundShortcutRunner` at an
exact 240 MiB high-water mark (`JETSAM_REASON_MEMORY_HIGHWATER`) before the first
Prepare call finished. No Wafra source record was stored. This is direct
evidence that the one-shot 10,001 sentinel is not releasable.

The first replacement V2 graph used one-day windows and safely stopped because
at least one retained day exceeded the 100-Message cap. A second fixed
six-hour graph also safely stopped because one six-hour period held at least
101 Messages. Its Find, Count and Discard actions all succeeded; the only
reported action error was the deliberate Exit, both native source directories
contained only `.lock`, and no new jetsam or runner crash occurred.

The replacement candidate now adapts from day to hour to minute to second
windows, keeps the 101 sentinel with at most 100 accepted Messages per leaf
batch, preserves one global protected session and ends every count-loop
iteration with Nothing. More than 100 Messages in the terminal approximately
one-second leaf remains the date-only Apple query boundary. Its automated gates can be recorded here, but
it is not release evidence until the exact signed artifact reruns the same
2,392-Message year without a jetsam event and leaves no prepared source.

## Superseded capped diagnostic

The capped **Wafra History Import** Shortcut passed a useful physical diagnostic
gate, but it is no longer a release candidate. The product requirement now
includes selectable dates, more than 50 retained Messages, Sender parity and
the same stateful parser/review policy as Android.

- Device: iPhone 16 Pro, iOS 26.6.
- App: `app.wafra.ios` development build 38 from EAS build
  `f676280c-4dba-4037-b6db-5d5bafbb8bc1`.
- Extracted application metadata: exact six-intent compatibility contract;
  arm64; valid code signature; exact English and Arabic resource tables.
- Superseded diagnostic Shortcut SHA-256:
  `de5a88308f3740cf648ee47d67ab05d55e004d09198224c1ad1f236a10907bd1`.
- Superseded diagnostic public link (must not be placed in a new build):
  `https://www.icloud.com/shortcuts/cc85a21db99a4e4698c1a498de670199`.
- The public iCloud page resolved on the physical iPhone with the exact name
  **Wafra History Import**.

No raw Message text, sender, GUID, or record JSON was copied into this evidence
file or command output.

## Physical matrix

| Gate                            | Observed result                                                                                                                                                                   |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Required String parameter state | Direct attachment was rejected by iOS; exact scalar `WFTextTokenString` removed the Session ID prompt.                                                                            |
| Required Date parameter state   | Direct attachment produced sentinels; exact scalar `WFTextTokenString` accepted all five diagnostic records.                                                                      |
| Message property identifiers    | App Intent binding required lower-case `body` and `date`; ordinary Text extraction safely handled GUID and Body coercion.                                                         |
| Five-record property gate       | 5 found, 5 attempted, 5 accepted, 0 skipped. The JS parser understood one financial alert and classified four as unread/non-financial.                                            |
| Stable-GUID 50-record gate      | 50 found, 50 attempted, 50 accepted, 0 skipped. The review UI produced 10 financial candidates.                                                                                   |
| Final clean-store gate          | After calling only the native history bridge `eraseAll`, the final signed extraction graph produced 50 found, 50 attempted, 50 accepted, 0 skipped, with no prepared source left. |
| Direct vector-array probe       | Failed closed because Apple imported the three App Intent arrays empty. This graph is not published.                                                                              |
| Unbounded 2,391-Message probe   | Functionally progressed but projected beyond 20 minutes due to per-App-Intent overhead and was stopped. This graph is not published.                                              |
| Unsupported body query filter   | Apple rejected the Find Message action. This graph is not published.                                                                                                              |

## Why this is not release evidence

The published diagnostic checks only the 50 most recent Messages from the last
30 calendar days and omits Sender from the prepared parser record. It therefore
does not prove scalable history or Android parser parity. No shipping EAS
profile may use this URL. Automatic capture of future Messages remains a
separate Apple Message automation and Shortcut.

## Automated gates

- Shortcut artifact and signing pipeline: 69 passed.
- Native history contract: 67 passed.
- Historical import coordinator: 83 passed.
- iOS setup UX: 105 passed.
- Native warning-as-error harness: 291 passed before the final Shortcut-only
  serialization corrections.
- TypeScript typecheck, ESLint, and `git diff --check`: passed.

## Remaining release evidence

Before external TestFlight testers receive the build, run a short smoke test of
the corrected missed-return recovery and post-save Home navigation from the new
standalone store binary. Also verify one real future bank alert through the
separate Apple Message automation. Append the new TestFlight build ID, build
number, submission ID, processing status and external Beta-group result here.
Build 44 proves the history data path but predates those final recovery and
navigation corrections.

### Corrected TestFlight binary

The corrected standalone store binary is Wafra 1.0.0 build 45:

- EAS build `862e6fcb-0304-46a2-849a-c5348a803c68` completed successfully.
- IPA SHA-256:
  `7b77ca96c39112da25a7ab6ba48cb8c052ccf3b7b7b9a3a2b3c84c295f01c777`.
- Direct inspection found a valid Apple signature, App Store provisioning with
  `get-task-allow=false`, the exact ten-intent metadata contract and both exact
  public Shortcut URLs in the application bundle.
- App Store Connect build `4f4c8aa8-53cc-4260-875a-89f63aef4d26` is `VALID`,
  reports `usesNonExemptEncryption=false`, has accurate build-45 test notes and
  is available to the internal **Team (Expo)** group through that group's
  all-builds access.
- At the user's explicit request on 2026-09-03, build 45 was assigned to the
  external **Beta** group. Apple immediately reported Beta App Review
  `APPROVED` and both internal and external states `IN_BETA_TESTING`. The public
  link remains `https://testflight.apple.com/join/jbwzCgZ6`. The short physical
  recovery/navigation and future-alert smoke tests remain required evidence;
  public availability does not make those unobserved checks pass.
