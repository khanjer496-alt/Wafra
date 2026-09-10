# Wafra — App Store release playbook

> **Current declaration source:** `docs/store-compliance/apple-app-store.md`,
> `docs/store-compliance/apple-export-compliance.json` and
> `docs/store-metadata.json`. Historical relay instructions below are retained
> for migration context only.

> **CURRENT STATUS — LEGACY RELAY SHORTCUT RETIRED / DO NOT USE FOR NEW SETUP**
>
> The relay-uploading **Wafra Capture** instructions and App Review wording
> preserved below are historical, not the current iOS capture path. Do not use
> the old Shortcut, setup code, or iCloud URL in a new build. Follow
> [`2026-08-25-ios-local-capture.md`](./superpowers/plans/2026-08-25-ios-local-capture.md)
> for the local-capture implementation and its unresolved physical-iPhone
> release gates. This repository does not yet record a qualified replacement
> Shortcut or physical-device proof.

The iPhone build does not claim to read SMS. Apple does not expose another
app's Messages inbox to Wafra. Automatic capture is a user-created personal
automation in Shortcuts: a Message trigger, restricted to bank conversations
the user selects, runs the published **Wafra Capture** Shortcut immediately.

## What ships in the binary

- Expo SDK 55 iOS app with bundle id `app.wafra.ios`.
- `remote-notification` background mode for a content-free sync wake.
- Provisional notification authorization requested only when the user opens
  the automation step; the wake has no title, body, sound, badge, merchant,
  amount, or queue count.
- SQLCipher ledger and durable encrypted background inbox.
- First-class Shortcut setup, forwarded-bank-email setup, and text-PDF import.

`eas.json` contains development, iOS Simulator, internal preview, production,
and production-submit profiles. Run `npm run release:check` before attempting a
production build. It intentionally blocks while any relay, EAS, Shortcut,
billing, database, support, or legal value is missing.

## Legacy Shortcut release gate — retired

> **Historical procedure only. Do not use it for a new setup or release.**

Build the credential-free Shortcut exactly from
[`ios-shortcut-spec.md`](./ios-shortcut-spec.md). A per-device setup code is
pasted at install time; never publish a user's relay URL or bearer token in the
iCloud Shortcut.

Before submission, verify on a physical iPhone:

1. Install the public iCloud Shortcut from a clean device.
2. Create a personal **Message** automation for real bank conversations.
3. Select **Run Immediately**.
4. Return to the Home Screen and lock the phone; do not force-quit Wafra.
5. Receive a real supported bank alert.
6. Confirm the structured transaction reaches Wafra without first opening the
   app, and that the raw alert is absent from relay storage and logs.
7. Restart or force-quit once, then verify the product's honest “open once to
   resume” recovery copy.

Apple documents that Message personal automations can run automatically and
that automations using that trigger do not display a run notification:

- https://support.apple.com/guide/shortcuts/enable-or-disable-a-personal-automation-apd602971e63/ios
- https://support.apple.com/guide/shortcuts/communication-triggers-apdd711f9dff/ios

## Legacy relay App Review notes — retired draft

> This draft describes the retired relay-uploading Shortcut and must not be
> submitted as the description of the current local-capture implementation.

> Wafra does not access or monitor Messages. During an explicit setup flow, the
> user installs a personal Shortcut and creates Apple's own Message automation
> for bank conversations they choose. That user-owned automation sends a bank
> alert to Wafra's relay. The relay parses it in memory, immediately discards
> the source text, and stores only an encrypted structured transaction for the
> paired iPhone for at most 30 days. Email forwarding and PDF import are
> separate, opt-in import paths. The app remains usable with demo data and
> manual entry if automatic capture is skipped.

Provide App Review with a demo relay account/device code and a non-financial
test Shortcut action. Do not provide a real user's token or bank message.

## App Store Connect checklist

- [ ] Apple Developer team and App Store Connect record created.
- [ ] EAS project UUID and APNs credentials configured.
- [ ] RevenueCat Apple public key, products, and `pro` entitlement configured
      and tested in StoreKit sandbox. Do not add an introductory store trial
      while the app's local three-day trial is enabled.
- [ ] Production relay URL, D1 database, push access token, and public iCloud
      Shortcut URL configured.
- [ ] Legal entity, jurisdiction, support email, support URL, and hosted privacy
      policy completed.
- [ ] App Privacy answers match the deployed relay and current RevenueCat SDK.
- [ ] English and Arabic screenshots captured from a production-like build.
- [ ] VoiceOver, Dynamic Type, reduced motion, biometric lock, offline launch,
      and background recovery checked on physical devices.
- [ ] Locked-phone real-bank-alert proof recorded; setup tap count documented.
- [ ] `npm run check`, `npm run test:e2e`, and `npm run release:check` pass.

## Build commands

```bash
npx eas-cli@22.4.0 build --platform ios --profile preview
npx eas-cli@22.4.0 build --platform ios --profile production
npx eas-cli@22.4.0 submit --platform ios --profile production
```

Production signing, submission, hosted legal URLs, billing products, the relay,
and the published Shortcut are external account state. They are deliberately
not replaced with fake defaults in this repository.
