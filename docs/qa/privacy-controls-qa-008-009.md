# QA-008 and QA-009 privacy controls

Prepared 9 November 2026 against release base `3a13908b`.

Online merchant and bank logos start off on both platforms, including saved
states without the preference. Settings explains name sharing with Brandfetch
before opt-in, even while local-only mode is active. The local-only preference
overrides consent. Revocation invalidates queued resolver/cache work and removes
remote image sources; an already transmitted request cannot be recalled.
External backup restores preserve this device's logo consent and widget-privacy
choice. Local startup still hydrates the saved preferences, and malformed
preference types are rejected by backup validation.

App Lock installs an opaque iOS window cover on native resign-active/background
callbacks. Android uses `FLAG_SECURE`. Enabling the setting awaits native
configuration before exposing the enabled state. JavaScript also hides the
financial subtree and its accessibility content while inactive.

Hide widget amounts with App Lock starts on. Amounts are null in the shared
snapshot while App Lock is enabled, even after unlocking Wafra. Names, counts
and dates remain. Native snapshot writes reject stale unredacted summaries;
preference changes invalidate pending work and republish after configuring the
native guard. An unresolved currency leaves widgets cleared. Existing widget
images refresh on the operating system's schedule.

## Local validation

- Full app `tsc --noEmit` passed, including the final widget currency guard.
- Targeted ESLint: no errors; two existing effect-dependency warnings in Settings/store.
- Consent/avatar/erase/bridge tests: 42 passed.
- Widget repair suites: 90 passed.
- Settings launch/consent tests, iOS/Android and English/Arabic: 13 passed.
- App Lock suite: 22 passed. Store-selection/original Settings harness: 29 passed.
- Merchant and bank resolver suites and bundled-logo integrity suite passed.
- Store metadata checks and `git diff --check` passed.
- Privacy restore, backup, transfer and private-format integration cases: 130
  passed. The avatar performance contract remains a narrow context subscription;
  its updated suite passed 108 checks. Store harnesses stub only the new native
  and presentation boundaries, retaining the real monetary reducer modules.
- Swift native sources passed syntax parsing. The privacy controller also passed
  real UIKit typechecking with only its Expo subscriber/bridge boundary stubbed:
  `bash scripts/test/native-app-privacy-typecheck.sh`.

## Candidate QA still required

Build fresh native binaries; the new native protection cannot be proven by an
OTA or web export. No complete native build, signed archive or physical-device
test was performed here. Android native compilation is not established by the
JavaScript tests or the iOS controller typecheck.

Retest fresh install and upgrade, consent on/off and local-only override, queued
lookups, app switcher immediately after enabling App Lock, Face ID/passcode
success/cancel/slow return, long background, process death and cold launch.
With Home Screen widgets already placed, enable App Lock, switch amount hiding
off/on, restart, and confirm refresh never restores unredacted data under the
enabled preference. Check English/Arabic and both color schemes.

App Store privacy remains a draft: Brandfetch collection is conditional on
opt-in, while Superwall still contributes Purchase History and other categories.
Dashboard, linkage and retention verification remain separate release gates.
No account settings, published privacy labels or deployed policy were changed.

CI is not cleared yet. Its generated native-parser resource check needs a
coordinated refresh with the parser owner; that guard has not been disabled.
