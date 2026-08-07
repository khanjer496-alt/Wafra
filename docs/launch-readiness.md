# Wafra launch readiness

_Repository audit: 2 August 2026. This is a launch checklist, not evidence that
Apple or Google will approve the app. Store rules and console state must be
rechecked immediately before submission._

Wafra is not ready for an App Store or Google Play production release yet.
The application, tests, Android release workflow, relay implementation, and
draft store material are substantially in place. The remaining work is mostly
production identity/configuration, store and billing account setup, policy
forms, and physical-device proof. No secret or production console state can be
inferred from this repository.

This document separates work as follows:

- **Repo** — a file, build, or test change that can be completed in this
  repository.
- **Account** — work in Apple, Google, Expo, RevenueCat, Cloudflare, DNS, or
  GitHub owned by the publisher. Do not commit the resulting secrets.
- **Evidence** — a result that must be observed on the actual signed artifact
  or a physical device.

## Current configuration snapshot

| Item | Current repository state | Launch status |
| --- | --- | --- |
| Expo | SDK `55.0.0` / package `~55.0.28`; SDK 55 targets Android API 36 and supports iOS 15.1+ | Config parses; Expo Doctor reported 19/19 checks passing |
| App version | `1.0.0`; iOS build `1`; Android version code `1` | EAS production uses remote auto-increment; GitHub Android builds stamp `versionCode` from the run number |
| IDs | iOS `app.wafra.ios`; Android `app.wafra.android` | Present; the store records still need to be created/confirmed by the account owner |
| EAS project | No `expo.extra.eas.projectId` | **Blocked** |
| Billing | Both RevenueCat public SDK keys are empty | **Blocked** for purchasable Pro |
| iOS relay client | Relay, Shortcut, and project ID are read from `EXPO_PUBLIC_*` build variables | Production values absent from the repository, as intended; must be present in the EAS production environment |
| Relay | Worker, D1 schema, encrypted queue, push wake, email, and PDF paths exist; deploy dry-run passes (about 2.6 MiB / 632 KiB gzip) | D1 ID, Worker variables/secrets, routing, rate limit, deployment, and live proof are **blocked** |
| Legal | Draft privacy policy and terms exist | Legal entity, jurisdiction/processing location, support address, counsel review, hosted URLs, and in-app links are **blocked** |
| Android artifacts | GitHub workflow produces APK and optionally AAB; it uses the Play upload key only when repository secrets exist | Actual signing-secret presence and Play acceptance are unknown external state |
| Store art | Six 1080×2160 screenshots, six promos, and a 1024×500 Play feature graphic exist | Play dimensions are usable, although 9:16 captures are preferable for prominent placement; the images are not valid App Store iPhone screenshot sizes |
| Visual quality | Pass-three native captures reportedly address pass-two feedback | Required new blind tie/win verdict is still missing; no honest “every reviewer was wowed” claim yet |
| Security audit | Client has no critical/high npm advisories; 12 moderate advisories remain in Expo SDK 55's `xcode -> uuid` toolchain. Server production audit is clean | Record as a reviewed toolchain exception; do not apply npm's proposed breaking Expo downgrade merely to clear the report |

