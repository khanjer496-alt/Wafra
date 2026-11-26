# Android capture permission validation

All new READ_SMS runtime requests use the shared app-level disclosure host, which
renders the existing onboarding SMS explainer in the current English/Arabic UI
language. Continue is affirmative consent; Not now, sheet dismissal, app lock or
an absent presenter returns without requesting Android permission. Existing OS
grants require a versioned acceptance record in this installation's SecureStore;
old grants or obsolete records show the disclosure without repeating Android's
system prompt. The record is outside Wafra's ledger backup. Routine, resumed
history, headless and diagnostic reads check effective app access as well.
Manual entry remains available. Declining onboarding's disclosure does not
produce an OS-denied result or permission-denied analytics. Revoking access
opens Android Settings without a grant disclosure.

The same host presents the separate live SMS and bank-notification disclosures.
Notification source/admission updates in onboarding run only after acceptance;
opening Android's notification-access settings is also gated. Settings, Import,
research/export tools and foreground repair use the shared permission boundary.
Manual app-settings repair for SMS is gated as well.

Regression command (uses current source and mocked OS boundaries, no build):

```sh
node --test scripts/test/repair/android-capture-disclosure.test.cjs
```

Before release, App QA Lead still needs the replacement Play-installed candidate:
from onboarding, Settings and Import, record accept, decline, back/dismiss and
retry after denial/revocation for SMS history, live SMS and notification access.
Confirm declined choices enable no reader/source and manual use still works.
Source tests do not prove the native disclosure's rendered visibility or Google
approval. Google guidance: https://support.google.com/googleplay/android-developer/answer/11150561

## Upgrade behavior and replacement-build QA

Release note: after upgrading from an earlier build, an existing Android SMS
permission does not resume SMS capture until the user accepts the current Wafra
disclosure in the foreground. Settings or an interactive scan presents it without
a second Android permission prompt. Bank-notification capture is independent.

Test an upgrade with READ_SMS already granted and no disclosure record: confirm
routine, headless and resumed-history reads remain off; decline the foreground
disclosure and confirm no read, source activation or OS-denial result; accept it
and confirm capture resumes without a redundant system prompt. Also repeat the
393 baseline: skip SMS in onboarding, then enable Read bank SMS in Settings.
The Wafra disclosure must appear before Android's dialog. Test withdrawal from
Settings: opening phone settings must never show a grant disclosure.

## Current Mac Kotlin cache limitation (9 November 2026)

The local shared cache under `$TMPDIR/wafra-test-kotlin-2.1.20-a118197b0de55ffa`
is incomplete. Read-only inspection found `kotlinc/lib/kotlin-preloader.jar`,
`kotlinc/lib/kotlin-compiler.jar` and `kotlinc/lib/annotations-13.0.jar` missing.
The other five pinned files match the hashes in `scripts/test/kotlin-compiler.cjs`.
This is observed local cache damage, not an Android product failure or a
platform-wide reason to skip Kotlin tests.

Affected repair suites: `complimentary-clock.test.cjs` and
`european-notification-admission.test.cjs`. The helper correctly refuses this
cache before executing the compiler. These suites are not claimed passing on
this Mac. The cache was not deleted, moved or replaced, and no hash guard was
weakened. CI has its own cache/provisioning and is unaffected by these missing
local files; the new commit must still pass its own CI.

For a future local rerun, restore a complete compiler through the existing
checksum-pinned provisioner in a task-owned temporary directory, or supply a
verified complete compiler and working JDK. Preserve the damaged shared cache
until its ownership is clear. Do not mark the tests passing by suppressing the
integrity error or adding a macOS skip.
