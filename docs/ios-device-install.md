# Wafra — ad hoc install on one iPhone

A faster loop than TestFlight for putting a build on a phone you own.

TestFlight goes: build → upload → App Store Connect processing → tester group →
(first external build) Beta App Review → tester installs. Ad hoc internal
distribution goes: build → link → tap install. Apple never sits in the middle.
The cost is that the phone must be registered by UDID before the build is made,
and the build only ever installs on phones that were on the list at build time.

Both paths need the paid Apple Developer Program. Ad hoc needs nothing beyond
it — no App Store Connect app record, no listing, no review.

Every fact below is cited. Everything I could not confirm from Expo's or
Apple's own documentation is called out in
[What is not verified here](#what-is-not-verified-here). Nothing in this
document was asserted from memory.

---

## The profile

`eas.json` already carried `preview` with `"distribution": "internal"`. Expo
documents that as exactly the switch that produces an iOS ad hoc build:

> **iOS**: Builds using this profile will use either ad hoc or enterprise
> provisioning. When using ad hoc provisioning, EAS Build will generate a
> provisioning profile containing an allow-list of device UDIDs, and only those
> devices in the list at build time will be able to install it.
> — [Internal distribution](https://docs.expo.dev/build/internal-distribution/)

So `preview` is the ad hoc profile. Nothing else was needed to make it
installable. Do not set `ios.enterpriseProvisioning` — Expo scopes that option
to "an Apple account with Apple Developer Enterprise Program membership"
([schema reference](https://docs.expo.dev/eas/json/#ios-specific-options)), a
separate $299/yr program. A normal paid account gets ad hoc automatically.

`preview` now also carries `"autoIncrement": true`, so each build gets its own
build number instead of every install reporting build `1`. See
[What changed in eas.json](#what-changed-in-easjson).

---

## Prerequisites

- Paid Apple Developer Program membership, active.
- An Expo account, and the project linked to it.
- A terminal somewhere — your own machine, a codespace, or CI. Two steps below
  genuinely cannot be driven from the phone; they are marked **terminal**.
- iPhone with a browser. That is the whole device-side requirement.

---

## One-time: register the iPhone

### 1. Generate the registration link — **terminal**

```bash
npx eas-cli device:create
```

Expo documents the prompts:

> - **You're inside the project directory. Would you like to use the**
>   *your-account-name* **account?** Press Y.
> - **Apple ID.** For this step, enter your Apple ID. It will then log in to
>   our Apple Developer account. Follow the steps in the terminal window.
> - **How would you like to register your devices?** Select **Website** that
>   generates a registration URL that can be opened on the iOS device.
>
> — [Create and run a cloud build for iOS device](https://docs.expo.dev/tutorial/eas/ios-development-build-for-devices/)

You get back a URL (and a QR code). Send that URL to the iPhone however you
like — Messages, email, scanning the QR with the camera.

**Do not commit the URL, the resulting UDID, your Apple ID, or the team ID to
this repository.** They are account state, not source.

### 2. What happens on the iPhone

Expo's documented sequence, which is Apple's standard configuration-profile
install flow:

1. Open the link in the phone's browser.
2. Tap **Download Profile**.
3. Open the **Settings** app — it prompts you to register the device.
4. Tap **Install**.
5. The phone redirects back to the browser with a success message.

That profile exists only to read the device's UDID and hand it to Expo. **No
Mac, no Xcode, no cable.** This is the answer to "can the UDID be captured
without a Mac": yes, this is the supported way.

### 3. Wait, if the membership is brand new

This is the one place a fresh membership will bite you. Expo:

> Registering a device with Expo does not register it with Apple. The device is
> added to your Apple Developer Portal only when it's first included in a
> provisioning profile [...] For these memberships, Apple can take **up to
> 24–72 hours** to finish processing a newly registered device, and during that
> time the device can't be added to provisioning profiles. As a result, the
> first build or re-sign that includes a new device may fail.
> — [Internal distribution](https://docs.expo.dev/build/internal-distribution/)

Apple's own table gives the shape of it:

| Registered test device count (per platform) | Timeframe |
| --- | --- |
| 1 to 10 | Upon registration |
| 11 to 100 | Within 24 to 72 hours |

> Enabling registered test devices may require additional processing for new
> Apple Developer Program memberships or memberships renewed after expiration
> for one month or more.
> — [Device registration updates](https://developer.apple.com/help/account/reference/device-registration-updates/)

So for one phone on a fresh membership: register it, and if the first build
fails to pick it up, wait and build again. Register the phone the day the
membership is approved, before you need a build, and the wait costs nothing.

Check what is registered at any time:

```bash
npx eas-cli device:list
```

Devices added via the website/QR show up as a bare UDID;
`npx eas-cli device:rename` gives them a readable name
([Managing devices](https://docs.expo.dev/build/internal-distribution/#managing-devices)).

---

## Build

```bash
npx eas-cli build --platform ios --profile preview
```

The first interactive run will ask you to log in to the Apple account and
generate a distribution certificate, and then:

> **Select a device for ad hoc build.** This is the key part, which is why we
> had to register a provisioning profile before. We can select one or all of
> our registered devices here.
> — [Create and run a cloud build for iOS device](https://docs.expo.dev/tutorial/eas/ios-development-build-for-devices/)

Select the iPhone. That selection is baked into the provisioning profile in
this build.

**Run it interactively at least the first time, and every time you add a
device.** Expo is explicit that a non-interactive build silently reuses the old
profile:

> For iOS ad hoc builds, `eas build --non-interactive` reuses a valid
> provisioning profile without updating its device list. The build can succeed,
> but the app may not install on registered devices added after the profile was
> last updated.
> — [Internal distribution](https://docs.expo.dev/build/internal-distribution/)

A build that succeeds and then will not install is the classic failure here.
For CI, the documented fix is
`--refresh-ad-hoc-provisioning-profile` (EAS CLI ≥ 19.1.0) plus an App Store
Connect API key in `EXPO_ASC_API_KEY_PATH`, `EXPO_ASC_KEY_ID`, and
`EXPO_ASC_ISSUER_ID`. Those are secrets — environment only, never in the repo.

---

## Install on the phone

From the build's detail page on the EAS dashboard:

> Click **Install** under the Build artifact section to display the **Install on
> a test device** popup. Copy the link from **Send a link to a device** section
> and send it to the test device.
> — [Create and share internal distribution build](https://docs.expo.dev/tutorial/eas/internal-distribution-builds/)

There is also a QR code you can scan with the phone's camera. Tap the link on
the phone, confirm the install, and the app appears on the Home Screen. No
development server is needed — a `preview` build is standalone.

### The install link is public by default

> By default, internal distribution build URLs are available to anybody with
> the URL, and each is identified by a 32 character UUID. If you would like to
> require sign-in to an authorized Expo account to access these builds, you can
> disable the **Unauthenticated access to internal builds** option in your
> project settings.
> — [Internal distribution](https://docs.expo.dev/build/internal-distribution/)

For an app that handles a personal financial ledger, turn that option off.
Unguessable is not the same as private, and build links get pasted into chats.

---

## Adding a second device later

This is the rule that most often surprises people, so state it plainly:

**Registering a device does nothing to builds that already exist.** The
provisioning profile is an allow-list fixed at build time.

> Adding a new device will require a rebuild of your app or re-signing the
> build with new credentials.
> — [Internal distribution](https://docs.expo.dev/build/internal-distribution/)

> This command enables device registration at any time. However, only builds
> created post-registration will work on the newly added device.
> — [Create and share internal distribution build](https://docs.expo.dev/tutorial/eas/internal-distribution-builds/)

So, to add a phone:

1. `npx eas-cli device:create`, new phone installs the profile.
2. Wait out Apple's processing if the membership is new (24–72 h).
3. Either rebuild interactively, selecting both devices —
   or re-sign the existing `.ipa` without a full rebuild:

```bash
npx eas-cli build:resign
```

Expo documents `build:resign` as re-signing an existing iOS `.ipa` with a new
ad hoc provisioning profile, "eliminating the need for a full rebuild"
([tutorial](https://docs.expo.dev/tutorial/eas/internal-distribution-builds/)).
That is the cheap path when the code has not changed and you only need one more
phone on the list.

The already-installed app on the *first* phone is unaffected either way.

---

## How this differs from TestFlight

| | Ad hoc internal distribution | TestFlight |
| --- | --- | --- |
| Apple in the loop per build | No | Yes — App Store Connect processing |
| Review | None | First build in an external group goes to App Review |
| Device setup | UDID registered before the build | None — tester just needs the app |
| Who can install | Only devices in the profile at build time | Any tester in the group |
| Ceiling | 100 iPhones per year, per account | 100 internal testers / 10,000 external |
| Build lifetime | Until the provisioning profile expires | 90 days |
| Concurrent builds | Any number of links, all live | Expo: "TestFlight limits to one active build at a time" |

Sources: [Internal distribution](https://docs.expo.dev/build/internal-distribution/),
[Create and share internal distribution build](https://docs.expo.dev/tutorial/eas/internal-distribution-builds/),
[TestFlight overview](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview).

### The 100-device limit

> This method requires a paid Apple Developer account and that account will
> only be able to use this method to distribute to at most 100 iPhones per
> year.
> — [Internal distribution](https://docs.expo.dev/build/internal-distribution/)

And removing a device does not buy the slot back mid-year:

> Disabled devices still count against Apple's limit of 100 devices for ad hoc
> distribution per app.
> — [Managing devices](https://docs.expo.dev/build/internal-distribution/#managing-devices)

For one owner and one phone this is irrelevant. It matters if Wafra ever fans
out to a real tester group — that is the point at which TestFlight stops being
the slower option and starts being the only option.

### The profile must be regenerated when a device is added

Covered above. Restated because it is the difference that actually changes how
you work: with TestFlight you add a tester and they install the *existing*
build. With ad hoc you add a device and must produce a *new* artifact — rebuild
or `build:resign` — before that device can install anything.

### Ad hoc builds expire

Expo states the period directly:

> Provisioning profiles expire after 12 months, but this won't affect apps in
> production. You will just need to create a new one the next time you build
> your app by running `eas build -p ios`, or manually with `eas credentials`.
> — [App credentials](https://docs.expo.dev/app-signing/app-credentials/)

Twelve months from profile creation, then. Compare TestFlight's "You can test a
build for up to 90 days" — TestFlight builds die sooner, but replacing them is
one upload; replacing an expired ad hoc profile means a fresh build too.

Caveats I could confirm the shape of but not the exact behaviour: the profile
is bound to the distribution certificate, and Expo notes that if the
certificate "is revoked or expired, you'll need to regenerate the app's
provisioning profile, as well"
([App credentials](https://docs.expo.dev/app-signing/app-credentials/)). Letting
the membership lapse therefore invalidates installed ad hoc builds by a second
route. See [What is not verified here](#what-is-not-verified-here).

---

## iOS Simulator, if a Mac ever appears

Simulator builds need **no Apple Developer account at all**:

> This provides a standalone (independent of Expo Go) version of the app
> running without needing to deploy to TestFlight or even having an Apple
> Developer account.
> — [Build for iOS Simulators](https://docs.expo.dev/build-reference/simulators/)

Two profiles cover this:

- **`development-simulator`** — already present, `extends: development` with
  `ios.simulator: true`. This is verbatim the pattern Expo recommends for SDK
  55 ("you can create a separate development profile for that build [...] For
  example, `development-simulator`" —
  [Configure EAS Build with eas.json](https://docs.expo.dev/build/eas-json/)),
  so its shape is correct. **But it will not build as the repo stands**:
  `developmentClient: true` requires `expo-dev-client`, which is not in
  `package.json`. Fixing that means touching `package.json`, which this change
  deliberately does not do.
- **`preview-simulator`** — added here. `extends: preview` with
  `ios.simulator: true`, no dev client, no dev server, and the relay URL
  restated explicitly. This is the profile to use on a Mac.

```bash
npx eas-cli build --platform ios --profile preview-simulator
npx eas-cli build:run -p ios --latest
```

`eas build:run` downloads and installs onto the simulator
([Installing build on the simulator](https://docs.expo.dev/build-reference/simulators/#installing-build-on-the-simulator)).

---

## What changed in eas.json

Three edits, no removals. The `EXPO_PUBLIC_WAFRA_RELAY_URL` block on `preview`
and `production` is untouched.

1. **`preview` unchanged in kind — verified, not modified.**
   `"distribution": "internal"` is exactly and only what iOS ad hoc requires.
   No new profile was invented for ad hoc; `preview` is it.
2. **`preview` gained `"autoIncrement": true`.** With
   `cli.appVersionSource: "remote"`, a profile without `autoIncrement` reuses
   the current remote build number, so every ad hoc install reports the same
   build and you cannot tell from the phone which one you are looking at — the
   exact thing a fast iteration loop needs to be able to tell. Note the
   trade-off: this advances the same remote counter `production` uses. That is
   harmless (App Store Connect only requires build numbers to increase) but it
   means production build numbers will skip.
3. **`preview-simulator` added.** `extends: preview`, `ios.simulator: true`,
   `autoIncrement: false` so simulator builds do not burn build numbers. The
   `env` block is repeated verbatim rather than left to `extends` inheritance —
   losing the relay URL silently would be an expensive bug, and repetition
   costs nothing.

No secret, key, Apple ID, team ID, or UDID was added. The relay URL was already
in the file.

---

## What is not verified here

Written without an Apple Developer account. These are open:

- **Whether Developer Mode (iOS 16+) is required for an ad hoc `preview`
  build.** Expo lists activating Developer Mode as a prerequisite on the
  *development build* chapter
  ([iOS device build](https://docs.expo.dev/tutorial/eas/ios-development-build-for-devices/)),
  and does not mention it on the internal-distribution or preview pages. I
  could not confirm either way for a release-signed ad hoc build. If the
  install fails or the app refuses to launch, check
  Settings → Privacy & Security → Developer Mode first.
- **Whether Apple's 100-device ceiling is per membership year, per product
  family, or both, and when the counter resets.** Expo says "at most 100
  iPhones per year" and "Apple's limit of 100 devices [...] per app". Apple's
  own device-registration page, which I read, does not state the limit or the
  reset rule at all. Do not plan around a specific reset date without checking
  the Apple Developer account's own Devices page.
- **The exact expiry clock on an ad hoc build.** Expo's 12-month figure is for
  the provisioning profile. Whether an installed app stops launching precisely
  at profile expiry, at certificate expiry, or at membership lapse — and how
  the device's clock is consulted — I could not confirm from Apple's
  documentation. Treat 12 months as the ceiling, not a guarantee.
- **Wall-clock build time.** EAS reports 10–15 minutes for App Store Connect
  processing *after* upload
  ([Submit to the Apple App Store](https://docs.expo.dev/submit/ios/)), which
  is the step ad hoc skips entirely. The EAS build itself depends on queue
  position and plan tier; I have no verified number. The structural claim
  stands regardless: ad hoc removes an Apple-side processing stage and the
  review stage, not the build stage.
- **Everything downstream of the account.** Certificate generation, the Apple
  login prompts, and the portal's behaviour on first device registration were
  read from Expo's documentation, not observed.

---

## Related

- [`app-store-release.md`](./app-store-release.md) — production and submission.
- [`launch-readiness.md`](./launch-readiness.md) — what still blocks a real
  release.
