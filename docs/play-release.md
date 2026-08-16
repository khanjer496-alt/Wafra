# Wafra — Google Play release playbook

Modeled on FinArt ("Expense Tracker Budget Planner", com.finart — live on Play
with READ_SMS since 2016, 1M+ downloads), which ships under Google's
**"SMS-based money management"** permission exception for "apps that track and
manage budget" (Play policy: Use of SMS or Call Log permission groups).

## Why we qualify

- SMS-based expense tracking IS the core functionality, not a side feature.
- The permission is **optional**: the app fully works with manual entry if the
  user taps "Not now" (this must stay true — never gate the app on the grant).
- The **Android alert-capture path** is local: SMS and bank-app notification
  content is not sent to Wafra's iPhone relay. Private Mode remains available.
- Prominent disclosure before the runtime prompt (onboarding explainer step).

## Permissions Declaration Form — draft answer

> Wafra is a personal expense tracker and budget planner. Its core feature is
> automatic expense tracking from bank transaction alert SMS: UAE banks send an
> SMS for every card transaction, transfer, statement and bill. Wafra reads
> these messages on-device to log transactions, track credit-card due dates and
> detect recurring subscriptions. In the Android build, alert processing is
> local and message content is never sent to Wafra's iPhone relay.
> Non-transactional messages are ignored and never stored. The
> permission is optional — the app functions with manual entry when declined.
> Requested permissions: READ_SMS (inbox scan of historical bank alerts) and
> RECEIVE_SMS (process new supported bank alerts when they arrive). Both paths
> parse on-device; message text is not uploaded.

Attach a short screen-recording of: onboarding disclosure → permission prompt →
scan → transactions appearing.

## Data safety form

- Android bank-alert content is processed on-device and not sent to the relay.
- RevenueCat's current purchase and anonymous-identifier disclosures must be
  reflected in the final Play Data safety form; do not submit the old blanket
  “No data collected” answer without verifying the configured SDK.
- User financial records stay local unless the user exports them.

## Store listing (draft)

**Title:** Wafra: Budget & Money Tracker
**Short description:** Private expense tracker for budgets, bills, subscriptions and savings goals.

