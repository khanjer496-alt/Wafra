# iPhone setup simplification, 2026-09-25

The owner's decision on 2026-09-25 ("Option 1"): on iPhone, **past** spending comes from bank
statements (PDF/CSV from the bank app). **New** transactions come from live capture, through the
Messages automation that runs the bundled Wafra Capture Shortcut. Importing SMS history through
Shortcuts is taken out of setup. Apple Pay and iOS 27 bank-app notifications stay optional and are
not offered during onboarding. Android is unchanged.

Word counts come from the shipping copy (`src/lib/i18n.ts`, `ios-shortcut-setup-copy.ts`,
`supplement-copy.ts`). They count every visible word on a screen in its default state, including
headers, buttons and step labels. They leave out decorative scenes and text behind a
disclosure. The before counts use commit `5603f764`.

## Before: the journey as it shipped

After the questionnaire (welcome, name, focus, tracking, alerts, intention, preview), the iPhone flow was:

| # | Screen | Words (en / ar) | What it asked |
|---|--------|-----------------|---------------|
| 1 | Onboarding "Choose how to add activity" | 42 / 39 | Three equal choices: Connect bank alerts, Import bank statements, Start manually. A three-row trust card and a Learn more sheet. |
| 2 | Setup: add Shortcut | 94 / 83 | A two-row checklist ("Automatic bank alerts", "Past messages · Optional"), the Shortcut name, share-sheet instructions, "Other ways to connect" (Apple Pay; iOS 27 notifications), "Continue to Wafra without automatic capture". |
| 3 | Setup: confirm Shortcut | 104 / 90 | The same checklist, plus "I added it — run setup check". |
| 4 | Setup: setup check | 92 / 86 | "Run the setup check", a note on proof, Permission help. |
| 5 | Setup: automation | 151 / 129 | All the Apple steps in one block, an "existing automation" note, three buttons. |
| 6 | Setup: ready + history offer | 101 / 85 | "Import past messages" next to Finish, and a three-line completion reveal. |
| 7 | Statement import: connect | 84 / 71 | A separate "Connect secure import" card before any file could be chosen. |
| 8 | Statement import: choose files | 152 / 129 | Limits, a disclosure, "Choose statements", an empty coverage card, a privacy block. |
| | **Total** | **820 / 712** | |

**In-app taps on the happy path** (Capture v3, statements included): Import bank statements →
Connect → Choose statements → Back → Connect bank alerts → Add Shortcut → Open Shortcuts →
I set it up → Finish setup = **9**. Without statements: **5**. Apple's own screens (share sheet,
Allow, the automation editor) come on top in both cases.

**Error states (before):**
- Install: "Shortcut did not open. Try again."
- Test run: 30 words, and it sends the user to Help.
- "Apple Shortcuts is not installed." (no action in the sentence)
- "Update Wafra to enable message capture."
- A setup-state error that mentions History Import on every setup screen.
- "Setup could not be saved. Try Finish again."
- The check failure and repair: two sentences plus a Shortcut-name line.
- 14 statement errors, several without an action.

**Other places SMS history appeared:**
- the Past messages checklist row and "Import past messages" in setup;
- the history card at the top of `/import-sms` on iPhone (reached from Wallet, Pro and the Assistant);
- the Settings row "Bank alerts · Set up new messages or import history";
- the Wallet detail "Forwarded email, PDF statement, or your bank Shortcut".

## After

| # | Screen | Words (en / ar) | Primary action · way past it |
|---|--------|-----------------|------------------------------|
| 1 | "Bring in your past spending" (Step 1 of 2) | 28 / 20 | Add a statement · Later |
| 2 | Statement import (first run) | 57 / 48 | Choose file · Later → Continue once something is added |
| 3 | "Catch new transactions" (Step 2 of 2) | 26 / 23 | Set up · Not now |
| 4 | Guide 1 · Add the shortcut | 34 / 30 | Add Shortcut |
| 5 | Guide 1 · Back from Shortcuts? (only if the automatic test did not run) | 33 / 27 | I added it — test it |
| 6 | Guide 2 · Test it (only if the test failed or stopped) | 28 / 26 | Run test; if it fails: Add the shortcut again / Run test again |
| 7–11 | Guide 3.1–3.5 · one Apple screen each | 28–38 / 26–36 | 3.1 Open Shortcuts · Next; 3.2–3.4 Next · Previous; 3.5 I turned it on |
| 12 | Done · "You're set" + Test passed | 28 / 23 | Finish setup |
| | **Total** | **404 / 351** | |

That is **49% of the English words and 49% of the Arabic** (the target was at most half).

The walkthrough follows the iOS 26 Shortcuts labels in order:
1. Automation, then +.
2. Message.
3. Message Contains: type one space, and leave Sender empty.
4. Run Immediately, with Notify When Run turned off, then Next.
5. Select "Wafra Capture v3", then Done.

"Show all steps" opens the full list on one screen, and "How it works" opens the old help sheet
unchanged.

**In-app taps on the happy path:** Add a statement → Choose file → Continue → Set up →
Add Shortcut → Open Shortcuts → Next ×3 → I turned it on → Finish setup = **11**. Without
statements: Later + the capture steps = **9**.