Authoritative SDK reference: [Expo SDK 55](https://docs.expo.dev/versions/v55.0.0/).

## Stop-ship summary

Production submission must wait until all of these are true:

- [ ] **Repo + Account:** Create/link the EAS project and make the real EAS
  project UUID available as `expo.extra.eas.projectId` or
  `EXPO_PUBLIC_WAFRA_PROJECT_ID`.
- [ ] **Account:** Deploy the production Cloudflare relay and D1 schema with
  the exact variables, secrets, Email Routing, and edge protection listed
  below.
- [ ] **Account:** Publish the credential-free **Wafra Capture** Shortcut and
  configure its public iCloud URL in the production EAS environment.
- [ ] **Account:** Configure APNs credentials, Expo enhanced push security,
  and production notification delivery.
- [ ] **Account:** Configure both stores and RevenueCat: two products per
  store, entitlement `pro`, 3-day trials, public platform SDK keys, and store
  server credentials.
- [ ] **Repo + Account:** Complete legal decisions and counsel review, host
  privacy/terms/support pages on public HTTPS URLs, and add visible links in
  the app. The Settings screen currently has privacy copy but no links to the
  policy, terms, or support.
- [x] **Repo (completed 2 August 2026):** The Android Permissions Declaration draft
  now
  explicitly requests and explains both `READ_SMS` (historical scan) and
  `RECEIVE_SMS` (live bank-alert capture).
- [x] **Repo (completed 2 August 2026):** Public copy now separates the seven
  public-example banks from the explicitly synthetic RAKBANK grammar probe.
  The fixture remains labelled synthetic pending an attributable, consented
  real example.
- [ ] **Account:** Complete all App Store Connect and Play Console metadata,
  privacy/data safety, age/content, financial feature, billing, territory,
  tax, banking, and agreement forms.
- [ ] **Evidence:** Pass physical-device gates for iOS silent capture, Android
  SMS/notification capture, StoreKit/Play Billing, performance, accessibility,
  haptics, RTL, offline storage, and deletion.
- [ ] **Evidence:** Obtain a fresh blind visual verdict that the pass-three
  native captures tie or beat the reference apps. Earlier reviewer quota
  exhaustion is not a verdict.
- [ ] **Repo:** Run every command in the final release command set against the
  exact commit to be submitted; preserve the commit SHA, build IDs, artifact
  hashes, and test output.

## Production values and credentials

### Public client values

These values are embedded in the app and are not secrets. They must still be
correct for the production environment.

| Name | Required value/evidence | Where used |
| --- | --- | --- |
| `expo.extra.eas.projectId` or `EXPO_PUBLIC_WAFRA_PROJECT_ID` | UUID of Wafra's EAS project | Expo push token attribution and release check |
| `EXPO_PUBLIC_WAFRA_RELAY_URL` | Reachable HTTPS origin of the production Worker, with `/v1/health` passing | iOS capture, trusted devices, email/PDF import |
| `EXPO_PUBLIC_WAFRA_SHORTCUT_URL` | `https://www.icloud.com/shortcuts/<published-id>` for a public, credential-free Shortcut | iOS setup |
| `expo.extra.revenueCatAndroidKey` | RevenueCat **public** Google SDK key beginning `goog_` | Android billing |
| `expo.extra.revenueCatIosKey` | RevenueCat **public** Apple SDK key beginning `appl_` | iOS billing |

`EXPO_PUBLIC_*` values are readable from the shipped JavaScript bundle. Never
put a bearer token, private API key, Shortcut setup code, or service-account
JSON in them. EAS production builds automatically select the production
environment for store distribution, but explicitly setting
`build.production.environment` to `production` is preferable because it makes
the intended source auditable. See [EAS environment variables](https://docs.expo.dev/eas/environment-variables/).

### Secrets and console credentials

| Owner | Credential | Exact purpose and acceptable evidence |
| --- | --- | --- |
| Apple | Paid Apple Developer membership and accepted agreements | Signing, APNs, TestFlight, and App Store distribution |
| Apple | Distribution certificate and App Store provisioning profile for `app.wafra.ios` | A production archive signed for the intended team |
| Apple/EAS | APNs authentication key or managed APNs credential | A production iPhone receives an Expo/APNs background wake |
| App Store Connect | App record and numeric Apple app ID (`ascAppId` if automated) | Submitted build appears under the correct Wafra record |
| App Store Connect | API key (issuer ID, key ID, `.p8`) or interactive Apple credentials | EAS Submit authentication; store outside source control or upload to EAS credentials |
| Google Play | Verified developer account, accepted agreements, and app record for `app.wafra.android` | Console accepts the AAB under the intended publisher |
| Android signing | `WAFRA_KEYSTORE_B64`, `WAFRA_KEYSTORE_PASSWORD`; optional `WAFRA_KEY_PASSWORD`, `WAFRA_KEY_ALIAS` | GitHub AAB is signed by the persistent Play upload key. Preserve the keystore and passwords offline |
| Google Play/EAS | Google service-account JSON with Play Console API access | EAS Submit, if used. Upload to EAS credentials; do not commit it |
| RevenueCat | Google service-account connection and App Store Connect in-app purchase key/configuration | RevenueCat validates purchases from both stores |
| Cloudflare | Authenticated account with Workers, D1, DNS, Email Routing, and rate-limit access | Production relay can be provisioned and operated |
| Worker | `PUSH_TOKEN_KEY` | Wrangler secret containing standard base64 of exactly 32 random bytes; encrypts Expo push tokens at rest |
| Worker | `EXPO_ACCESS_TOKEN` | Wrangler secret used after Expo enhanced push security is enabled |
| Worker | `EXPO_PROJECT_ID` | Non-secret Worker variable equal to the same EAS UUID used by the app |
| Worker | `EMAIL_DOMAIN` | Non-secret lower-case domain routed to the Worker with Cloudflare Email Routing |
| Cloudflare D1 | Production database UUID | Replace `REPLACE_WITH_D1_DATABASE_ID` in `server/wrangler.toml` and retain creation/migration output |
| CI (if automated) | `EXPO_TOKEN` | Non-interactive EAS CLI authentication; never embed in the client |

Use one Android signing/release lane deliberately. The GitHub workflow and EAS
Build can otherwise create or use different upload keys. Before the first Play
upload, compare the AAB certificate fingerprint with the intended upload key.
After the first upload, Play App Signing defines the accepted upload identity.
Also keep a release ledger so GitHub run-number version codes and EAS remote
version codes never collide or go backwards.

## Relay and Shortcut launch gate

### Repo checks

- [x] Worker parses the same SMS parser used by the app.
- [x] Raw SMS/email/PDF input is designed to be processed in memory rather
  than stored; D1 stores device-sealed structured rows.
- [x] Push payload is a wake marker rather than financial content.
- [x] iOS task definition is imported at module scope.
- [x] `expo-notifications` enables background remote notifications in app
  config.
- [x] Worker deploy guard refuses a placeholder D1 ID.
- [x] Relay tests/typecheck and a Worker bundle dry-run are wired into the root
  check.
- [ ] Inspect the generated iOS archive and confirm `remote-notification` is in
  `UIBackgroundModes`, the `aps-environment` entitlement is production, and
  the built bundle contains the expected production project/relay/Shortcut
  values.
- [ ] Add a Settings link to the hosted privacy policy, terms, and support
  contact before either store release.

### Account deployment

- [ ] Create the D1 database, put its UUID in `server/wrangler.toml`, migrate
  `server/schema.sql`, and deploy the Worker.
- [ ] Set `PUSH_TOKEN_KEY`; set `EXPO_ACCESS_TOKEN` only after enabling Expo
  enhanced push security; configure matching `EXPO_PROJECT_ID`.
- [ ] Configure `EMAIL_DOMAIN`, Cloudflare Email Routing, and a routing rule to
  the Worker.
- [ ] Add an edge rate-limit/abuse rule for unauthenticated `/v1/pair`. The
  application backstop does not replace edge protection.
- [ ] Confirm observability does not log request bodies, authorization headers,
  extracted PDF text, or financial rows. Test retention and operational access
  with the production Cloudflare account.
- [ ] Publish the Shortcut from the publisher's Apple/iCloud account after
  removing staging `config.json`. Inspect the shared copy and prove it contains
  no relay origin, bearer token, device identifier, bank name, or user data.
- [ ] From a clean Apple ID/device, install the public Shortcut, paste a newly
  generated setup code, run the pipe test, rotate/disconnect it, and confirm
  the old credentials stop working.
- [ ] Record live `/v1/health`, pair, ingest, sync/ack, deletion, queue expiry,
  email rotation/revocation, PDF rejection limits, and trusted-device
  invite/revoke results without preserving raw bank content in the evidence.

Suggested deployment commands are in [server/README.md](../server/README.md).
The owning account must review every resolved target before executing them.

```bash
cd server
npm ci
npm run typecheck
npm test
npm run build:check
npx wrangler whoami
npx wrangler d1 create wafra
# Put the returned UUID in server/wrangler.toml.
npx wrangler secret put PUSH_TOKEN_KEY
npx wrangler secret put EXPO_ACCESS_TOKEN
npm run migrate
npm run deploy
curl --fail --show-error https://<production-relay>/v1/health
```

## iOS / App Store

### Repo work

- [x] Bundle ID, build number, icon, background-notification plugin, SQLCipher,
  SecureStore, local authentication, restore-purchase UI, and the iOS setup
  flow exist.
- [ ] Decide export-compliance treatment with counsel. The app implements
  X25519/HKDF/AES-GCM in addition to OS cryptography, so do not blindly set
  `ios.config.usesNonExemptEncryption` to `false`. Answer App Store Connect's
  encryption questions and retain any required classification/reporting
  evidence.
- [ ] Generate/prebuild and inspect the final privacy manifests and required
  reason API declarations from the app and all SDKs. Passing source checks is
  not proof that the submitted archive passes App Store validation.
- [ ] Add public in-app Privacy Policy, Terms of Use, and Support links. Verify
  links in both English and Arabic, including with the app locked and offline
  recovery copy visible.
- [ ] Prepare App Store-specific localized metadata: name, subtitle,
  description, keywords, promotional text (optional), support URL, privacy URL,
  copyright, primary/secondary category, age rating, review contact, review
  notes, and version release notes. `docs/store-listing.md` is not yet a full
  App Store metadata set.
- [ ] Capture English and Arabic iPhone screenshots at an Apple-accepted
  device size. The existing 1080×2160 files are not accepted iPhone screenshot
  dimensions. Apple currently accepts, among other 6.9-inch sizes,
  1260×2736, 1290×2796, or 1320×2868 portrait images. Recheck the
  [current screenshot specification](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/)
  at upload time and ensure images have no alpha channel.
- [ ] Reconcile every listing claim against physical proof. In particular,
  background capture is best-effort, not instant or guaranteed; no copy may say
  Wafra reads the iOS SMS inbox.

### App Store Connect and billing account work

- [ ] Enrol/verify the publisher, accept the latest agreements, and complete
  tax and banking details required for paid apps/in-app purchases.
- [ ] Register `app.wafra.ios`, enable Push Notifications, create the App Store
  Connect app record, and retain the Team ID and numeric Apple app ID.
- [ ] Configure EAS iOS signing and APNs credentials. Expo's
  [push setup guide](https://docs.expo.dev/push-notifications/push-notifications-setup/)
  requires a paid Apple Developer account for iOS credentials.
- [ ] In App Store Connect create one subscription group and products with the
  exact IDs `wafra_pro_monthly` and `wafra_pro_yearly`; add localized display
  names/descriptions, UAE prices matching the approved commercial decision,
  review screenshots, and 3-day introductory free trials.
- [ ] Add the Apple app to RevenueCat, connect App Store credentials, create
  entitlement `pro`, attach both products, and place only the `appl_` public
  SDK key in app config.
- [ ] Verify subscription terms are displayed before purchase, Restore works,
  manage/cancel routing is understandable, trial/renewal price copy matches the
  live storefront, lapsed/refunded entitlements update, and offline cached
  access behaves as intended.
- [ ] Do not promise cross-platform entitlement continuity without proof.
  Wafra has no login and RevenueCat anonymous customer IDs are normally
  installation-specific; an Android purchase does not automatically prove an
  iPhone entitlement. Either implement and disclose a safe identity/linking
  design or remove that product claim.
- [ ] Complete App Privacy for the union of app and third-party behavior:
  RevenueCat purchase history/identifiers as applicable; transient selected
  bank-alert processing; encrypted structured financial rows; optional email,
  PDF, and trusted-device paths; retention and deletion. Apple requires a
  public privacy policy URL and third-party SDK practices.
- [ ] Complete age rating, content rights, encryption/export compliance,
  territories, availability, price, and release method. Confirm the finance
  category and the app's clear “not a bank/adviser” review notes.
- [ ] Supply App Review with a non-financial demonstration path and disposable
  relay/Shortcut setup. Never give reviewers a real user's bank alert or
  reusable production bearer.

### TestFlight sequence

1. Freeze a candidate commit and record its SHA.
2. Run the final release command set below and make `release:check` pass with
   the production environment.
3. Confirm `npx eas-cli@latest whoami` and `eas project:info` resolve to the
   intended publisher/project; configure credentials with
   `eas credentials --platform ios`.
4. Build the production archive:

   ```bash
   npx eas-cli@latest build --platform ios --profile production
   ```

5. Inspect the build page, configuration, credentials, commit SHA, build
   number, and archive validation. Submit only that build:

   ```bash
   npx eas-cli@latest submit --platform ios --profile production
   ```

6. Wait for App Store Connect processing and answer export-compliance prompts.
   EAS Submit uploads the binary; it does not publish the app. See
   [Expo's App Store submission guide](https://docs.expo.dev/submit/ios/).
7. Add the build to an internal TestFlight group. Internal testing supports up
   to 100 App Store Connect users. Validate install, migration, purchase and
   restore, notifications, relay deletion, deep links, and all physical-device
   gates below.
8. If external beta users are needed, complete Test Information, contact
   details, and Beta App Review; then add the approved build to an external
   group. Keep all test feedback and crash results tied to the build number.
9. Complete version metadata/screenshots/App Privacy/subscription submission,
   select the tested build, add review notes and demonstration instructions,
   and submit the app plus the new subscription products for App Review.
10. Use manual release or a deliberate phased release; monitor review messages,
    purchase status, relay health, push receipts, and support after approval.

## Android / Google Play

### Repo work

- [x] Package ID, SDK 55 target API, `READ_SMS`, `RECEIVE_SMS`, runtime
  permission flow, SMS receiver, notification listener, optional/manual path,
  local parsing, adaptive launcher assets, and signed AAB workflow exist.
- [ ] Update the draft Permissions Declaration answer to name both requested
  permissions and their distinct core uses:
  - `READ_SMS`: user-approved historical scan of bank transaction alerts.
  - `RECEIVE_SMS`: capture a new bank transaction alert when it arrives.
- [ ] Keep the prominent disclosure immediately before the runtime prompt. It
  must identify SMS access, automatic transaction tracking, local processing,
  and the fact that non-financial/personal messages are ignored. Verify the
  English and Arabic text in the submitted artifact.
- [ ] Review the notification-listener disclosure. Android's settings may use
  broad “read, reply & control” wording; Wafra must accurately explain that it
  reads supported bank notifications locally and cannot reply/change them.
- [ ] Correct or qualify the RAKBANK “tested formats” listing claim while the
  only attributable format fixture is synthetic.
- [ ] Produce a 512×512 Play listing icon (32-bit PNG, max 1 MiB) from the
  approved identity. The checked app icon is 1024×1024 and the adaptive assets
  are launcher inputs, not a ready Play listing upload.
- [ ] Review the 1080×2160 Play screenshots in the exact release artifact.
  They fit Play's general phone screenshot limits, but 9:16 screenshots are
  preferred for promotional placement. Provide separate English and Arabic
  images when text is visible. The 1024×500 feature graphic has the required
  dimensions; confirm it is 24-bit/no alpha and meets current metadata rules.

### Play Console and billing account work

- [ ] Create/verify the app record for `app.wafra.android`, enrol in Play App
  Signing, and confirm the persistent upload certificate fingerprint.
- [ ] Upload the AAB before completing the sensitive-permission declaration;
  Play evaluates declarations against the permissions in an uploaded bundle.
- [ ] File the Permissions Declaration Form for Google's
  **SMS-based money management** exception. Approval is required and never
  guaranteed merely because the architecture qualifies. Attach an artifact-
  matched video of prominent disclosure -> permission grant -> historical scan
  -> live SMS capture -> transaction, plus a decline/manual-entry path.
- [ ] Complete Data safety for the actual artifact and all enabled paths. Do
  not submit “No data collected.” RevenueCat says its SDK requires declaring
  purchase history; Wafra's optional relay-backed email/PDF/trusted-device
  features must also be assessed even though Android SMS itself stays local.
- [ ] Complete the Financial features declaration, content rating, target
  audience, ads declaration, app access instructions, privacy policy, account
  deletion applicability, and all other App content tasks shown by Play.
  Expense tracking is not a loan or banking service; answer the console's
  actual categories truthfully rather than guessing a license requirement.
- [ ] Complete main store listing and Arabic localization, developer contact,
  support/privacy URLs, category/tags, countries, pricing, and distribution.
- [ ] Create subscriptions `wafra_pro_monthly` and `wafra_pro_yearly`, base
  plans/offers, AED pricing, localized descriptions, and a 3-day free trial on
  each. Activate them, attach them to RevenueCat entitlement `pro`, and verify
  the `goog_` public key in the release build.
- [ ] Connect RevenueCat to Play with a least-privilege Google service account.
  Separately upload a Play service account to EAS only if EAS Submit is the
  chosen submission lane.
- [ ] Configure license testers and test purchase, acknowledgement, renewal,
  cancellation, grace/hold, refund, restore/reinstall, and entitlement expiry
  from a Play-installed build. Side-loaded APK billing results are not valid.

Google currently lists “SMS-based money management” (for example, apps that
track/manage budget) as eligible for `READ_SMS` and `RECEIVE_SMS`, subject to
review. See the [SMS/Call Log policy](https://support.google.com/googleplay/android-developer/answer/10208820?hl=en)
and [Permissions Declaration process](https://support.google.com/googleplay/android-developer/answer/9214102?hl=en).

### Closed testing and production sequence

1. Choose the canonical signed AAB. For the existing GitHub lane, configure
   the persistent upload secrets, run `build-apk.yml` with `bundle=true`, and
   retain `wafra.aab`, SHA-256 hash, workflow run, commit SHA, version code,
   and signing fingerprint. A workflow artifact signed with the documented
   throwaway fallback cannot be uploaded to Play.
2. Upload/submit the AAB to an internal track, complete the blocking App
   content tasks and SMS declaration, add license testers, and install through
   Play.
3. Test core capture, billing, upgrade/migration, and device gates on the
   internal build. Resolve every pre-launch report and SDK policy warning.
4. Create a **closed** test, add testers with Google accounts, publish the
   approved bundle to them, and retain structured feedback and fixes.
5. If the publisher is a personal developer account created after 13 November
   2023, Google currently requires at least 12 testers opted into the closed
   test continuously for at least 14 days, then a production-access
   application answering questions about testing and readiness. Confirm the
   rule shown by the actual account; organization/older accounts may differ.
6. Keep the SMS declaration approved for the production artifact. Permission
   changes in a later AAB can trigger a new declaration/review.
7. Promote the tested release or submit the exact tested AAB to production,
   use a staged rollout, and monitor Android vitals, policy status, billing,
   reviews, and support before expanding beyond UAE.

Official references: [new personal-account testing requirements](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en),
[testing tracks](https://support.google.com/googleplay/android-developer/answer/9845334?hl=en),
[Data safety](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en),
[financial features declaration](https://support.google.com/googleplay/android-developer/answer/13849271?hl=en), and
[Expo Android submission](https://docs.expo.dev/submit/android/).

## Physical-device evidence gates

### iPhone: silent/locked capture

Use a production-signed TestFlight build, production relay/D1, published public
Shortcut, production Expo project, enhanced push token, and production APNs.
Simulator results and source inspection do not satisfy this gate.

- [ ] Record device model, iOS version, app version/build, commit SHA, relay
  deployment ID, EAS project ID, and timestamp/time zone.
- [ ] Clean-install the public Shortcut and create a Message personal
  automation restricted to real supported bank senders, set to run
  immediately.
- [ ] With Wafra in the background/closed but **not force-quit**, lock the
  phone, receive a consented real bank alert, wait for Shortcut + relay + APNs,
  enable airplane mode before opening Wafra, and prove the already staged
  structured row is present.
- [ ] Prove raw body absence from D1 and production logs without copying the
  raw alert into the evidence package.
- [ ] Reboot, unlock once, repeat the locked-phone test, and confirm the
  after-first-unlock encrypted inbox works.
- [ ] Force-quit, receive an alert, document that silent wake may stop, reopen,
  and prove foreground recovery imports the queued row. Product copy must match
  this limitation.
- [ ] Test APNs token refresh, disabled notifications, expired/invalid token,
  offline queueing, duplicate Shortcut retry, queue ack, disconnect, erase,
  and abandoned queue expiry.
- [ ] Repeat with biometric lock enabled and verify background staging does not
  bypass the foreground ledger lock.

### Android: capture and permission policy

- [ ] On a Play-installed release build, prove disclosure appears before the
  prompt, decline leaves manual entry usable, grant enables historical scan,
  and revoke disables access cleanly.
- [ ] Receive a real bank SMS with the app foregrounded, backgrounded, killed
  by the system, and after reboot. Confirm one row only and no non-financial
  message retention.
- [ ] Enable notification access and prove supported bank-app alerts are parsed
  locally; unrelated notification content is ignored. Revoke access and
  confirm recovery copy/state.
- [ ] Cover at least one older supported Android version and current Android,
  a small and large phone, Arabic/RTL, light/dark, permission denial, battery
  restrictions, and if supported by available hardware, dual-SIM delivery.
- [ ] Inspect traffic during SMS/notification capture and prove bank-alert
  content is not sent to the iOS relay or RevenueCat.

### Both platforms

- [ ] Profile the release artifact at 60 fps on representative physical
  hardware through tab switches, long transaction lists, charts, sheets,
  Arabic RTL, and keyboard/form interactions. Preserve traces and document any
  accepted device-specific limitation.
- [ ] Assess real haptics on hardware for tap, commit, and failure semantics;
  simulator calls are not tactile QA.
- [ ] Check VoiceOver/TalkBack, Dynamic Type/font scaling, reduced motion,
  contrast, touch targets, keyboard navigation where applicable, screen-reader
  order, and localized accessibility labels.
- [ ] Check cold launch, upgrade from the previous candidate, SQLCipher data
  persistence, offline use, backup/export/restore, erase while online/offline,
  biometric changes, low storage, interrupted network calls, and time-zone
  and month boundaries.
- [ ] Run purchase/restore/lapse tests from each store's own installed build.
- [ ] Run a fresh independent blind review of pass-three native captures against
  the named reference apps and retain an explicit tie/win verdict. A reviewer
  quota timeout is neither a pass nor a fail and must not be rewritten as one.

## Legal, privacy, and support gate

- [ ] Publisher chooses the actual legal entity and governing jurisdiction;
  counsel reviews the Privacy Policy, Terms of Use, liability/accuracy copy,
  subscription terms, data transfers, UAE availability, and age rules.
- [ ] Replace `[[LEGAL ENTITY]]`, `[[JURISDICTION]]`,
  `[pending before release]`, and `support@example.com`.
- [ ] Identify the production relay/D1 processing location and Cloudflare
  contractual entity accurately; do not infer a jurisdiction from a Worker
  URL.
- [ ] Publish stable public HTTPS pages for privacy, terms, support, and (if
  used) user privacy choices/deletion instructions. Test without login,
  redirects, cookies, geo blocks, or expired certificates.
- [ ] Add those links inside the app and to both store records. The support
  path must reach a monitored address owned by the publisher.
- [ ] Reconcile policy claims with deployed behavior, including Cloudflare,
  RevenueCat, Expo Push Service/APNs, email/PDF import, trusted devices,
  Keychain survival after uninstall, backups/exports, and deletion failure
  recovery.
- [ ] Establish an incident/support process for parser errors, deletion
  requests, RevenueCat customer deletion, compromised upload/relay keys, relay
  outage, and store review questions.

## What `release:check` covers

The current `npm run release:check` correctly fails with ten configuration
findings:

1. Android RevenueCat public key missing.
2. iOS RevenueCat public key missing.
3. Production relay URL missing.
4. Public Shortcut URL missing.
5. EAS project UUID missing.
6. Production D1 database UUID missing.
7. Placeholder support address still present.
8. Privacy policy relay entity/jurisdiction still pending.
9. Terms legal entity and jurisdiction still pending.
10. Store-listing contact email and hosted privacy-policy URL still pending.

It verifies only shape/presence:

- RevenueCat key prefixes (`goog_`, `appl_`);
- HTTPS syntax for relay/Shortcut URLs and a `/shortcuts/<id>` pathname;
- UUID syntax for EAS project and D1 database;
- exact known legal/support placeholder strings.

It does **not** prove:

- the Shortcut URL is on `icloud.com`, reachable, current, or credential-free;
- public build variables are present in the EAS production build;
- a RevenueCat key belongs to Wafra or products/entitlement/trials work;
- D1 exists, is migrated, or is bound to the deployed Worker;
- Worker variables/secrets, Email Routing, retention, or rate limiting exist;
- relay URLs, health, crypto delivery, push receipts, APNs, or enhanced push
  security work;
- Apple/Google accounts, agreements, app records, store signing, or submission
  credentials exist;
- the Android AAB uses the persistent Play upload key;
- store metadata, screenshots, privacy/data safety, financial, content, or SMS
  declaration forms are complete or approved;
- legal documents are hosted, linked in-app, or approved by counsel;
- App Store encryption/privacy-manifest validation passes;
- source tests, Expo Doctor, npm audit, physical-device, billing, performance,
  haptic, accessibility, RTL, deletion, or blind visual gates pass.

Therefore `release:check` is a necessary configuration lint, not a launch
certificate. Run it only with the same production environment used to build.

## Final release command set

Run from a clean candidate checkout with Node 22. Preserve full output and
artifact/build identifiers. Do not “fix” the known SDK 55 toolchain audit by
accepting a breaking Expo downgrade.

```bash
npm ci
npm --prefix server ci
npx expo install --check
npx expo-doctor@latest
npm run check
npm run test:e2e
npm audit --omit=dev
npm --prefix server audit --omit=dev

# Make production public variables available to this process first.
npm run release:check
npx expo config --type public

# Inspect config-plugin output without deleting or generating native projects.
npx expo config --type introspect

# iOS production build and TestFlight upload.
npx eas-cli@latest build --platform ios --profile production
npx eas-cli@latest submit --platform ios --profile production

# Android EAS lane, only if EAS owns the same accepted upload key.
npx eas-cli@latest build --platform android --profile production
npx eas-cli@latest submit --platform android --profile production
```

`npm run check` currently covers TypeScript, ESLint, unit/contract/corpus tests,
server typecheck/tests, and the relay bundle dry-run. Browser E2E and
`release:check` remain separate and must both be run. If a native prebuild is
needed for deeper inspection, do it in a disposable clean checkout: prebuild
can replace generated native projects, and `/ios` and `/android` are
gitignored here rather than sources of truth.

For the existing GitHub Android lane, use the workflow UI or an authorized
`gh` session to dispatch `build-apk.yml` with **Also build the Play Store
bundle** enabled. Download both artifacts, but submit the AAB; the APK is for
device installation only. Verify the workflow summary says it used the upload
key, not a throwaway key.

## Evidence packet to retain

For each store candidate, retain:

- commit SHA, clean/expected worktree state, dependency lock hashes, test and
  audit output;
- Expo project/account, EAS build/submission IDs, app version/build or version
  code, bundle/package ID, and build environment variable names (not secret
  values);
- IPA/AAB SHA-256, signing team/certificate fingerprint, Android upload
  fingerprint, and App Store/Play processing result;
- relay deployment ID, D1 database identity, migration output, configuration
  names, secret names, health result, and redacted operational test results;
- screenshots/listing revision, policy/data answers, SMS declaration video and
  decision, subscription product status, and test purchase receipts with
  personal/payment data redacted;
- physical-device matrix, iOS locked/reboot/force-quit proof, Android SMS and
  notification proof, accessibility/performance/haptic results, and the blind
  visual verdict;
- explicit account-owner sign-off for legal, privacy, pricing, territories,
  staged rollout, support readiness, and production release.

Related repository sources: [App Store playbook](./app-store-release.md),
[Play release playbook](./play-release.md), [billing setup](./billing.md),
[Shortcut specification](./ios-shortcut-spec.md),
[store listing](./store-listing.md), [privacy policy](./privacy-policy.md), and
[terms](./terms-of-use.md).