**Full description outline** (mirror FinArt's structure):
- Expense tracker: start manually; optional supported bank-alert imports require no bank login.
- Knows every card: limits, outstanding, statement due dates with reminders.
- Subscriptions: detects recurring charges, price rises, stopped services.
- Budgets, insights in plain language, net-worth trend, monthly report.
- Optional bank packs: supported UAE and Saudi formats, clearly separated from
  manual budgeting and subscription features.
- **Data privacy & security controls** section (the compliance argument):
  - No registration — no email, no phone number, no account.
  - Android bank alerts are processed on your phone, not by the iPhone relay.
  - Optional app lock (fingerprint).
  - Backup is a file you own and control.
  - Does not connect to bank accounts; works from SMS alerts only.
- "Why Wafra needs SMS permission?" paragraph, verbatim style from FinArt:
  optional, only for automatic tracking, banks send SMS for every transaction.

## SMS permissions on Play

`READ_SMS` and `RECEIVE_SMS` are allowed for this app, but only via a
declaration. Google's SMS/Call Log policy lists the permitted use verbatim as
**"SMS-based money management: For example, apps that track and manage
budget"**, eligible for `READ_SMS, RECEIVE_MMS, RECEIVE_SMS,
RECEIVE_WAP_PUSH`.

- File the **Permissions Declaration Form** in Play Console and select that
  permitted use. Apps that skip the form "may be removed from Google Play".
- The binding condition is data handling: budgeting apps must not exfiltrate
  or share non-financial or personal SMS. Wafra's Android capture code does not
  upload those messages — say this platform-specific fact plainly.
- The receiver drops any message without a currency amount before storing it,
  so personal correspondence is never retained. That is the sentence the
  reviewer wants to read.
- Policy reference:
  https://support.google.com/googleplay/android-developer/answer/10208820

## Legal documents

- [Privacy policy](./privacy-policy.md) — required by Play; needs a public URL
- [Terms of use](./terms-of-use.md) — has two placeholders (legal entity,
  jurisdiction) that must be filled before publishing

Both are written against what the code actually does. Every claim in them is
checkable, so re-read them whenever the app gains a network call, an account,
or a cloud feature.

A note on the comparison, since FinArt is the obvious model: their *marketing*
says data never leaves the device, but their *privacy policy* states they
collect SMS records, location, device ID, device name and model, and that
"SMSes are also used to train our engine". That is a data-collecting product
described accurately in the policy and loosely in the listing — which is why
their Play Data safety card declares Personal info and Financial info
collected. Do not model Wafra's documents on theirs: ours can claim far less
because the app does far less, and that advantage only survives if the claims
stay literally true.

## iOS capture is a separate disclosure

iOS has no third-party SMS-inbox API. Wafra's iPhone flow therefore has the user
create a personal Apple Message automation. Only alerts from bank senders the
user selects are POSTed to Wafra's relay.

The relay parses the raw request body in memory and discards it immediately.
It stores only the structured result, sealed to the iPhone, until acknowledgement
or for at most 30 days. A silent wake may stage that structured row in a
separate encrypted inbox after the first unlock; the main ledger folds it in on
foreground. Delivery is best-effort and stops after a user force-quit until the
next open, so do not promise an exact background update time.

Private Mode disables the relay and keeps processing local, which also means
automatic SMS capture is unavailable on iPhone in that mode.

## Data safety form answers

These answers must be completed for the Android artifact actually submitted and
the configured RevenueCat SDK. The old blanket answers are retained below only
as examples of what **not** to submit:

| Question | Answer |
| --- | --- |
| Does your app collect or share any of the required user data types? | **Verify RevenueCat's current disclosure; Android bank-alert content itself is not uploaded** |
| Is all user data encrypted in transit? | Yes for configured purchase traffic |
| Do you provide a way for users to request data deletion? | Yes — uninstall, or clear data in Settings |

Verify Play billing and RevenueCat handling against the current Data safety
definitions before submission. If cloud sync or crash reporting is added, this
section and the privacy policy must change before that build ships.

For reference, FinArt — the closest comparable on Play — declares "No data
shared with third parties", "Data is encrypted in transit", and collects
"Personal info, Financial info and 4 others", because it offers multi-device
sync and Drive backup. Wafra's position is stronger precisely because it has
  different architecture; do not borrow its answers.

## Prominent disclosure (required before the SMS prompt)

Play requires an in-app disclosure before the runtime permission dialog, in
addition to the privacy policy. It must name the data, the use, and appear
before the request. The onboarding permission screen is that disclosure — keep
it saying, in substance:

> Wafra reads bank alert messages to record your transactions automatically.
> Messages are processed on this device and are never uploaded. Messages that
> do not contain a currency amount are ignored and never stored.

Do not soften this into marketing copy; the reviewer is checking for exactly
these three facts.

## Build checklist before submission

- [x] Unique applicationId: app.wafra.android (versionCode 1 in app.json)
- [x] Signed releases: keystore/wafra-upload.jks (upload key; CI signs both
      APK and AAB — replaceable in Play Console if ever compromised)
      - CI reads the key from repo secrets; nothing about it is committed:

        | secret | required | meaning |
        | --- | --- | --- |
        | `WAFRA_KEYSTORE_B64` | yes | `base64 -w0 wafra-upload.jks` |
        | `WAFRA_KEYSTORE_PASSWORD` | yes | store password |
        | `WAFRA_KEY_PASSWORD` | no | key password (defaults to the store one) |
        | `WAFRA_KEY_ALIAS` | no | key alias (defaults to `wafra`) |

      - They reach Gradle as `ORG_GRADLE_PROJECT_*` properties, so no
        password is written into build.gradle or any workspace file.
      - With no keystore secret the build still succeeds, signed with a
        throwaway key on a random per-run password. Those artifacts cannot
        update a side-loaded install and cannot be uploaded to Play.
      - The build fails early, with a message naming the secret at fault, if
        the keystore does not open or lacks the alias.
- [x] Play **AAB** built by CI as the `wafra-aab` artifact on `main`, or from
      a manual run with **Also build the Play Store bundle** enabled
- [x] Privacy policy written (landing page section; host on real domain)
- [x] i18n: English + Arabic UI with RTL; auto-detected, Settings override
- [ ] Final app icon + adaptive icon + splash pass
- [ ] Screenshots (phone, 1080×1920+) + feature graphic 1024×500
- [ ] Content rating questionnaire (PEGI 3 expected)
- [ ] Territories + localized pricing (all intended territories; bank-alert
      automation remains limited to supported UAE/Saudi formats)
- [ ] YOUR STEPS: Play developer account ($25), upload wafra-aab to a
      closed test track, paste the SMS declaration, add privacy policy URL,
      create the two Pro subscription SKUs (no introductory store trial while
      the app's local three-day trial remains enabled)

## Monetization — Wafra Pro

- Model: 3-day free trial, then subscription required for automatic capture.
  After the included period, SMS/notification importing pauses until
  subscribed. Viewing existing data, manual entry, pasted alerts, salary-day
  months, and backup/restore keep working without Pro.
- Do not configure a Play introductory trial while the app grants three days
  locally from first launch. The two clocks would stack. If the local trial is
  removed later, the store offer and all paywall/listing copy must change in the
  same release.
- SKUs (create in Play Console → Monetize → Subscriptions):
  `wafra_pro_monthly`, `wafra_pro_yearly`. Use Google Play's territory price
  tiers; the paywall renders the storefront's localized price string.
- Code: paywall at `src/app/pro.tsx`; entitlement `state.pro`; RevenueCat store
  integration in `src/lib/billing.ts`. Production builds still require the
  public platform SDK keys plus the matching store products and `pro`
  entitlement described in `docs/billing.md`.
- Play policy: digital subscriptions MUST use Play Billing. Include a
  manage/cancel path and verify the current fee/program terms in Play Console.
- Side-load builds are not valid billing evidence. A keyed build may initialize
  the SDK, but purchase availability depends on a Play-installed test build.

## Roadmap notes borrowed from FinArt parity

- Bank-app **notification listener** as a second capture channel (banks moving
  off SMS to push notifications).
- Opt-in bank-email forwarding and text-PDF statement import ship through the
  same privacy-minimizing relay. Raw MIME, HTML, attachments and PDF text are
  discarded after parsing; keep the Data safety and privacy disclosures in
  sync with that optional network path.
- Salary-day month start (custom month boundary) — cheap, high-value in UAE.
- Multi-currency auto-conversion to AED (fixes USD-only subscription SMS gap).