The owner asked for one step per screen, and the Next taps in the walkthrough cost four taps
compared with before. The Messages capture steps went from 5 to 9 in-app taps. Each screen now
carries one instruction with the matching Apple label.

**Errors (after)** say what happened, then one action:

| Error | Message |
|-------|---------|
| Install | "Shortcuts didn't open. Tap Add Shortcut to try again." |
| Test | "The test didn't finish. Unlock your iPhone, then tap Run test." |
| Test failed | "Test failed: the shortcut did not reach Wafra." + "Add the shortcut again, then run the test." |
| Shortcuts missing | "Apple Shortcuts isn't installed. Install it, then try again." |
| Old build | "This version can't capture messages. Update Wafra." |
| State | "Setup progress didn't save. Tap Try again." |
| Save | "Setup didn't save. Try again." |
| Statements | For example: "This PDF is a scan, so Wafra can't read it. Download a CSV or a text PDF instead." and "Too many files at once. Wait a minute, then try again." |

**Where the removed and optional features went:**
- **Past SMS import:** Settings → Advanced → "Import past SMS (experimental)", shown on iOS 26+ only. It opens `/ios-setup?section=history`. It also appears when a history handoff is already running, so that import can be finished. On iPhone, `/import-sms` opens on paste; its history card appears only to review or continue an import that is already under way. The native modules and history code are unchanged.
- **Apple Pay and bank-app notifications:** Settings → Capture sources ("More ways to capture"). During onboarding they appear only if Messages capture cannot run on that iPhone.
- **iOS 27 one-toggle:** `iosOneToggleCaptureAvailable()` checks for iOS 27 or later behind `IOS_ONE_TOGGLE_CAPTURE_SHORTCUT_BUNDLED = false`. The placeholder card sits above the Messages guide and never replaces it. No Shortcut file was made. It has to be authored on a physical iOS 27 iPhone.

## Other changes in this round

- **Onboarding layout.** The onboarding scroll views were locked unless the font scale was at least 1.6. On an iPhone SE at the largest non-accessibility text size, content was clipped. They now always scroll, and bounce only at accessibility sizes, so a screen that fits stays still. In the before/after web runs at 2x text, the step container went from `overflow-y: hidden` to `auto`. Two left-only margins became start margins for Arabic. Step labels and the badge height wrap and grow instead of truncating.
- **Bank logos.** They no longer sit on a white tile (Wallet) or a brand-coloured tile (onboarding examples). Artwork fills the avatar, clipped to its radius. Dark mode adds a hairline edge. The onboarding initials use the brand colour lifted to AA contrast on charcoal.
- **Relay revocation.** "Not now" revokes the relay only when a Shortcut carries it. A relay paired just for the statement upload is left alone, so its queued rows are not stranded.

## Evidence

Screenshots are in `docs/design/2026-09-25-ios-setup-simplify/`:
- **`setup/`**: every new or changed state at 390×844, in English and Arabic. The first-run screens are forced night. The Settings and statement screens are in light and dark. `results.json` is included.
- **`large-text/`**: the same states at 375×667 with doubled text.
- **`onboarding-before-after/`**: the welcome and focus screens, before and after, at 375×667 (1x and 2x) and 430×932.

`/setup-preview` exists only in the E2E build. It renders the iPhone-only screens from the same
presentational components with fixed states, because the web export cannot run the iOS branches.
It is checked by `scripts/e2e/e2e-ios-setup-preview.mjs` (68 states pass).
`scripts/e2e/e2e-onboarding.mjs` also passes (4/4).

`scripts/e2e/e2e-onboarding-extreme.mjs` fails on the base commit too: it waits for a welcome
headline ("Your money. A clearer picture.") that the app no longer shows. That failure is
separate from this change.

## Needs a physical iPhone

- The whole Messages setup on iOS 26:
  - the share sheet → Add Shortcut;
  - the automatic test when returning, including the Allow prompt;
  - each of the five Apple screens, matched against the chips;
  - "I turned it on";
  - Finish.
- The Arabic Apple labels in the chips («الأتمتة», «رسالة», «تحتوي الرسالة على», «تشغيل فوراً», «التالي», «تم», «إضافة اختصار»), checked on an Arabic-language iPhone.
- Returning from the statement importer and from `/ios-setup` to the live step. Also a cold relaunch after Later: the live step is in memory only and shares the `capture` stage, so a relaunch shows the statement step again.
- Uploading a PDF and a CSV exported from a real bank app, through Files. Check the progress and the Added / Needs review / Skipped counts against the ledger.
- Dynamic Type at the accessibility sizes on an iPhone SE and a Pro Max. The web runs double CSS text only.
- VoiceOver on the guide: badge and title are read together ("Screen 2 of 5. Choose Message"), the chips are read as one line, and pass/fail results are announced.
- Bank logos with real CDN artwork in light and dark Wallet. The web runs block the CDN, so they show the fallback initials only.
- iOS 27: nothing to verify until the one-toggle Shortcut exists.

## Not done

- The later "gentle card" for Apple Pay and notifications on Home was not built. The options live in Settings → Capture sources.
- The one-toggle Shortcut file for iOS 27, which must be made on a device.
