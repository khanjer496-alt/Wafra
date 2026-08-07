# Wafra — Google Play release playbook

Modeled on FinArt ("Expense Tracker Budget Planner", com.finart — live on Play
with READ_SMS since 2016, 1M+ downloads), which ships under Google's
**"SMS-based money management"** permission exception for "apps that track and
manage budget" (Play policy: Use of SMS or Call Log permission groups).

## Why we qualify

- SMS-based expense tracking IS the core functionality, not a side feature.
- The permission is **optional**: the app fully works with manual entry if the
  user taps "Not now" (this must stay true — never gate the app on the grant).
- Nothing leaves the device. No servers, no account, no analytics on spending.
  This exceeds FinArt's "private mode" (their opt-in is our only mode).
- Prominent disclosure before the runtime prompt (onboarding explainer step).

## Permissions Declaration Form — draft answer

> Wafra is a personal expense tracker and budget planner. Its core feature is
> automatic expense tracking from bank transaction alert SMS: UAE banks send an
> SMS for every card transaction, transfer, statement and bill. Wafra reads
> these messages on-device to log transactions, track credit-card due dates and
> detect recurring subscriptions. Processing is 100% local: messages are never
> transmitted off the device; the app has no server component and no user
> accounts. Non-transactional messages are ignored and never stored. The
> permission is optional — the app functions with manual entry when declined.
> Requested permissions: READ_SMS (inbox scan of historical bank alerts).

Attach a short screen-recording of: onboarding disclosure → permission prompt →
scan → transactions appearing.

## Data safety form

- Data collected: none. Data shared: none. All data stored on-device only.
- Financial info is processed ephemerally on-device; optional backup is an
  encrypted file the user exports themselves.
- Security practices: data not transmitted; user can request deletion by
  clearing app data (Settings → Erase data).

## Store listing (draft)

**Title:** Wafra: Expense Tracker UAE
**Short description:** Automatic expense tracker for UAE banks. SMS-based, private, AED-first.

**Full description outline** (mirror FinArt's structure):
- Expense tracker: automatic from bank SMS, no spreadsheets, no bank logins.
- Knows every card: limits, outstanding, statement due dates with reminders.
- Subscriptions: detects recurring charges, price rises, stopped services.
- Budgets, insights in plain language, net-worth trend, monthly report.
- Made for the UAE: AED-first, DEWA/Etisalat/du understood, 16 UAE banks.
- **Data privacy & security controls** section (the compliance argument):
  - No registration — no email, no phone number, no account.
  - Everything on your phone. No servers involved, ever.
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
  or share non-financial or personal SMS. Wafra has no backend at all, so
  nothing leaves the device — say this plainly in the listing and the form.
- The receiver drops any message without a currency amount before storing it,
  so personal correspondence is never retained. That is the sentence the
  reviewer wants to read.
- Policy reference:
  https://support.google.com/googleplay/android-developer/answer/10208820

## Legal documents

- [Privacy policy](./privacy-policy-android.md) — required by Play. Published at
  <https://wafra-legal.pages.dev/android/privacy>. The iPhone build has its own
  at `privacy-policy-ios.md`; do not submit that one to Play.
- [Terms of use](./terms-of-use-android.md) — placeholders now filled (legal entity,
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

## If iOS ever comes up

Worth knowing before it is planned: **iOS cannot do what Wafra does.** Apple
gives no app access to the SMS inbox, so automatic tracking from bank alerts
is not portable. FinArt's iOS app works around this with Apple Shortcuts
automations and user-forwarded bank emails, and its policy states those
messages are "sent to our server for transaction detection", retained 30 days.

So an iOS version means either a materially weaker product (manual forwarding)
or building the server Wafra deliberately does not have. Neither is a small
change of scope — treat iOS as a separate product decision, not a port.

## Data safety form answers

The app makes no network requests of its own, so the honest answers are the
simple ones. Keep them true: the moment anything is uploaded, these change.

| Question | Answer |
| --- | --- |
| Does your app collect or share any of the required user data types? | **No** |
| Is all user data encrypted in transit? | N/A — no data is transmitted |
| Do you provide a way for users to request data deletion? | Yes — uninstall, or clear data in Settings |

Play billing is Google's own processing and is not app-collected data. If a
cloud sync or crash reporter is ever added, this section and the privacy
policy both have to change before that build ships.

For reference, FinArt — the closest comparable on Play — declares "No data
shared with third parties", "Data is encrypted in transit", and collects
"Personal info, Financial info and 4 others", because it offers multi-device
sync and Drive backup. Wafra's position is stronger precisely because it has
no server; that is worth saying plainly in the listing rather than leaving
the reviewer to infer it.

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
- [x] Play **AAB** built by CI as the wafra-aab artifact every push
- [x] Privacy policy written (landing page section; host on real domain)
- [x] i18n: English + Arabic UI with RTL; auto-detected, Settings override
- [ ] Final app icon + adaptive icon + splash pass
- [ ] Screenshots (phone, 1080×1920+) + feature graphic 1024×500
- [ ] Content rating questionnaire (PEGI 3 expected)
- [ ] Countries + pricing (UAE first; SA pack ready when expanding)
- [ ] YOUR STEPS: Play developer account ($25), upload wafra-aab to a
      closed test track, paste the SMS declaration, add privacy policy URL,
      create the two Pro subscription SKUs (3-day free trial on each)

## Monetization — Wafra Pro

- Model: 3-day free trial, then subscription required. Trial = everything
  unlocked from first launch. After trial, SMS/notification importing
  pauses until subscribed (viewing existing data and manual entry keep
  working). Salary-day months and backup/restore are Pro-gated too.
- Configure the same 3-day free trial on the Play subscription offers so
  the store purchase button reads "3 days free".
- SKUs (create in Play Console → Monetize → Subscriptions):
  `wafra_pro_monthly` (AED 9.99/mo), `wafra_pro_yearly` (AED 74.99/yr).
- Code: paywall at `src/app/pro.tsx`; entitlement `state.pro`; billing
  abstraction `src/lib/purchases.ts` — swap its stubs for react-native-iap
  at submission (requestSubscription/getAvailablePurchases). UI unchanged.
- Play policy: digital subscriptions MUST use Play Billing (15% fee under
  $1M/yr after joining the small-business program). Include manage/cancel
  link (Play handles it), and price in AED via Play Console pricing.
- Side-load builds: billing is unavailable by design (Play Billing only
  works when installed from Play); founder unlock = 7 taps on the Settings
  logo toggles Pro locally.

## Roadmap notes borrowed from FinArt parity

- Bank-app **notification listener** as a second capture channel (banks moving
  off SMS to push notifications).
- Email parsing channel (optional, Gmail API) — later.
- Salary-day month start (custom month boundary) — cheap, high-value in UAE.
- Multi-currency auto-conversion to AED (fixes USD-only subscription SMS gap).
